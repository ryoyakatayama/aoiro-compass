import { z } from 'zod';
import { yearSchema, signedMoneySchema, moneySchema, type Snapshot } from './model';
import { report, monthly, closingChecks } from './accounting';
import { recordedBusinessAmount } from './depreciation';
import { exportCsv, journalCsv } from '../lib/csv';
import {
  filingDocumentSchema,
  filingDocumentKey,
  filingDocuments,
  filingCompletion,
} from './filing-documents';

export const filingSources = {
  start: 'https://www.keisan.nta.go.jp/kyoutu/ky/sm/top#bsctrl',
  flow: 'https://www.e-tax.nta.go.jp/toiawase/faq/gaiyo/07.htm',
  blue: 'https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/2070.htm',
  records: 'https://www.nta.go.jp/taxes/shiraberu/shinkoku/kojin_jigyo/index.htm',
};
export const filingItems = [
  {
    id: 'myna_setup',
    group: '資料・記帳',
    title: 'マイナポータル連携の準備',
    detail:
      'マイナポータルの確定申告の事前準備から証券会社・保険会社等との連携と電子交付を確認。マイナンバーの届出だけで自動取得できるとは限りません。',
    page: 'filing',
  },
  {
    id: 'myna_import',
    group: '申告書の入力',
    title: '控除証明書・特定口座年間取引報告書を取得',
    detail:
      '作成コーナーでマイナンバーカード方式・マイナポータル連携を選び、対象年のデータを取得。金融機関・本人／家族・件数・対象年を確認。',
    page: 'filing',
  },
  {
    id: 'myna_missing',
    group: '申告書の入力',
    title: '自動取得できなかった資料を補完',
    detail:
      '未対応金融機関・一般口座・国外取引、医療費通知にない支出、反映前の証明書等を確認。同じ証明書の手入力やXML取込と重複しないように照合。株式を申告するか等の選択は作成コーナーで確認。',
    page: 'filing',
  },
  {
    id: 'sales',
    group: '資料・記帳',
    title: '売上・入金・源泉徴収',
    detail:
      '請求書、売上明細、支払通知、通帳を照合。源泉徴収前の総収入と手数料を分け、未収入金も確認。',
    page: 'bank',
  },
  {
    id: 'receipts',
    group: '資料・記帳',
    title: '経費・領収書・明細',
    detail: '領収書とカード明細の二重計上、日付、所得区分、私用混在を確認。原本と仕訳を紐付ける。',
    page: 'evidence',
  },
  {
    id: 'opening',
    group: '決算整理',
    title: '前年末と期首残高',
    detail:
      '前年の申告済み貸借対照表、固定資産台帳と照合。現金、預金、売掛金、未払金、元入金を確認。',
    page: 'reports',
  },
  {
    id: 'accrual',
    group: '決算整理',
    title: '売掛・買掛・未払・前払・前受',
    detail:
      '入出金日だけで収益・費用を決めず、年末の未収・未払、翌年分、返金を確認して決算整理仕訳を入力。',
    page: 'ledger',
  },
  {
    id: 'inventory',
    group: '決算整理',
    title: '棚卸・家事消費',
    detail:
      '商品・材料・仕掛品があれば12月31日の棚卸表を作成。期首棚卸＋仕入−期末棚卸と家事消費を確認。',
    page: 'ledger',
  },
  {
    id: 'allocation',
    group: '決算整理',
    title: '家事按分・事業主勘定',
    detail:
      '家賃、通信、車等の事業・雑所得・私用の合計が100%以内か確認。実際の現金授受がない精算仕訳を作らない。',
    page: 'closing',
  },
  {
    id: 'assets',
    group: '決算整理',
    title: '固定資産・減価償却',
    detail:
      '供用日、耐用年数、事業割合、前年末簿価、当年の償却と仕訳を照合。取得の二重計上、売却・除却、資本的支出、特例も確認。',
    page: 'assets',
  },
  {
    id: 'special',
    group: '決算整理',
    title: '給与・専従者・地代家賃・引当金等',
    detail:
      '該当する場合は受取人別の内訳、届出、源泉徴収、貸倒れや引当金、利子・割引料の明細を準備。',
    page: 'ledger',
  },
  {
    id: 'consumption',
    group: '決算整理',
    title: '消費税・インボイス',
    detail:
      '基準期間・特定期間、登録・届出を踏まえ課税／免税を確認。課税なら税率別、課税区分、控除要件と経理方式を確認し、消費税申告も作成コーナーで行う。',
    page: 'reports',
  },
  {
    id: 'misc',
    group: '申告書の入力',
    title: '雑所得・他の所得',
    detail:
      '雑所得側の帳簿を別途確認。給与・年金・配当・株式・暗号資産・譲渡等は取引資料と年間計算を準備。雑所得に青色申告特別控除を適用しない。',
    page: 'reports',
  },
  {
    id: 'insurance',
    group: '申告書の入力',
    title: '社会保険料・生命保険料・地震保険料等',
    detail:
      '国民年金、健康保険、共済・iDeCo等の支払額・控除証明書を確認。事業経費との重複を避ける。',
    page: 'archive',
  },
  {
    id: 'deductions',
    group: '申告書の入力',
    title: '医療費・寄附金・住宅ローン・家族情報',
    detail:
      '該当する控除の証明、明細、ふるさと納税、扶養・配偶者の所得を準備。マイナンバーは作成コーナーへ入力。',
    page: 'archive',
  },
  {
    id: 'loss',
    group: '申告書の入力',
    title: '損失の繰越・前年の申告書',
    detail:
      '前年の申告書・損失申告用の付表で繰越額を確認。帳簿上の赤字をそのまま繰越控除にしない。',
    page: 'archive',
  },
  {
    id: 'blue',
    group: '申告書の入力',
    title: '青色申告決算書・控除の要件',
    detail:
      '事業の損益計算書、月別売上・仕入、減価償却明細、期首・期末B/Sを入力。65万円控除は複式簿記等の要件に加え期限内のe-Tax送信等を確認。',
    page: 'reports',
  },
  {
    id: 'identity',
    group: '申告書の入力',
    title: 'e-Taxの認証・還付先・予定納税',
    detail: 'マイナンバーカード等の認証手段、還付口座、予定納税額、受取人別の源泉徴収税額を準備。',
    page: 'filing',
  },
  {
    id: 'submission',
    group: '送信・保存',
    title: 'e-Taxで送信・受信通知を確認',
    detail:
      '作成コーナーで対象年を選び、決算書から所得税申告へ進む。入力内容・提出書類を確認して本人が送信。受信通知で受付結果を確認。',
    page: 'filing',
  },
  {
    id: 'payment',
    group: '送信・保存',
    title: '納付・還付の手続',
    detail:
      '申告書の送信と納付は別の確認。表示された納付額・期限・方法、振替日や還付先を確認する。',
    page: 'filing',
  },
  {
    id: 'retention',
    group: '送信・保存',
    title: '申告書・受信通知・帳簿を保存',
    detail:
      '申告書・決算書PDF、作成コーナーの保存データ、受信通知、納付記録をDriveに保管。帳簿・原本を保存し年度ロック、翌期繰越へ。',
    page: 'closing',
  },
] as const;
export const filingStatusSchema = z
  .object({
    year: yearSchema,
    item: z.enum(filingItems.map((i) => i.id)),
    status: z.enum(['todo', 'ready', 'na']),
    note: z.string().max(3000),
    updated: z.string().datetime(),
  })
  .strict();
export const detailKinds = [
  '源泉徴収・支払者別収入',
  '地代家賃・権利金',
  '給与・専従者給与',
  '利子割引料',
  '棚卸',
  '他の所得・所得控除',
  '繰越損失・予定納税',
  'その他の申告補足',
] as const;
export const filingDetailSchema = z
  .object({
    year: yearSchema,
    id: z.string().uuid(),
    kind: z.enum(detailKinds),
    name: z.string().trim().min(1).max(200),
    amount: signedMoneySchema,
    withheld: moneySchema,
    note: z.string().max(2000),
  })
  .strict();
export const filingPrefix = 'filing_';
export function validateFilingSetting(key: string, value: string) {
  const parsed: unknown = JSON.parse(value);
  if (key.startsWith('filing_check_')) {
    const v = filingStatusSchema.parse(parsed);
    if (key !== 'filing_check_' + v.year + '_' + v.item)
      throw new Error('申告チェックの識別子が一致しません');
  } else if (key.startsWith('filing_detail_')) {
    const v = filingDetailSchema.parse(parsed);
    if (key !== 'filing_detail_' + v.year + '_' + v.id)
      throw new Error('申告補足の識別子が一致しません');
  } else if (key.startsWith('filing_document_')) {
    const v = filingDocumentSchema.parse(parsed);
    if (key !== filingDocumentKey(v)) throw new Error('申告保存資料の識別子が一致しません');
  } else throw new Error('未対応の申告準備データです');
}
export function filingState(s: Snapshot, year: number) {
  const checks = Object.entries(s.settings)
    .filter(([k]) => k.startsWith('filing_check_' + year + '_'))
    .flatMap(([, value]) => {
      try {
        const r = filingStatusSchema.safeParse(JSON.parse(value));
        return r.success && r.data.year === year ? [r.data] : [];
      } catch {
        return [];
      }
    });
  const details = Object.entries(s.settings)
    .filter(([k]) => k.startsWith('filing_detail_' + year + '_'))
    .map(([, v]) => filingDetailSchema.parse(JSON.parse(v)));
  return { checks, details };
}
export function filingChecks(s: Snapshot, year: number) {
  const checks = closingChecks(s, year),
    r = report(s, year);
  const assetTotal = r.balance
    .filter((a) => ['1500', '1510', ...s.assets.map((a) => a.asset_account_id)].includes(a.id))
    .reduce((n, a) => n + a.balance, 0);
  const activeAssets = s.assets.filter(
    (a) => a.year <= year && (!a.disposed_at || a.disposed_at >= `${year}-01-01`),
  );
  if (!r.summaryOnly && activeAssets.length) {
    const expected = new Map<string, number>();
    for (const a of activeAssets) {
      const account = a.asset_account_id || (a.asset_class === '車両運搬具' ? '1510' : '1500');
      const d = s.depreciations
        .filter((d) => d.asset_id === a.id && d.year <= year)
        .sort((a, b) => b.year - a.year)[0];
      const value = d?.closing_book_value ?? a.opening_book_value ?? a.acquisition_cost;
      expected.set(account, (expected.get(account) || 0) + value);
    }
    const mismatches = [...expected].filter(
      ([id, value]) => value !== (r.balance.find((a) => a.id === id)?.balance || 0),
    ).length;
    checks.push({
      label: '資産台帳の未償却残高と帳簿の残高差異（下書きの償却・処分も確認）',
      count: mismatches,
      fatal: false,
    });
  }
  if (assetTotal && !s.assets.some((a) => a.year <= year))
    checks.push({
      label: '帳簿に固定資産残高がありますが、資産台帳が未登録です',
      count: 1,
      fatal: false,
    });
  if (r.summaryOnly)
    checks.push({
      label: '年次集計のみ：月次明細・貸借対照表等は原資料で確認',
      count: 1,
      fatal: false,
    });
  if (!s.transactions.some((t) => t.year === year) && !r.summaryOnly)
    checks.push({ label: '仕訳がありません：当年未入力と取引なしを確認', count: 1, fatal: false });
  return checks;
}
export function filingFiles(s: Snapshot, year: number, book: string): Record<string, string> {
  const r = report(s, year),
    state = filingState(s, year);
  return {
    '10_申告後の保存資料.json': JSON.stringify(
      { year, documents: filingDocuments(s, year), completion: filingCompletion(s, year) },
      null,
      2,
    ),
    'はじめに.txt':
      year +
      '年 ' +
      book +
      ' 申告準備資料\n確定申告書等作成コーナーで対象年を選び、必要な金額・明細を入力してください。CSVはe-Taxの直接取込形式ではありません。\n事業と雑所得はそれぞれ書き出し、所得区分を分けて入力します。収入・経費は確定した帳簿に基づき、補足明細は帳簿に加算されません。\n青色申告特別控除、所得控除、損益通算、繰越損失、所得税額・消費税額は作成コーナーで対象年度の条件を確認します。\n' +
      filingSources.flow +
      '\n' +
      filingSources.blue,
    '01_転記用集計.csv': exportCsv([
      ['対象年', '帳簿', '項目', '金額'],
      [year, book, '総収入', r.revenue],
      [year, book, '必要経費', r.expense],
      [year, book, '差引額（青色申告特別控除等の適用前）', r.profit],
    ]),
    '02_科目別損益.csv': exportCsv([
      ['勘定科目', '収益・費用区分', '金額'],
      ...(!r.summaryOnly
        ? r.pl
            .filter((a) => ['revenue', 'expense'].includes(a.type) && (a.debit || a.credit))
            .map((a) => [a.name, a.type, a.balance])
        : [['明細なし：原資料を参照', '', '']]),
    ]),
    '03_月別売上経費.csv': exportCsv([
      ['月', '売上・収益', '仕入科目の合計（家事消費・棚卸は別途確認）', '必要経費', '差引'],
      ...monthly(s, year).map((m) => [
        m.month,
        m.revenue ?? '未集計',
        r.summaryOnly
          ? '未集計'
          : report(
              s,
              year,
              `${year}-${String(m.month).padStart(2, '0')}-01`,
              `${year}-${String(m.month).padStart(2, '0')}-31`,
            )
              .pl.filter((a) => a.id === '5000' || /^仕入/.test(a.name))
              .reduce((n, a) => n + a.balance, 0),
        m.expense ?? '未集計',
        m.profit ?? '未集計',
      ]),
    ]),
    '04_期首期末残高.csv': exportCsv([
      ['科目', '区分', '期首', '期末'],
      ...(!r.summaryOnly
        ? r.balance
            .filter((a) => !['revenue', 'expense'].includes(a.type) && (a.debit || a.credit))
            .map((a) => [
              a.name,
              a.type,
              r.opening.find((v) => v.id === a.id)?.balance ?? 0,
              a.balance,
            ])
        : [['年次集計のみ：原資料で貸借を確認', '', '', '']]),
      ...(!r.summaryOnly ? [['青色申告特別控除前の所得金額', 'equity', 0, r.profit]] : []),
    ]),
    '05_減価償却.csv': exportCsv([
      [
        '資産',
        '取得日',
        '供用日',
        '取得価額',
        '方法',
        '耐用年数',
        '事業割合',
        '期首簿価',
        '当年償却',
        '必要経費（仕訳）',
        '期末簿価',
        '根拠',
      ],
      ...s.assets
        .filter((a) => a.year <= year)
        .map((a) => {
          const d = s.depreciations.find((d) => d.asset_id === a.id && d.year === year);
          return [
            a.name,
            a.acquisition_date,
            a.in_service_date,
            a.acquisition_cost,
            a.depreciation_method,
            a.useful_life_years,
            a.business_use_ratio,
            d?.opening_book_value ?? '',
            d?.depreciation_amount ?? '',
            d ? (recordedBusinessAmount(s, d) ?? '要確認') : '未登録',
            d?.closing_book_value ?? '',
            d?.calculation ?? a.note,
          ];
        }),
    ]),
    '06_資料準備チェック.csv': exportCsv([
      ['区分', '項目', '確認内容', '状態', 'メモ'],
      ...filingItems.map((i) => {
        const c = state.checks.find((c) => c.item === i.id);
        return [i.group, i.title, i.detail, c?.status ?? 'todo', c?.note ?? ''];
      }),
    ]),
    '07_申告補足明細.csv': exportCsv([
      ['種類', '支払者・受取人・項目', '金額', '源泉徴収税額', 'メモ'],
      ...state.details.map((d) => [d.kind, d.name, d.amount, d.withheld, d.note]),
    ]),
    '08_自動チェック.csv': exportCsv([
      ['確認項目', '件数', '区分'],
      ...filingChecks(s, year).map((c) => [c.label, c.count, c.fatal ? '要修正' : '要確認']),
    ]),
    '09_仕訳帳.csv': journalCsv(s, year),
  };
}
