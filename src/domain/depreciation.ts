import { assetSchema, type Asset, type Depreciation, type Snapshot } from './model';

export const depreciationSources = {
  method: 'https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/2106.htm',
  rounding:
    'https://www.keisan.nta.go.jp/r6yokuaru/aoiroshinkoku/hitsuyokeihi/genkashokyakuhi/hasushori.html',
  special: 'https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/2100.htm',
  rates: 'https://www.nta.go.jp/taxes/shiraberu/shinkoku/tebiki/2025/pdf/037.pdf',
};
const ceiling = (numerator: bigint, denominator: bigint) =>
  Number((numerator + denominator - 1n) / denominator);
export const businessDepreciation = (amount: number, ratio: number) =>
  ceiling(BigInt(amount) * BigInt(Math.round(ratio * 100)), 10000n);

export function openingValue(a: Asset, year: number, entries: Depreciation[]) {
  const prior = entries
    .filter((d) => d.asset_id === a.id && d.year < year)
    .sort((a, b) => b.year - a.year)[0];
  if (prior) {
    if (prior.year !== year - 1) throw new Error('前年度の償却明細を先に登録してください');
    return prior.closing_book_value;
  }
  if (a.opening_year === year && a.opening_book_value !== undefined) return a.opening_book_value;
  if (Number(a.in_service_date.slice(0, 4)) !== year)
    throw new Error('過年度からの資産は、確認した前年末簿価を引継ぎ登録してください');
  return a.acquisition_cost;
}

/** Standard tangible straight-line depreciation only. No special election is inferred. */
export function straightLine(input: Asset, year: number, opening: number, months?: number) {
  const a = assetSchema.parse(input);
  if (![2023, 2024, 2025, 2026].includes(year))
    throw new Error(
      'この年度の計算ルールは未確認です。対象年度の根拠を確認して手動入力してください',
    );
  if (a.acquisition_date < '2007-04-01')
    throw new Error('旧定額法は手動入力で根拠を記録してください');
  if (a.useful_life_years < 2) throw new Error('耐用年数は2年以上で確認してください');
  if (a.in_service_date > `${year}-12-31` || (a.disposed_at && a.disposed_at < `${year}-01-01`))
    throw new Error('対象年度に供用されていません');
  if (!Number.isSafeInteger(opening) || opening < 1 || opening > a.acquisition_cost)
    throw new Error('期首簿価は1円以上、取得価額以下で入力してください');
  const from = Math.max(
    1,
    Number(a.in_service_date.slice(0, 4)) === year ? Number(a.in_service_date.slice(5, 7)) : 1,
  );
  const until = a.disposed_at?.startsWith(String(year)) ? Number(a.disposed_at.slice(5, 7)) : 12;
  const availableMonths = until - from + 1;
  const usedMonths = months ?? availableMonths;
  if (!Number.isInteger(usedMonths) || usedMonths < 1 || usedMonths > availableMonths)
    throw new Error(`使用月数は1〜${availableMonths}か月で確認してください`);
  // Statutory straight-line rates, rounded up to three decimals (useful life 2–100).
  const rateMilli = Math.ceil(1000 / a.useful_life_years);
  const amount = Math.min(
    opening - 1,
    ceiling(BigInt(a.acquisition_cost) * BigInt(rateMilli) * BigInt(usedMonths), 12000n),
  );
  const expense = businessDepreciation(amount, a.business_use_ratio);
  return {
    amount,
    expense,
    privateAmount: amount - expense,
    closing: opening - amount,
    months: usedMonths,
    rate: rateMilli / 1000,
    rule: `${year}年・定額法（有形資産） / 2026-09確認 v1`,
    basis: `取得価額 ${a.acquisition_cost}円 × 償却率 ${rateMilli / 1000} × ${usedMonths}/12。1円未満切上げ、期末1円を上限に調整。\n期首 ${opening}円 / 償却 ${amount}円 / 期末 ${opening - amount}円\n事業使用割合 ${a.business_use_ratio}% / 必要経費 ${expense}円（1円未満切上げ）\n${depreciationSources.method}\n${depreciationSources.rounding}`,
  };
}

export function recordedBusinessAmount(s: Snapshot, d: Depreciation) {
  const tx = s.transactions.find((t) => t.id === d.transaction_id);
  if (tx)
    return tx.lines
      .filter((l) => s.accounts.find((a) => a.id === l.account_id)?.type === 'expense')
      .reduce((sum, l) => sum + l.debit_amount - l.credit_amount, 0);
  return d.depreciation_amount === 0 ? 0 : null;
}
export function depreciationMismatches(s: Snapshot, year: number) {
  return s.depreciations
    .filter((d) => d.year === year && d.depreciation_amount > 0)
    .filter((d) => {
      const t = s.transactions.find((t) => t.id === d.transaction_id);
      if (!t) return true;
      const asset = s.assets.find((a) => a.id === d.asset_id);
      const account =
        asset?.asset_account_id || (asset?.asset_class === '車両運搬具' ? '1510' : '1500');
      return (
        t.lines
          .filter((l) => l.account_id === account)
          .reduce((n, l) => n + l.credit_amount - l.debit_amount, 0) !== d.depreciation_amount
      );
    });
}
