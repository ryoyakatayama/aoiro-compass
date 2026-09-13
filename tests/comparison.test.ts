import { beforeAll, expect, it } from 'vitest';
import initSqlJs from 'sql.js';
import { Store } from '../src/db/store';
import { newId, now } from '../src/domain/model';
import {
  comparePeriod,
  comparisonSeries,
  comparisonTransactions,
  knownPeriod,
} from '../src/domain/comparison';
import { activityPrefix, activitySchema, incomeActivities } from '../src/domain/activities';
import { exportSyncData, importSyncData } from '../src/lib/sync-data';
import {
  filingDocumentSchema,
  filingDocumentKey,
  filingCompletion,
} from '../src/domain/filing-documents';
import { buildAuditFiles, defaultPackOptions } from '../src/lib/packs';
let SQL: Awaited<ReturnType<typeof initSqlJs>>;
beforeAll(async () => {
  SQL = await initSqlJs();
});
function store(book: 'business' | 'misc', year: number, revenue: number, expense: number) {
  const st = new Store(SQL);
  st.setSetting('income_category', book);
  st.atomic(() =>
    st.importHistorical({
      schema_version: '1.0',
      book,
      year,
      data_completeness: 'summary_only',
      summary: { revenue, expense },
      accounts: [],
      transactions: [],
      evidences: [],
    }),
  );
  return st;
}
it('両所得の年次集計を合算し、月次不明を0円にしない', () => {
  const a = store('business', 2024, 200000, 100000),
    b = store('misc', 2024, 500000, 300000),
    books = { business: a.snapshot(), misc: b.snapshot() };
  expect(comparePeriod(books, ['business', 'misc'], '2024-01-01', '2024-12-31').total.profit).toBe(
    300000,
  );
  expect(comparePeriod(books, ['misc'], '2024-01-01', '2024-12-31').total.revenue).toBe(500000);
  expect(
    comparisonSeries(books, ['business', 'misc'], '2024-01-01', '2024-12-31', 'month').every(
      (r) => r.total.profit === null,
    ),
  ).toBe(true);
  expect(comparePeriod(books, [], '2024-01-01', '2024-12-31').total.profit).toBeNull();
  expect(knownPeriod(books, ['business', 'misc'], '2024-01-01', '2025-12-31')).toMatchObject({
    partial: true,
    total: { profit: 300000 },
  });
});
it('年度をまたぐ一部期間は年額を重複加算せず、日次不足を明示する', () => {
  const a = store('misc', 2024, 1200, 240);
  a.atomic(() =>
    a.importHistorical({
      schema_version: '1.0',
      year: 2025,
      data_completeness: 'summary_only',
      summary: { revenue: 2400, expense: 480 },
      accounts: [],
      transactions: [],
      evidences: [],
    }),
  );
  expect(
    comparePeriod({ misc: a.snapshot() }, ['misc'], '2024-07-01', '2025-06-30').total.revenue,
  ).toBeNull();
  expect(
    comparePeriod({ misc: a.snapshot() }, ['misc'], '2024-01-02', '2024-12-31').total.revenue,
  ).toBeNull();
  expect(() => comparisonSeries({}, [], '2025-01-01', '2024-01-01', 'year')).toThrow();
});
it('同一の取引IDも別所得として保持する', () => {
  const a = new Store(SQL),
    s = a.snapshot();
  const t = {
    id: newId(),
    year: 2026,
    transaction_date: '2026-01-01',
    description: '架空取引',
    status: 'confirmed' as const,
    kind: 'normal' as const,
    source: 'manual',
    lines: [],
    evidence_ids: [],
    updated_at: now(),
  };
  const snap = { ...s, transactions: [t] };
  const rows = comparisonTransactions(
    { business: snap, misc: snap },
    ['business', 'misc'],
    '2026-01-01',
    '2026-12-31',
  );
  expect(rows.map((r) => r.book)).toEqual(['business', 'misc']);
});
it('活動の適用年を限定して相談へ送り、同期で復元する', () => {
  const a = new Store(SQL),
    b = new Store(SQL),
    id = newId();
  a.setSetting('income_category', 'misc');
  const activity = activitySchema.parse({
    id,
    name: '架空の調査活動',
    from_year: 2024,
    to_year: 2025,
    category: '研究関連',
    description: '契約に基づく調査',
    income_source: '架空機関',
    expenses: '機材',
    allocation: '共用は記録',
    note: '',
    updated: now(),
  });
  a.setSetting(activityPrefix + id, JSON.stringify(activity));
  b.atomic(() => importSyncData(b, exportSyncData(a)));
  expect(incomeActivities(b.snapshot(), [2025])).toHaveLength(1);
  expect(incomeActivities(b.snapshot(), [2026])).toHaveLength(0);
  const audit = {
    id: newId(),
    review_type: 'historical' as const,
    target_years: [2025],
    law_basis_years: [2025],
    created_at: now(),
    status: 'prepared',
    question: '点検',
    summary: '',
    requested_evidence_ids: [],
  };
  expect(
    String(
      buildAuditFiles(a.snapshot(), audit, defaultPackOptions(2025))['income_activities.json'],
    ),
  ).toContain('架空の調査活動');
});
it('申告後の必須ファイルを未確認や該当なしで完了扱いにしない', () => {
  const a = new Store(SQL),
    b = new Store(SQL),
    v = {
      id: newId(),
      year: 2025,
      kind: 'receipt' as const,
      status: 'pending' as const,
      name: '通知.pdf',
      drive_id: 'file-test',
      sha256: 'a'.repeat(64),
      size: 10,
      note: '受付結果を確認',
      checked_at: now(),
      updated: now(),
    };
  expect(() => filingDocumentSchema.parse({ ...v, status: 'na' })).toThrow();
  expect(() => filingDocumentSchema.parse({ ...v, status: 'verified', sha256: '' })).toThrow();
  a.setSetting(filingDocumentKey(v), JSON.stringify(v));
  expect(filingCompletion(a.snapshot(), 2025).find((r) => r.id === 'receipt')?.complete).toBe(
    false,
  );
  a.setSetting(filingDocumentKey(v), JSON.stringify({ ...v, status: 'verified' }));
  b.atomic(() => importSyncData(b, exportSyncData(a)));
  expect(filingCompletion(b.snapshot(), 2025).find((r) => r.id === 'receipt')?.complete).toBe(true);
  expect(filingCompletion(b.snapshot(), 2024).some((r) => r.complete)).toBe(false);
});
