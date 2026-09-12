import { z } from 'zod';

export const moneySchema = z.number().int().min(0).max(1_000_000_000_000);
export const signedMoneySchema = z.number().int().min(-1_000_000_000_000).max(1_000_000_000_000);
export const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (v) => !isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v,
    '実在する日付を入力してください',
  );
export const yearSchema = z.number().int().min(1900).max(2200);
export const lineSchema = z
  .object({
    account_id: z.string().min(1),
    debit_amount: moneySchema,
    credit_amount: moneySchema,
    tax_category: z.string().max(100).default('対象外'),
    memo: z.string().max(2000).default(''),
  })
  .refine(
    (l) => !(l.debit_amount > 0 && l.credit_amount > 0),
    '同じ明細に借方と貸方を同時に入力できません',
  );
export const transactionSchema = z.object({
  id: z.string().uuid(),
  year: yearSchema,
  transaction_date: dateSchema,
  description: z.string().trim().min(1).max(2000),
  status: z.enum(['draft', 'confirmed', 'locked']),
  source: z.string().max(100).default('manual'),
  kind: z.enum(['normal', 'opening']).default('normal'),
  lines: z.array(lineSchema).min(2).max(100),
  evidence_ids: z.array(z.string().uuid()).max(100).default([]),
  updated_at: z.string().optional(),
});
export type JournalLine = z.infer<typeof lineSchema>;
export type Transaction = z.infer<typeof transactionSchema>;
export type AccountType = 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
export interface Account {
  id: string;
  code: string;
  name: string;
  type: AccountType;
  is_active: number;
}
export interface FiscalYear {
  year: number;
  status: 'active' | 'closed' | 'historical_import';
  data_completeness: 'full' | 'ledger' | 'summary_only' | 'ledger_and_evidence';
  locked_at: string | null;
}
export interface Evidence {
  id: string;
  year: number;
  drive_file_id: string | null;
  filename: string;
  mime_type: string;
  size_bytes: number;
  sha256: string;
  original_sha256: string;
  modified_time: string | null;
  status: string;
  capture_source: string;
  hint: string;
  payment_account: string;
  note: string;
  indexed_at: string;
}
export const profileSchema = z.object({
  business_name: z.string().max(200).default(''),
  industry: z.string().max(200).default(''),
  description: z.string().max(6000).default(''),
  customers: z.string().max(2000).default(''),
  revenue_model: z.string().max(2000).default(''),
  work_style: z.string().max(2000).default(''),
  expenses: z.string().max(2000).default(''),
  private_use: z.string().max(2000).default(''),
  employees: z.string().max(1000).default(''),
  tax_status: z.string().max(1000).default('未確認'),
  invoice_status: z.string().max(1000).default('未確認'),
  accounting_policy: z.string().max(2000).default('税込経理'),
  concerns: z.string().max(4000).default(''),
});
export type Profile = z.infer<typeof profileSchema>;
export const assetSchema = z
  .object({
    id: z.string().uuid(),
    year: yearSchema,
    name: z.string().trim().min(1).max(300),
    acquisition_date: dateSchema,
    in_service_date: dateSchema,
    acquisition_cost: moneySchema.positive(),
    asset_class: z.string().min(1).max(100),
    useful_life_years: z.number().int().min(1).max(100),
    depreciation_method: z.literal('manual'),
    business_use_ratio: z.number().min(0).max(100),
    disposed_at: dateSchema.nullable().default(null),
    note: z.string().max(3000).default(''),
  })
  .refine((a) => a.in_service_date >= a.acquisition_date, '供用日は取得日以降にしてください');
export type Asset = z.infer<typeof assetSchema>;
export interface Depreciation {
  id: string;
  asset_id: string;
  year: number;
  opening_book_value: number;
  depreciation_amount: number;
  closing_book_value: number;
  rule_version: string;
  calculation: string;
  transaction_id: string | null;
}
export const extractionSchema = z.object({
  schema_version: z.literal('1.0'),
  evidence_id: z.string().uuid(),
  transaction_date: dateSchema,
  vendor: z.string().min(1).max(500),
  gross_amount: moneySchema.positive(),
  currency: z.literal('JPY'),
  suggested_account: z.string().min(1).max(100),
  payment_method: z.string().max(200).default(''),
  confidence: z.number().min(0).max(1),
  warnings: z.array(z.string().max(2000)).max(100).default([]),
  line_items: z.array(z.object({ description: z.string(), amount: moneySchema })).default([]),
  tax_summary: z.array(z.object({ rate: z.number(), amount: moneySchema })).default([]),
  invoice_registration_number: z.string().nullable().default(null),
});
export type Extraction = z.infer<typeof extractionSchema> & {
  id: string;
  status: string;
  transaction_id: string | null;
};
export const reviewTypes = [
  'pre_filing',
  'expense',
  'fixed_asset',
  'individual',
  'historical',
  'multi_year',
  'continuity',
] as const;
export const findingStatuses = ['new', 'reviewing', 'resolved', 'dismissed', 'deferred'] as const;
export const findingSchema = z.object({
  finding_id: z.string().min(1).max(100),
  severity: z.enum(['high', 'medium', 'low', 'info']),
  category: z.string().max(100),
  title: z.string().min(1).max(500),
  description: z.string().max(10000),
  reasoning_summary: z.string().max(10000),
  suggested_action: z.string().max(10000),
  affected_transaction_ids: z.array(z.string().uuid()).max(1000).default([]),
  requested_evidence_ids: z.array(z.string().uuid()).max(1000).default([]),
  suggested_draft_change: z
    .object({
      transaction_date: dateSchema,
      description: z.string().min(1).max(2000),
      lines: z.array(lineSchema).min(2).max(100),
    })
    .nullable()
    .default(null),
  confidence: z.number().min(0).max(1),
  requires_human_judgment: z.boolean(),
  current_law_verification_required: z.boolean(),
});
export const auditResultSchema = z.object({
  schema_version: z.literal('1.0'),
  audit_id: z.string().uuid(),
  review_type: z.enum(reviewTypes),
  summary: z.object({
    overall_assessment: z.string().max(10000),
    high: z.number().int().min(0),
    medium: z.number().int().min(0),
    low: z.number().int().min(0),
  }),
  findings: z.array(findingSchema).max(500),
  requested_evidence_ids: z.array(z.string().uuid()).max(1000).default([]),
  limitations: z.array(z.string().max(4000)).max(100).default([]),
});
export type Finding = z.infer<typeof findingSchema> & {
  id: string;
  audit_id: string;
  status: (typeof findingStatuses)[number];
  resolution_note: string;
};
export interface Audit {
  id: string;
  review_type: (typeof reviewTypes)[number];
  target_years: number[];
  law_basis_years: number[];
  created_at: string;
  status: string;
  question: string;
  summary: string;
  requested_evidence_ids: string[];
}
export interface Message {
  id: string;
  audit_id: string;
  finding_id: string | null;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
  reply_to: string | null;
}
export const replySchema = z.object({
  schema_version: z.literal('1.0'),
  audit_id: z.string().uuid(),
  messages: z
    .array(
      z.object({
        message_id: z.string().uuid(),
        finding_id: z.string().nullable(),
        reply_to: z.string().uuid(),
        content: z.string().min(1).max(20000),
      }),
    )
    .min(1)
    .max(100),
});
export interface BankEntry {
  id: string;
  year: number;
  batch_id: string;
  transaction_date: string;
  description: string;
  amount: number;
  account_id: string;
  reconciliation_status: string;
  transaction_id: string | null;
}
export interface AuditEvent {
  id: string;
  event_type: string;
  entity_id: string;
  occurred_at: string;
  payload_json: string;
}
export interface Snapshot {
  years: FiscalYear[];
  accounts: Account[];
  transactions: Transaction[];
  evidences: Evidence[];
  extractions: Extraction[];
  assets: Asset[];
  depreciations: Depreciation[];
  banks: BankEntry[];
  audits: Audit[];
  findings: Finding[];
  messages: Message[];
  profile: Profile;
  settings: Record<string, string>;
  events: AuditEvent[];
  historicalSummaries: Record<string, HistoricalSummary>;
}
export const historicalSummarySchema = z.object({
  revenue: moneySchema,
  expense: moneySchema,
  balance_sheet: z
    .array(
      z.object({ account_id: z.string(), debit_amount: moneySchema, credit_amount: moneySchema }),
    )
    .default([]),
  monthly: z
    .array(
      z.object({
        month: z.number().int().min(1).max(12),
        revenue: signedMoneySchema.nullable(),
        expense: signedMoneySchema.nullable(),
      }),
    )
    .max(12)
    .default([]),
});
export type HistoricalSummary = z.infer<typeof historicalSummarySchema>;
export const historicalSchema = z.object({
  schema_version: z.literal('1.0'),
  book: z.enum(['business', 'misc']).optional(),
  year: yearSchema,
  data_completeness: z.enum(['summary_only', 'ledger', 'ledger_and_evidence', 'full']),
  accounts: z
    .array(
      z.object({
        id: z.string().min(1),
        code: z.string(),
        name: z.string().min(1),
        type: z.enum(['asset', 'liability', 'equity', 'revenue', 'expense']),
        is_active: z.number().int().min(0).max(1).default(1),
      }),
    )
    .default([]),
  transactions: z.array(transactionSchema).max(100000).default([]),
  summary: historicalSummarySchema.optional(),
  assets: z.array(assetSchema).default([]),
});
export const newId = () => crypto.randomUUID();
export const now = () => new Date().toISOString();
export const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
export const yen = (n: number) =>
  new Intl.NumberFormat('ja-JP', {
    style: 'currency',
    currency: 'JPY',
    maximumFractionDigits: 0,
  }).format(n);
export const monthDay = (s: string) => `${Number(s.slice(5, 7))}/${Number(s.slice(8, 10))}`;
export const labels: Record<string, string> = {
  active: '記帳中',
  closed: '締め済み',
  historical_import: '過年度・閲覧専用',
  draft: '下書き',
  confirmed: '確定',
  locked: 'ロック',
  indexed: '未処理',
  queued: 'アップロード待ち',
  ai_imported: 'AI確認待ち',
  missing: '原本が見つかりません',
  modified: '原本変更あり',
  duplicate: '重複候補',
  ignored: '対象外',
  new: '未確認',
  reviewing: '対話・確認中',
  resolved: '解決',
  dismissed: '対象外',
  deferred: '保留',
  high: '優先確認',
  medium: '確認推奨',
  low: '参考',
  info: 'ヒント',
  pre_filing: '申告前の総合レビュー',
  expense: '経費のチェック',
  fixed_asset: '固定資産の確認',
  individual: '個別の税務相談',
  historical: '過年度のレビュー',
  multi_year: '年度をまたぐ比較',
  continuity: '期首・期末のつながり',
  asset: '資産',
  liability: '負債',
  equity: '純資産',
  revenue: '収益',
  expense_type: '費用',
};
