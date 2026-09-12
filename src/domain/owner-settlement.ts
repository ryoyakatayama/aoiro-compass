import { report } from './accounting';
import { newId, transactionSchema, type Snapshot, type Transaction } from './model';
export type SettlementKind = 'offset' | 'cash_in' | 'cash_out';
export function ownerBalances(s: Snapshot, year: number) {
  const rows = report(s, year).balance;
  return {
    borrow: rows.find((a) => a.id === '3100')?.balance || 0,
    lend: rows.find((a) => a.id === '1600')?.balance || 0,
    cash: rows.find((a) => a.id === '1000')?.balance || 0,
  };
}
export function ownerSettlement(
  s: Snapshot,
  year: number,
  date: string,
  kind: SettlementKind,
): Transaction {
  const b = ownerBalances(s, year);
  const amount =
    kind === 'offset' ? Math.min(b.borrow, b.lend) : kind === 'cash_in' ? b.lend : b.borrow;
  if (amount <= 0) throw new Error('この処理の対象残高がありません');
  if (kind === 'cash_out' && b.cash < amount)
    throw new Error('事業の現金残高が不足しています。入出金の記帳を確認してください');
  if (!date.startsWith(`${year}-`)) throw new Error('対象年度の日付を指定してください');
  const accounts =
    kind === 'offset' ? ['3100', '1600'] : kind === 'cash_in' ? ['1000', '1600'] : ['3100', '1000'];
  const description =
    kind === 'offset'
      ? '事業主貸・事業主借の相殺'
      : kind === 'cash_in'
        ? '本人からの現金補填（事業主貸の精算）'
        : '本人への現金精算（事業主借の精算）';
  return transactionSchema.parse({
    id: newId(),
    year,
    transaction_date: date,
    description,
    status: 'confirmed',
    source: `owner_${kind}`,
    kind: 'normal',
    evidence_ids: [],
    lines: [
      {
        account_id: accounts[0],
        debit_amount: amount,
        credit_amount: 0,
        memo: kind === 'offset' ? '事業主勘定間の相殺' : '実際の現金授受を本人が確認',
      },
      {
        account_id: accounts[1],
        debit_amount: 0,
        credit_amount: amount,
        memo: kind === 'offset' ? '事業主勘定間の相殺' : '実際の現金授受を本人が確認',
      },
    ],
  });
}
