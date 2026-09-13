import { dateSchema, type Snapshot, type Transaction } from './model';
import { monthly, report } from './accounting';
import type { BookKind } from '../lib/book';

export const bookNames = { business: '事業所得', misc: '雑所得' };
export type Books = Partial<Record<BookKind, Snapshot>>;
export type Amounts = {
  revenue: number | null;
  expense: number | null;
  profit: number | null;
  notes: string[];
};
const unknown = (note: string): Amounts => ({
  revenue: null,
  expense: null,
  profit: null,
  notes: [note],
});
export function checkRange(from: string, to: string) {
  dateSchema.parse(from);
  dateSchema.parse(to);
  if (from > to) throw new Error('開始日を終了日以前にしてください');
  if (Number(to.slice(0, 4)) - Number(from.slice(0, 4)) > 30)
    throw new Error('比較期間は31年以内にしてください');
}
export const monthEnd = (y: number, m: number) =>
  `${y}-${String(m).padStart(2, '0')}-${new Date(Date.UTC(y, m, 0)).getUTCDate()}`;
export function addAmounts(rows: Amounts[]): Amounts {
  const sum = (key: 'revenue' | 'expense') =>
    rows.length && rows.every((r) => r[key] !== null)
      ? rows.reduce((n, r) => n + r[key]!, 0)
      : null;
  const revenue = sum('revenue'),
    expense = sum('expense');
  return {
    revenue,
    expense,
    profit: revenue !== null && expense !== null ? revenue - expense : null,
    notes: [...new Set(rows.flatMap((r) => r.notes))],
  };
}
export function bookPeriod(s: Snapshot | undefined, from: string, to: string): Amounts {
  checkRange(from, to);
  if (!s) return unknown('この端末に帳簿がありません');
  const result: Amounts[] = [];
  for (let year = Number(from.slice(0, 4)); year <= Number(to.slice(0, 4)); year++) {
    const start = from > `${year}-01-01` ? from : `${year}-01-01`,
      end = to < `${year}-12-31` ? to : `${year}-12-31`;
    const fiscal = s.years.find((y) => y.year === year);
    if (!fiscal) {
      result.push(unknown(`${year}年の帳簿なし`));
      continue;
    }
    if (fiscal.data_completeness === 'summary_only') {
      const annual = s.historicalSummaries[year];
      if (!annual) {
        result.push(unknown(`${year}年の集計なし`));
        continue;
      }
      if (start === `${year}-01-01` && end === `${year}-12-31`) {
        result.push({
          revenue: annual.revenue,
          expense: annual.expense,
          profit: annual.revenue - annual.expense,
          notes: [`${year}年は年次集計`],
        });
        continue;
      }
      if (!start.endsWith('-01') || end !== monthEnd(year, Number(end.slice(5, 7)))) {
        result.push(unknown(`${year}年は日付別明細なし`));
        continue;
      }
      result.push(
        addAmounts(
          monthly(s, year)
            .filter(
              (m) => m.month >= Number(start.slice(5, 7)) && m.month <= Number(end.slice(5, 7)),
            )
            .map((m) => ({
              ...m,
              notes:
                m.revenue === null || m.expense === null
                  ? [`${year}年の月次内訳不足`]
                  : [`${year}年は月次集計`],
            })),
        ),
      );
    } else {
      const entered = s.transactions.some(
        (t) => t.year === year && t.kind !== 'opening' && t.status !== 'draft',
      );
      if (!entered) {
        result.push(unknown(`${year}年は確定取引未入力`));
        continue;
      }
      const r = report(s, year, start, end);
      result.push({
        revenue: r.revenue,
        expense: r.expense,
        profit: r.profit,
        notes: [`${year}年の確定済み取引のみ`],
      });
    }
  }
  return addAmounts(result);
}
export function comparePeriod(books: Books, selected: BookKind[], from: string, to: string) {
  const rows = selected.map((book) => ({ book, ...bookPeriod(books[book], from, to) }));
  return { rows, total: addAmounts(rows) };
}
export function comparisonSeries(
  books: Books,
  selected: BookKind[],
  from: string,
  to: string,
  unit: 'year' | 'month',
) {
  checkRange(from, to);
  const rows = [];
  for (let year = Number(from.slice(0, 4)); year <= Number(to.slice(0, 4)); year++) {
    const months = unit === 'year' ? [0] : Array.from({ length: 12 }, (_, i) => i + 1);
    for (const month of months) {
      const periodStart = month ? `${year}-${String(month).padStart(2, '0')}-01` : `${year}-01-01`;
      const periodEnd = month ? monthEnd(year, month) : `${year}-12-31`;
      if (periodEnd < from || periodStart > to) continue;
      const start = periodStart < from ? from : periodStart,
        end = periodEnd > to ? to : periodEnd;
      rows.push({
        label: month ? periodStart.slice(0, 7) : String(year),
        from: start,
        to: end,
        ...comparePeriod(books, selected, start, end),
      });
    }
  }
  return rows;
}
export function comparisonTransactions(
  books: Books,
  selected: BookKind[],
  from: string,
  to: string,
) {
  return selected
    .flatMap((book) =>
      (books[book]?.transactions || [])
        .filter(
          (t) => t.transaction_date >= from && t.transaction_date <= to && t.kind !== 'opening',
        )
        .map((t) => ({ book, transaction: t })),
    )
    .sort(
      (a, b) =>
        b.transaction.transaction_date.localeCompare(a.transaction.transaction_date) ||
        a.book.localeCompare(b.book),
    );
}
export function knownPeriod(books: Books, selected: BookKind[], from: string, to: string) {
  const periods = comparisonSeries(books, selected, from, to, 'year');
  const rows = selected.map((book) => {
    const all = periods.flatMap((p) => p.rows.filter((r) => r.book === book));
    const available = all.filter((r) => r.revenue !== null && r.expense !== null);
    const missing = all.length - available.length;
    return {
      book,
      ...addAmounts(available),
      notes: [...new Set(all.flatMap((r) => r.notes))],
      missing,
    };
  });
  const valid = rows.filter((r) => r.revenue !== null && r.expense !== null);
  return { rows, total: addAmounts(valid), partial: rows.some((r) => r.missing > 0) };
}
export function transactionAmounts(s: Snapshot, t: Transaction) {
  const types = new Map(s.accounts.map((a) => [a.id, a.type]));
  return t.lines.reduce(
    (r, l) => ({
      revenue:
        r.revenue + (types.get(l.account_id) === 'revenue' ? l.credit_amount - l.debit_amount : 0),
      expense:
        r.expense + (types.get(l.account_id) === 'expense' ? l.debit_amount - l.credit_amount : 0),
    }),
    { revenue: 0, expense: 0 },
  );
}
