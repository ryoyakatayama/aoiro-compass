import type { Store } from './db/store';
import { newId, now } from './domain/model';
export function seedDemo(store: Store) {
  if (store.setting('demo_seeded')) return;
  const year = new Date().getFullYear();
  if (!store.snapshot().years.some((y) => y.year === year - 1)) store.addYear(year - 1);
  store.saveProfile({
    business_name: 'Studio Compass（デモ）',
    industry: 'クリエイティブ・Web制作',
    description: '小規模な事業者のWebサイトやブランドデザインを制作する、架空の一人事業です。',
    customers: '国内の法人・個人事業主。継続契約と紹介案件が中心。',
    revenue_model: 'Web制作の受託報酬、デザイン制作、月額の保守サポート。',
    work_style: '自宅の一室で平日週5日制作。月に数回、顧客を訪問。',
    expenses: '制作ソフト、外注デザイン、通信、仕事場の家賃、資料購入。',
    private_use: '家賃・通信を業務の使用実態に応じて按分。',
    tax_status: '青色申告 / 消費税は検討中',
    invoice_status: '未登録',
    concerns: '家事按分の根拠と、機材購入の扱いを整理したい。',
  });
  const make = (
    y: number,
    m: number,
    desc: string,
    dr: string,
    cr: string,
    amount: number,
    day = 10,
    status = 'confirmed',
  ) =>
    store.saveTransaction({
      id: newId(),
      year: y,
      transaction_date: `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
      description: desc,
      status,
      source: 'demo',
      lines: [
        { account_id: dr, debit_amount: amount, credit_amount: 0 },
        { account_id: cr, debit_amount: 0, credit_amount: amount },
      ],
    });
  for (const y of [year - 1, year]) {
    const count = y === year ? new Date().getMonth() + 1 : 12;
    store.saveTransaction({
      id: newId(),
      year: y,
      transaction_date: `${y}-01-01`,
      description: '期首残高（デモ）',
      status: 'confirmed',
      source: 'demo',
      kind: 'opening',
      lines: [
        { account_id: '1010', debit_amount: 480000, credit_amount: 0 },
        { account_id: '3000', debit_amount: 0, credit_amount: 480000 },
      ],
    });
    for (let m = 1; m <= count; m++) {
      const factor = y === year ? 1 : 0.78;
      make(
        y,
        m,
        'Webサイト制作 / サンプル取引先A',
        '1010',
        '4000',
        Math.round((310000 + m * 16500 + (m % 3) * 32000) * factor),
      );
      make(
        y,
        m,
        '月額サポート / サンプル取引先B',
        '1010',
        '4000',
        Math.round((72000 + m * 5000) * factor),
        15,
      );
      make(y, m, '外注デザイン費', '5100', '1010', Math.round((65000 + m * 2600) * factor), 12);
      make(y, m, '仕事場の家賃（事業分）', '5500', '1010', 36000, 25);
      make(y, m, '制作ソフト利用料', '5300', '2100', 12800 + m * 200, 6);
      make(y, m, '資料・書籍', '6500', '3100', 4500 + m * 500, 3);
      if (m % 2 === 0) make(y, m, 'クライアント訪問の交通費', '5400', '3100', 12800, 19);
    }
  }
  const month = new Date().getMonth() + 1;
  make(year, month, '撮影用の小物（確認待ち）', '5200', '3100', 8600, 2, 'draft');
  const id = newId();
  const target = store
    .snapshot()
    .transactions.find((t) => t.year === year && t.description.includes('家賃'))!;
  store.createAudit({
    id,
    review_type: 'expense',
    target_years: [year],
    law_basis_years: [year],
    created_at: now(),
    status: 'prepared',
    question: '自宅の仕事場に関する経費の根拠を、事業の実態に沿って整理したいです。',
    summary: '',
    requested_evidence_ids: [],
  });
  store.importAudit({
    schema_version: '1.0',
    audit_id: id,
    review_type: 'expense',
    summary: {
      overall_assessment:
        'デモの指摘例です。事業との関係が分かる記録を揃えると、専門家への相談を具体的に進められます。',
      high: 0,
      medium: 1,
      low: 0,
    },
    findings: [
      {
        finding_id: 'F001',
        severity: 'medium',
        category: 'business_use',
        title: '自宅の仕事場：按分の根拠を整理しましょう',
        description:
          '仕事場の家賃として毎月36,000円が記録されています。専用面積や利用時間の考え方を確認すると、実態の説明がしやすくなります。',
        reasoning_summary:
          'これは対話を体験するための架空の指摘です。税務上の結論を示すものではありません。',
        suggested_action:
          '仕事専用の部屋か、私用でも使うかを教えてください。面積や稼働時間の記録はありますか？',
        affected_transaction_ids: [target.id],
        requested_evidence_ids: [],
        suggested_draft_change: null,
        confidence: 0.72,
        requires_human_judgment: true,
        current_law_verification_required: true,
      },
    ],
    requested_evidence_ids: [],
    limitations: ['画面体験用のデモデータです。実際のAI監査ではありません。'],
  });
  store.setSetting('demo_seeded', '1');
}
