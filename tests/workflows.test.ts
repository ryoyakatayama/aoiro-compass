import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import initSqlJs, { type SqlJsStatic } from 'sql.js';
import { createRequire } from 'node:module';
import { Store } from '../src/db/store';
import { newId, now, type Evidence, type Audit, transactionSchema } from '../src/domain/model';
import { report, continuity, reconciliationCandidates } from '../src/domain/accounting';
import { parseBankCsv, exportCsv } from '../src/lib/csv';
import { buildAuditFiles, defaultPackOptions, safeData, zipFiles } from '../src/lib/packs';
import JSZip from 'jszip';
import { ownerBalances, ownerSettlement } from '../src/domain/owner-settlement';
const require = createRequire(import.meta.url);
let SQL: SqlJsStatic, store: Store;
beforeAll(async () => {
  SQL = await initSqlJs({ locateFile: () => require.resolve('sql.js/dist/sql-wasm.wasm') });
});
beforeEach(() => {
  store = new Store(SQL);
  if (!store.snapshot().years.some((y) => y.year === 2026)) store.addYear(2026);
});
function evidence(overrides: Partial<Evidence> = {}): Evidence {
  return {
    id: newId(),
    year: 2026,
    drive_file_id: newId(),
    filename: 'receipt.pdf',
    mime_type: 'application/pdf',
    size_bytes: 100,
    sha256: 'a'.repeat(64),
    original_sha256: 'a'.repeat(64),
    modified_time: '2026-09-01',
    status: 'indexed',
    capture_source: 'drive_upload',
    hint: '消耗品費',
    payment_account: '3100',
    note: '',
    indexed_at: now(),
    ...overrides,
  };
}
function entry(overrides: Record<string, unknown> = {}) {
  return transactionSchema.parse({
    id: newId(),
    year: 2026,
    transaction_date: '2026-09-01',
    description: '制作報酬',
    status: 'confirmed',
    source: 'manual',
    lines: [
      { account_id: '1010', debit_amount: 10000, credit_amount: 0 },
      { account_id: '4000', debit_amount: 0, credit_amount: 10000 },
    ],
    ...overrides,
  });
}
function audit(overrides: Partial<Audit> = {}): Audit {
  return {
    id: newId(),
    review_type: 'individual',
    target_years: [2026],
    law_basis_years: [2026],
    created_at: now(),
    status: 'prepared',
    question: '経費の扱いを検討',
    summary: '',
    requested_evidence_ids: [],
    ...overrides,
  };
}
function result(a: Audit, tx: string, eid: string) {
  return {
    schema_version: '1.0',
    audit_id: a.id,
    review_type: a.review_type,
    summary: { overall_assessment: '確認事項があります', high: 0, medium: 1, low: 0 },
    findings: [
      {
        finding_id: 'F001',
        severity: 'medium',
        category: 'expense',
        title: '用途を確認',
        description: '事業との関係を教えてください',
        reasoning_summary: '用途が不明です',
        suggested_action: '利用状況を回答',
        affected_transaction_ids: [tx],
        requested_evidence_ids: [eid],
        confidence: 0.8,
        requires_human_judgment: true,
        current_law_verification_required: true,
        suggested_draft_change: null,
      },
    ],
    requested_evidence_ids: [eid],
    limitations: [],
  };
}
describe('証憑とAI読取', () => {
  it('Drive IDで改名・移動を追跡し、内容変更を検出', () => {
    const e = evidence();
    store.atomic(() => store.upsertEvidence(e));
    store.atomic(() => store.upsertEvidence({ ...e, filename: 'renamed.pdf' }));
    expect(store.snapshot().evidences).toHaveLength(1);
    expect(store.snapshot().evidences[0].id).toBe(e.id);
    store.atomic(() =>
      store.upsertEvidence({ ...e, sha256: 'b'.repeat(64), modified_time: '2026-09-02' }),
    );
    expect(store.snapshot().evidences[0].status).toBe('modified');
    expect(store.snapshot().evidences[0].original_sha256).toBe(e.sha256);
    store.atomic(() => store.markMissing(e.drive_file_id!));
    expect(store.snapshot().evidences[0].status).toBe('missing');
  });
  it('SHA-256重複を削除せず記録', () => {
    store.atomic(() => {
      store.upsertEvidence(evidence());
      store.upsertEvidence(evidence());
    });
    expect(store.snapshot().evidences).toHaveLength(2);
    expect(store.snapshot().evidences.some((e) => e.status === 'duplicate')).toBe(true);
  });
  it('JSONLを検証して候補へ保存し、人が作った下書きだけを追加', () => {
    const e = evidence();
    store.atomic(() => store.upsertEvidence(e));
    const value = {
      schema_version: '1.0',
      evidence_id: e.id,
      transaction_date: '2026-09-01',
      vendor: '用品店',
      gross_amount: 100,
      currency: 'JPY',
      suggested_account: '消耗品費',
      confidence: 0.9,
      warnings: [],
    };
    store.atomic(() => store.importExtractions(JSON.stringify(value)));
    expect(store.snapshot().transactions).toHaveLength(0);
    store.atomic(() => store.draftFromExtraction(store.snapshot().extractions[0].id));
    expect(store.snapshot().transactions[0].status).toBe('draft');
    expect(report(store.snapshot(), 2026).expense).toBe(0);
    expect(() => store.atomic(() => store.importExtractions(JSON.stringify(value)))).toThrow(
      '取込済み',
    );
  });
  it('不明な証憑を含むバッチは全件巻き戻す', () => {
    const e = evidence();
    store.atomic(() => store.upsertEvidence(e));
    const value = {
      schema_version: '1.0',
      evidence_id: e.id,
      transaction_date: '2026-09-01',
      vendor: '用品店',
      gross_amount: 100,
      currency: 'JPY',
      suggested_account: '消耗品費',
      confidence: 0.9,
    };
    expect(() =>
      store.atomic(() =>
        store.importExtractions(
          [value, { ...value, evidence_id: newId() }].map((x) => JSON.stringify(x)).join('\n'),
        ),
      ),
    ).toThrow('不明');
    expect(store.snapshot().extractions).toHaveLength(0);
    expect(store.snapshot().evidences[0].status).toBe('indexed');
  });
  it('原本欠落でも関連仕訳を保持', () => {
    const e = evidence();
    store.atomic(() => {
      store.upsertEvidence(e);
      store.saveTransaction(entry({ evidence_ids: [e.id] }));
      store.markMissing(e.drive_file_id!);
    });
    expect(store.snapshot().transactions[0].evidence_ids).toEqual([e.id]);
  });
});
describe('税務相談の往復', () => {
  it('指摘・本人回答・追加AI回答を同一スレッドへ保持し、重複を拒否', () => {
    const a = audit(),
      e = evidence(),
      t = entry();
    store.atomic(() => {
      store.upsertEvidence(e);
      store.saveTransaction(t);
      store.createAudit(a);
      store.importAudit(result(a, t.id, e.id));
    });
    const f = store.snapshot().findings[0];
    const mid = store.atomic(() => store.addMessage(a.id, f.id, '週5日、事業専用で使います'));
    const reply = {
      schema_version: '1.0',
      audit_id: a.id,
      messages: [
        {
          message_id: newId(),
          finding_id: 'F001',
          reply_to: mid,
          content: 'その利用実態を踏まえて検討を更新します。',
        },
      ],
    };
    store.atomic(() => store.importReplies(reply));
    expect(store.snapshot().messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(store.snapshot().findings[0].status).toBe('reviewing');
    expect(() => store.atomic(() => store.importReplies(reply))).toThrow('取込済み');
  });
  it('別相談の返信先や不明な仕訳を拒否', () => {
    const a = audit(),
      e = evidence(),
      t = entry();
    store.atomic(() => {
      store.upsertEvidence(e);
      store.saveTransaction(t);
      store.createAudit(a);
    });
    expect(() => store.atomic(() => store.importAudit(result(a, newId(), e.id)))).toThrow('不明');
    expect(store.snapshot().findings).toHaveLength(0);
    expect(() =>
      store.atomic(() =>
        store.importReplies({
          schema_version: '1.0',
          audit_id: a.id,
          messages: [{ message_id: newId(), finding_id: null, reply_to: newId(), content: '回答' }],
        }),
      ),
    ).toThrow('返信先');
  });
  it('事業プロフィールと対話、法令年度、識別子をパックへ保持', () => {
    const a = audit(),
      e = evidence(),
      t = entry();
    store.atomic(() => {
      store.saveProfile({ industry: 'Web制作', description: '受託制作', work_style: '自宅' });
      store.upsertEvidence(e);
      store.saveTransaction(t);
      store.createAudit(a);
      store.addMessage(a.id, null, '実態を補足します。連絡先 test@example.com');
    });
    const files = buildAuditFiles(store.snapshot(), a, defaultPackOptions(2026));
    expect(files['business_profile.json']).toContain('Web制作');
    expect(files['conversation.json']).toContain('実態を補足');
    expect(files['conversation.json']).not.toContain('test@example.com');
    expect(files['README_FOR_CHATGPT.md']).toContain('暫定的な法的');
    expect(files['README_FOR_CHATGPT.md']).toContain('2026');
    expect(String(files['journal_entries.jsonl'])).toContain(t.id);
    expect(String(files['audit_manifest.json'])).not.toContain('token');
  });
  it('秘密情報のフィールドを相談パックに含めず、原本は初回除外', () => {
    store.setSetting('google_client_id', 'private-token');
    store.saveProfile({ business_name: '屋号', industry: '事業' });
    const files = buildAuditFiles(store.snapshot(), audit(), defaultPackOptions(2026));
    const text = JSON.stringify(files);
    expect(text).not.toContain('private-token');
    expect(files['business_profile.json']).not.toContain('屋号');
    expect(Object.keys(files).some((f) => f.startsWith('evidence/'))).toBe(false);
  });
  it('雑所得の法令文脈が渡る', () => {
    store.setSetting('income_category', 'misc');
    const files = buildAuditFiles(store.snapshot(), audit(), defaultPackOptions(2026));
    expect(files['README_FOR_CHATGPT.md']).toContain('所得区分（本人の指定）: 雑所得');
    expect(files['audit_manifest.json']).toContain('misc');
  });
  it('過年度の監査は当時の法令年度を保持', () => {
    store.atomic(() =>
      store.importHistorical({
        schema_version: '1.0',
        year: 2024,
        data_completeness: 'summary_only',
        summary: { revenue: 100, expense: 20 },
      }),
    );
    const a = audit({ review_type: 'historical', target_years: [2024], law_basis_years: [2024] });
    store.atomic(() => store.createAudit(a));
    expect(store.snapshot().audits[0].law_basis_years).toEqual([2024]);
  });
});
describe('明細と過年度・年度間継続性', () => {
  it('CSVの日本語・カンマ・改行・符号と式の無害化', () => {
    const rows = parseBankCsv('日付,摘要,金額\n2026/09/01,"備品,購入","-1,000"\n', 2026, '1010');
    expect(rows[0].amount).toBe(-1000);
    expect(rows[0].description).toBe('備品,購入');
    expect(exportCsv([['=HYPERLINK("http://evil")', 100]])).toContain("'=HYPERLINK");
    expect(() => parseBankCsv('日付,摘要,金額\n2026-09-01,用品,100.5', 2026, '1010')).toThrow(
      '整数',
    );
  });
  it('明細照合は口座の純増減と符号で判定', () => {
    const t = entry();
    store.atomic(() => {
      store.saveTransaction(t);
      store.importBank(
        parseBankCsv('日付,摘要,金額\n2026-09-02,入金,10000', 2026, '1010'),
        'hash',
        'bank',
      );
    });
    const b = store.snapshot().banks[0];
    expect(reconciliationCandidates(b, store.snapshot().transactions)).toHaveLength(1);
    store.atomic(() => store.reconcile(b.id, t.id));
    expect(store.snapshot().banks[0].reconciliation_status).toBe('matched');
    expect(() =>
      store.atomic(() =>
        store.importBank(
          parseBankCsv('日付,摘要,金額\n2026-09-02,入金,10000', 2026, '1010'),
          'hash',
          'bank',
        ),
      ),
    ).toThrow('取込済み');
  });
  it('過年度集計が不整合なら年度の作成も巻き戻す', () => {
    expect(() =>
      store.atomic(() =>
        store.importHistorical({
          schema_version: '1.0',
          year: 2024,
          data_completeness: 'summary_only',
          summary: {
            revenue: 100,
            expense: 20,
            balance_sheet: [{ account_id: '1010', debit_amount: 100, credit_amount: 0 }],
          },
        }),
      ),
    ).toThrow('一致');
    expect(store.snapshot().years.some((y) => y.year === 2024)).toBe(false);
  });
  it('年越しでは損益・事業主勘定を元入金へ振替', () => {
    store.atomic(() => {
      store.saveTransaction(entry());
      store.saveTransaction(
        entry({
          description: '立替経費',
          lines: [
            { account_id: '5200', debit_amount: 1000, credit_amount: 0 },
            { account_id: '3100', debit_amount: 0, credit_amount: 1000 },
          ],
        }),
      );
      store.saveTransaction(
        entry({
          description: '生活費へ',
          lines: [
            { account_id: '1600', debit_amount: 2000, credit_amount: 0 },
            { account_id: '1010', debit_amount: 0, credit_amount: 2000 },
          ],
        }),
      );
      store.closeYear(2026, 'backup');
      store.addYear(2027);
      store.carryForward(2026, 2027);
    });
    const opening = store.snapshot().transactions.find((t) => t.year === 2027)!;
    expect(opening.status).toBe('draft');
    expect(opening.lines.some((l) => ['1600', '3100'].includes(l.account_id))).toBe(false);
    expect(opening.lines.find((l) => l.account_id === '3000')?.credit_amount).toBe(8000);
    store.atomic(() => store.saveTransaction({ ...opening, status: 'confirmed' }));
    expect(continuity(store.snapshot(), 2026, 2027).every((r) => r.difference === 0)).toBe(true);
  });
  it('手動償却は事業割合を反映した下書きのみ作成', () => {
    const id = newId();
    store.atomic(() => {
      store.saveAsset({
        id,
        year: 2026,
        name: '機材',
        acquisition_date: '2026-01-01',
        in_service_date: '2026-01-01',
        acquisition_cost: 200000,
        asset_class: '工具器具備品',
        useful_life_years: 4,
        depreciation_method: 'manual',
        business_use_ratio: 80,
        note: '確認済',
      });
      store.addDepreciation({
        asset_id: id,
        year: 2026,
        opening_book_value: 200000,
        depreciation_amount: 50000,
        rule_version: '2026-manual',
        calculation: 'ユーザーの検証済み値',
      });
    });
    const t = store.snapshot().transactions[0];
    expect(t.status).toBe('draft');
    expect(t.lines.find((l) => l.account_id === '6200')?.debit_amount).toBe(40000);
    expect(t.lines.find((l) => l.account_id === '1600')?.debit_amount).toBe(10000);
    expect(store.snapshot().depreciations[0].closing_book_value).toBe(150000);
  });
});

it('領収書の未登録AI科目を人が選び直して確定し、再処理を拒否する', () => {
  const ev = evidence();
  store.atomic(() => store.upsertEvidence(ev));
  store.atomic(() =>
    store.importExtractions(
      JSON.stringify({
        schema_version: '1.0',
        evidence_id: ev.id,
        transaction_date: '2026-09-01',
        vendor: 'テスト購入',
        gross_amount: 800,
        currency: 'JPY',
        suggested_account: 'まだ未分類',
        confidence: 0.5,
      }),
    ),
  );
  const x = store.snapshot().extractions[0];
  const t = entry({
    description: '原本を確認した経費',
    source: 'ai',
    evidence_ids: [ev.id],
    lines: [
      { account_id: '5300', debit_amount: 800, credit_amount: 0 },
      { account_id: '3100', debit_amount: 0, credit_amount: 800 },
    ],
  });
  store.atomic(() => store.saveReviewedExtraction(x.id, t));
  expect(store.snapshot().extractions[0].status).toBe('confirmed');
  expect(report(store.snapshot(), 2026).expense).toBe(800);
  expect(() =>
    store.atomic(() => store.saveReviewedExtraction(x.id, { ...t, id: newId() })),
  ).toThrow('処理されています');
  expect(store.snapshot().transactions).toHaveLength(1);
});

it('事業主勘定の相殺・現金精算は損益を変えず、繰り返しの相殺を拒否する', () => {
  for (const [dr, cr, amount] of [
    ['1000', '3000', 1000],
    ['1600', '1000', 300],
    ['5200', '3100', 600],
  ] as const)
    store.atomic(() =>
      store.saveTransaction(
        entry({
          lines: [
            { account_id: dr, debit_amount: amount, credit_amount: 0 },
            { account_id: cr, debit_amount: 0, credit_amount: amount },
          ],
        }),
      ),
    );
  const profit = report(store.snapshot(), 2026).profit;
  store.atomic(() =>
    store.saveTransaction(ownerSettlement(store.snapshot(), 2026, '2026-12-31', 'offset')),
  );
  expect(ownerBalances(store.snapshot(), 2026)).toEqual({ borrow: 300, lend: 0, cash: 700 });
  expect(() => ownerSettlement(store.snapshot(), 2026, '2026-12-31', 'offset')).toThrow('対象残高');
  store.atomic(() =>
    store.saveTransaction(ownerSettlement(store.snapshot(), 2026, '2026-12-31', 'cash_out')),
  );
  expect(ownerBalances(store.snapshot(), 2026)).toEqual({ borrow: 0, lend: 0, cash: 400 });
  expect(report(store.snapshot(), 2026).profit).toBe(profit);
});

it('本人からの現金補填は事業主貸を減らし、現金不足での精算や年度違いを拒否する', () => {
  store.atomic(() =>
    store.saveTransaction(
      entry({
        lines: [
          { account_id: '1600', debit_amount: 250, credit_amount: 0 },
          { account_id: '1000', debit_amount: 0, credit_amount: 250 },
        ],
      }),
    ),
  );
  const profit = report(store.snapshot(), 2026).profit;
  store.atomic(() =>
    store.saveTransaction(ownerSettlement(store.snapshot(), 2026, '2026-12-31', 'cash_in')),
  );
  expect(ownerBalances(store.snapshot(), 2026)).toEqual({ borrow: 0, lend: 0, cash: 0 });
  expect(report(store.snapshot(), 2026).profit).toBe(profit);
  store.atomic(() =>
    store.saveTransaction(
      entry({
        lines: [
          { account_id: '5200', debit_amount: 600, credit_amount: 0 },
          { account_id: '3100', debit_amount: 0, credit_amount: 600 },
        ],
      }),
    ),
  );
  expect(() => ownerSettlement(store.snapshot(), 2026, '2026-12-31', 'cash_out')).toThrow(
    '現金残高',
  );
  expect(() => ownerSettlement(store.snapshot(), 2026, '2025-12-31', 'cash_in')).toThrow();
});
