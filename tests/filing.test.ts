import { beforeAll, expect, it } from 'vitest';
import initSqlJs, { type SqlJsStatic } from 'sql.js';
import { createRequire } from 'node:module';
import { Store } from '../src/db/store';
import { assetSchema, newId } from '../src/domain/model';
import {
  straightLine,
  openingValue,
  businessDepreciation,
  depreciationMismatches,
} from '../src/domain/depreciation';
import { filingFiles, filingState, validateFilingSetting } from '../src/domain/filing';
import { exportSyncData, importSyncData } from '../src/lib/sync-data';
import { revisionSchema, materialize, type Revision } from '../src/lib/sync-graph';
import { upgradePendingArchives } from '../src/lib/ledger-sync';
import { archiveResponsePrefix } from '../src/domain/archive';
const require = createRequire(import.meta.url);
let SQL: SqlJsStatic;
beforeAll(async () => {
  SQL = await initSqlJs({ locateFile: () => require.resolve('sql.js/dist/sql-wasm.wasm') });
});
function sample(overrides: Record<string, unknown> = {}) {
  return assetSchema.parse({
    id: newId(),
    year: 2026,
    name: '架空の検証用機材',
    acquisition_date: '2026-04-20',
    in_service_date: '2026-04-20',
    acquisition_cost: 200001,
    asset_class: '工具器具備品',
    useful_life_years: 4,
    depreciation_method: 'straight_line',
    business_use_ratio: 50,
    ...overrides,
  });
}
it('定額法は供用月・円未満切上げ・私用割合・1円残高を反映する', () => {
  const a = sample();
  const d = straightLine(a, 2026, 200001);
  expect(d.months).toBe(9);
  expect(d.amount).toBe(37501);
  expect(d.expense).toBe(18751);
  expect(d.privateAmount).toBe(18750);
  expect(straightLine(a, 2026, 13000).amount).toBe(12999);
  expect(straightLine(a, 2026, 1).amount).toBe(0);
  expect(businessDepreciation(3, 33.33)).toBe(1);
  expect(() => straightLine(a, 2026, 200001, 10)).toThrow('使用月数');
  expect(() => straightLine(a, 2027, 200001)).toThrow('未確認');
  expect(() => straightLine(sample({ acquisition_date: '2000-01-01' }), 2026, 200001)).toThrow(
    '旧定額法',
  );
});
it('前年の確定簿価からの引継ぎは過年度の費用を再計上しない', () => {
  const st = new Store(SQL),
    a = sample({
      acquisition_date: '2024-04-20',
      in_service_date: '2024-04-20',
      opening_year: 2026,
      opening_book_value: 125000,
      opening_basis: '架空の前年台帳',
    });
  st.atomic(() => st.saveAsset(a));
  expect(st.snapshot().transactions).toHaveLength(0);
  expect(openingValue(a, 2026, [])).toBe(125000);
  st.atomic(() =>
    st.addDepreciation({
      asset_id: a.id,
      year: 2026,
      opening_book_value: 125000,
      depreciation_amount: 1,
      automatic: true,
      rule_version: 'preview',
      calculation: 'preview',
    }),
  );
  const s = st.snapshot();
  expect(s.depreciations[0].depreciation_amount).toBe(50001);
  expect(s.transactions[0].status).toBe('draft');
  expect(s.depreciations[0].closing_book_value).toBe(74999);
  expect(() =>
    st.atomic(() =>
      st.addDepreciation({
        asset_id: a.id,
        year: 2026,
        opening_book_value: 125000,
        depreciation_amount: 1,
        rule_version: 'x',
        calculation: 'x',
      }),
    ),
  ).toThrow('登録済み');
  expect(() => openingValue(a, 2028, s.depreciations)).toThrow('前年度');
});
it('償却に紐付いた仕訳を変更すると明細との不一致を検出する', () => {
  const st = new Store(SQL),
    a = sample();
  st.atomic(() => {
    st.saveAsset(a);
    st.addDepreciation({
      asset_id: a.id,
      year: 2026,
      opening_book_value: a.acquisition_cost,
      depreciation_amount: 50000,
      rule_version: 'manual',
      calculation: 'verified',
    });
  });
  expect(depreciationMismatches(st.snapshot(), 2026)).toHaveLength(0);
  const t = st.snapshot().transactions[0];
  t.lines = t.lines.map((l) => ({
    ...l,
    credit_amount: l.credit_amount ? 40000 : 0,
    debit_amount: l.debit_amount ? 20000 : 0,
  }));
  st.atomic(() => st.saveTransaction(t));
  expect(depreciationMismatches(st.snapshot(), 2026)).toHaveLength(1);
});
it('申告チェックと補足明細を端末間同期し、補足を売上に加算しない', () => {
  const st = new Store(SQL),
    dest = new Store(SQL);
  const id = newId();
  st.setSetting(
    'filing_check_2026_sales',
    JSON.stringify({
      year: 2026,
      item: 'sales',
      status: 'ready',
      note: '架空の支払明細を照合',
      updated: new Date().toISOString(),
    }),
  );
  st.setSetting(
    'filing_detail_2026_' + id,
    JSON.stringify({
      year: 2026,
      id,
      kind: '源泉徴収・支払者別収入',
      name: '架空の取引先',
      amount: 100000,
      withheld: 10210,
      note: '元帳と照合',
    }),
  );
  const doc = revisionSchema.parse({
    format: 'aoiro-sync-1',
    id: newId(),
    book: 'business',
    device: 'test',
    created: new Date().toISOString(),
    parents: [],
    changes: exportSyncData(st),
  });
  dest.atomic(() => importSyncData(dest, materialize([doc]).data));
  expect(filingState(dest.snapshot(), 2026).details[0].withheld).toBe(10210);
  const files = filingFiles(dest.snapshot(), 2026, '事業所得');
  expect(files['01_転記用集計.csv']).not.toContain('100000');
  expect(files['07_申告補足明細.csv']).toContain('10210');
  expect(() =>
    validateFilingSetting('filing_check_2025_sales', st.setting('filing_check_2026_sales')!),
  ).toThrow('識別子');
});
it('旧版で送信前に止まった大きな台帳・回答を再送できる形に移行する', () => {
  const doc: Revision = {
    format: 'aoiro-sync-1',
    id: newId(),
    book: 'business',
    device: 'test',
    created: new Date().toISOString(),
    parents: [],
    changes: {
      'shared:source_archive': 'x'.repeat(11000),
      ['shared:' + archiveResponsePrefix + 'sample']: 'x'.repeat(11000),
      'shared:drive_root': 'sample',
    },
  };
  expect(revisionSchema.safeParse(doc).success).toBe(false);
  upgradePendingArchives([doc]);
  expect(revisionSchema.safeParse(doc).success).toBe(true);
  expect(doc.changes['shared:drive_root']).toBe('sample');
});
