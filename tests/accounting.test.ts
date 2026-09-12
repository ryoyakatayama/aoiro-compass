import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import initSqlJs, { type SqlJsStatic } from 'sql.js';
import { createRequire } from 'node:module';
import { Store } from '../src/db/store';
import { newId, transactionSchema } from '../src/domain/model';
import { report, trialBalance } from '../src/domain/accounting';
const require = createRequire(import.meta.url);
let SQL: SqlJsStatic;
let store: Store;
beforeAll(async () => {
  SQL = await initSqlJs({ locateFile: () => require.resolve('sql.js/dist/sql-wasm.wasm') });
});
beforeEach(() => {
  store = new Store(SQL);
  if (!store.snapshot().years.some((y) => y.year === 2026)) store.addYear(2026);
});
const tx = (extra: Record<string, unknown> = {}) =>
  transactionSchema.parse({
    id: newId(),
    year: 2026,
    transaction_date: '2026-09-12',
    description: '制作報酬',
    status: 'confirmed',
    source: 'manual',
    lines: [
      { account_id: '1010', debit_amount: 110000, credit_amount: 0 },
      { account_id: '4000', debit_amount: 0, credit_amount: 110000 },
    ],
    ...extra,
  });
describe('会計の不変条件', () => {
  it('複合仕訳の確定とP/L・B/S・試算表', () => {
    store.atomic(() => {
      store.saveTransaction(tx());
      store.saveTransaction(
        tx({
          description: '複合経費',
          lines: [
            { account_id: '5200', debit_amount: 2000, credit_amount: 0 },
            { account_id: '5900', debit_amount: 1500, credit_amount: 0 },
            { account_id: '1010', debit_amount: 0, credit_amount: 3500 },
          ],
        }),
      );
    });
    const r = report(store.snapshot(), 2026);
    expect(r.revenue).toBe(110000);
    expect(r.expense).toBe(3500);
    expect(r.profit).toBe(106500);
    expect(r.cash).toBe(106500);
    const rows = trialBalance(store.snapshot().accounts, store.snapshot().transactions);
    expect(rows.reduce((s, r) => s + r.debit - r.credit, 0)).toBe(0);
  });
  it('借貸不一致を拒否しバッチ全体をロールバック', () => {
    expect(() =>
      store.atomic(() => {
        store.saveTransaction(tx());
        store.saveTransaction(
          tx({
            lines: [
              { account_id: '1010', debit_amount: 100, credit_amount: 0 },
              { account_id: '4000', debit_amount: 0, credit_amount: 99 },
            ],
          }),
        );
      }),
    ).toThrow('借方');
    expect(store.snapshot().transactions).toHaveLength(0);
  });
  it('下書きは正式集計から除外', () => {
    store.atomic(() => store.saveTransaction(tx({ status: 'draft' })));
    expect(report(store.snapshot(), 2026).revenue).toBe(0);
  });
  it('小数、負数、存在しない日付、未知の科目を拒否', () => {
    expect(() => tx({ transaction_date: '2026-02-30' })).toThrow();
    expect(() =>
      tx({
        lines: [
          { account_id: '1010', debit_amount: 1.5, credit_amount: 0 },
          { account_id: '4000', debit_amount: 0, credit_amount: 1.5 },
        ],
      }),
    ).toThrow();
    expect(() =>
      store.atomic(() =>
        store.saveTransaction(
          tx({
            lines: [
              { account_id: 'bad', debit_amount: 100, credit_amount: 0 },
              { account_id: '4000', debit_amount: 0, credit_amount: 100 },
            ],
          }),
        ),
      ),
    ).toThrow('勘定科目');
  });
  it('確定済み上書きを拒否し明示解除を記録', () => {
    const t = tx();
    store.atomic(() => store.saveTransaction(t));
    expect(() => store.atomic(() => store.saveTransaction(t))).toThrow('確定済み');
    store.atomic(() => store.unlockTransaction(t.id, '金額の訂正'));
    expect(store.snapshot().transactions[0].status).toBe('draft');
    expect(store.snapshot().events.some((e) => e.event_type === 'transaction_unlocked')).toBe(true);
  });
  it('下書きがある年度の締めを拒否', () => {
    store.atomic(() => store.saveTransaction(tx({ status: 'draft' })));
    expect(() => store.atomic(() => store.closeYear(2026, 'saved'))).toThrow('残っています');
  });
  it('締め済み・過年度を変更できない', () => {
    store.atomic(() => {
      store.saveTransaction(tx());
      store.closeYear(2026, 'backup');
    });
    expect(() => store.atomic(() => store.saveTransaction(tx()))).toThrow('閲覧専用');
    store.atomic(() =>
      store.importHistorical({
        schema_version: '1.0',
        year: 2024,
        data_completeness: 'summary_only',
        summary: { revenue: 100, expense: 50 },
      }),
    );
    expect(() => store.atomic(() => store.unlockYear(2024, '編集'))).toThrow('締め済み');
  });
  it('SQLiteを再ロードできる', () => {
    store.atomic(() => store.saveTransaction(tx()));
    const reopened = new Store(SQL, store.export());
    reopened.validate();
    expect(report(reopened.snapshot(), 2026).profit).toBe(110000);
  });
  it('期首残高の損益科目を拒否', () => {
    expect(() => store.atomic(() => store.saveTransaction(tx({ kind: 'opening' })))).toThrow(
      '貸借科目',
    );
  });
});
export { tx };
