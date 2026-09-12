import type { Account, Transaction, Snapshot, BankEntry, JournalLine } from './model';
import { depreciationMismatches } from './depreciation';
export const total = (lines: JournalLine[], side: 'debit_amount' | 'credit_amount') =>
  lines.reduce((s, l) => s + l[side], 0);
export function validateJournal(
  t: Transaction,
  accounts: Account[],
  strict = t.status !== 'draft',
) {
  if (Number(t.transaction_date.slice(0, 4)) !== t.year)
    throw new Error('取引日と会計年度が一致しません');
  for (const line of t.lines) {
    if (!accounts.some((a) => a.id === line.account_id && a.is_active))
      throw new Error('存在しない、または無効な勘定科目です');
    if (
      t.kind === 'opening' &&
      ['revenue', 'expense'].includes(accounts.find((a) => a.id === line.account_id)!.type)
    )
      throw new Error('期首残高には貸借科目だけを指定してください');
  }
  if (
    strict &&
    (total(t.lines, 'debit_amount') !== total(t.lines, 'credit_amount') ||
      total(t.lines, 'debit_amount') === 0)
  )
    throw new Error('借方と貸方が一致する、0円以外の仕訳だけを確定できます');
}
export function trialBalance(accounts: Account[], transactions: Transaction[]) {
  const rows = accounts.map((a) => ({ ...a, debit: 0, credit: 0, balance: 0 }));
  const index = new Map(rows.map((r) => [r.id, r]));
  for (const t of transactions.filter((t) => t.status !== 'draft'))
    for (const l of t.lines) {
      const r = index.get(l.account_id);
      if (r) {
        r.debit += l.debit_amount;
        r.credit += l.credit_amount;
      }
    }
  return rows.map((r) => ({
    ...r,
    balance: ['asset', 'expense'].includes(r.type) ? r.debit - r.credit : r.credit - r.debit,
  }));
}
export function report(s: Snapshot, year: number, start = `${year}-01-01`, end = `${year}-12-31`) {
  const tx = s.transactions.filter((t) => t.year === year && t.transaction_date <= end);
  const balance = trialBalance(s.accounts, tx);
  const pl = trialBalance(
    s.accounts,
    tx.filter((t) => t.transaction_date >= start && t.kind !== 'opening'),
  );
  const summary = s.historicalSummaries[year];
  const summaryOnly = s.years.find((y) => y.year === year)?.data_completeness === 'summary_only';
  const revenue =
    summaryOnly && summary
      ? summary.revenue
      : pl.filter((r) => r.type === 'revenue').reduce((s, r) => s + r.balance, 0);
  const expense =
    summaryOnly && summary
      ? summary.expense
      : pl.filter((r) => r.type === 'expense').reduce((s, r) => s + r.balance, 0);
  const opening = trialBalance(
    s.accounts,
    tx.filter((t) => t.kind === 'opening'),
  );
  return {
    balance,
    pl,
    opening,
    revenue,
    expense,
    profit: revenue - expense,
    margin: revenue ? ((revenue - expense) / revenue) * 100 : 0,
    cash: balance.filter((r) => ['1000', '1010'].includes(r.id)).reduce((s, r) => s + r.balance, 0),
    receivable: balance.find((r) => r.id === '1100')?.balance || 0,
    summaryOnly,
  };
}
export function monthly(s: Snapshot, year: number) {
  return Array.from({ length: 12 }, (_, i) => {
    const m = String(i + 1).padStart(2, '0');
    const summary = s.historicalSummaries[year];
    if (s.years.find((y) => y.year === year)?.data_completeness === 'summary_only') {
      const r = summary?.monthly.find((r) => r.month === i + 1);
      return {
        month: i + 1,
        revenue: r?.revenue ?? null,
        expense: r?.expense ?? null,
        profit: r?.revenue != null && r?.expense != null ? r.revenue - r.expense : null,
        available: r?.revenue != null || r?.expense != null,
      };
    }
    const r = report(s, year, `${year}-${m}-01`, `${year}-${m}-31`);
    return {
      month: i + 1,
      revenue: s.years.some((y) => y.year === year) ? r.revenue : null,
      expense: s.years.some((y) => y.year === year) ? r.expense : null,
      profit: s.years.some((y) => y.year === year) ? r.profit : null,
      available: s.years.some((y) => y.year === year),
    };
  });
}
export function reconciliationCandidates(bank: BankEntry, txs: Transaction[]) {
  return txs
    .filter((t) => t.year === bank.year && t.status === 'confirmed' && t.kind !== 'opening')
    .map((t) => {
      const amount = t.lines
        .filter((l) => l.account_id === bank.account_id)
        .reduce((s, l) => s + l.debit_amount - l.credit_amount, 0);
      const days =
        Math.abs(Date.parse(t.transaction_date) - Date.parse(bank.transaction_date)) / 86400000;
      return {
        transaction: t,
        score: amount === bank.amount && days <= 7 ? Math.round(100 - days * 4) : 0,
      };
    })
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score);
}
export function closingChecks(s: Snapshot, year: number) {
  const tx = s.transactions.filter((t) => t.year === year);
  const ev = s.evidences.filter((e) => e.year === year);
  const checks: { label: string; count: number; fatal: boolean }[] = [];
  checks.push({
    label: '償却明細と仕訳の不一致',
    count: depreciationMismatches(s, year).length,
    fatal: true,
  });
  checks.push({
    label: '借方・貸方の不一致',
    count: tx.filter(
      (t) =>
        t.status !== 'draft' && total(t.lines, 'debit_amount') !== total(t.lines, 'credit_amount'),
    ).length,
    fatal: true,
  });
  checks.push({
    label: '未確定の下書き仕訳',
    count: tx.filter((t) => t.status === 'draft').length,
    fatal: true,
  });
  checks.push({
    label: '原本の変更・欠落',
    count: ev.filter((e) => ['modified', 'missing'].includes(e.status)).length,
    fatal: true,
  });
  checks.push({
    label: 'アップロード待ちの原本',
    count: ev.filter((e) => !e.drive_file_id && e.status !== 'ignored').length,
    fatal: false,
  });
  checks.push({
    label: '仕訳と未紐付けの証憑',
    count: ev.filter(
      (e) => !tx.some((t) => t.evidence_ids.includes(e.id)) && e.status !== 'ignored',
    ).length,
    fatal: false,
  });
  checks.push({
    label: '重複の候補',
    count: ev.filter((e) => e.status === 'duplicate').length,
    fatal: false,
  });
  checks.push({
    label: 'AI読取の確認待ち',
    count: s.extractions.filter(
      (e) => ev.some((v) => v.id === e.evidence_id) && e.status === 'pending',
    ).length,
    fatal: false,
  });
  checks.push({
    label: '銀行・カードの未照合',
    count: s.banks.filter(
      (b) => b.year === year && !['matched', 'ignored'].includes(b.reconciliation_status),
    ).length,
    fatal: false,
  });
  checks.push({
    label: '当年の償却が未登録の資産',
    count: s.assets.filter(
      (a) =>
        a.year <= year &&
        a.in_service_date <= `${year}-12-31` &&
        (!a.disposed_at || a.disposed_at >= `${year}-01-01`) &&
        !s.depreciations.some((d) => d.asset_id === a.id && d.year === year),
    ).length,
    fatal: false,
  });
  checks.push({
    label: 'AIレビューの優先確認',
    count: s.findings.filter(
      (f) =>
        f.severity === 'high' &&
        !['resolved', 'dismissed'].includes(f.status) &&
        s.audits.some((a) => a.id === f.audit_id && a.target_years.includes(year)),
    ).length,
    fatal: false,
  });
  checks.push({
    label: '期首・前期末の残高差異',
    count: continuity(s, year - 1, year).filter((r) => r.difference !== 0).length,
    fatal: false,
  });
  return checks;
}
export function continuity(s: Snapshot, prior: number, next: number) {
  if (!s.years.some((y) => y.year === prior)) return [];
  const before = report(s, prior),
    after = report(s, next);
  return s.accounts
    .filter((a) => ['asset', 'liability', 'equity'].includes(a.type))
    .map((a) => {
      let end = before.balance.find((r) => r.id === a.id)?.balance || 0;
      if (a.id === '3000')
        end +=
          before.profit +
          (before.balance.find((x) => x.id === '3100')?.balance || 0) -
          (before.balance.find((x) => x.id === '1600')?.balance || 0);
      if (['1600', '3100'].includes(a.id)) end = 0;
      const summary = s.historicalSummaries[prior];
      if (before.summaryOnly && summary) {
        const r = summary.balance_sheet.find((r) => r.account_id === a.id);
        end = r
          ? ['asset'].includes(a.type)
            ? r.debit_amount - r.credit_amount
            : r.credit_amount - r.debit_amount
          : 0;
        if (a.id === '3000')
          end += summary.balance_sheet
            .filter((l) => ['1600', '3100'].includes(l.account_id))
            .reduce((n, l) => n + l.credit_amount - l.debit_amount, 0);
        if (['1600', '3100'].includes(a.id)) end = 0;
      }
      const start = after.opening.find((r) => r.id === a.id)?.balance || 0;
      return {
        account: a.name,
        account_id: a.id,
        prior: end,
        next: start,
        difference: start - end,
      };
    })
    .filter((r) => r.prior || r.next);
}
