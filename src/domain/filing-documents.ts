import { z } from 'zod';
import { yearSchema, type Snapshot } from './model';
import { archiveSchema, archiveSetting, archiveResponsePrefix } from './archive';
export const filingDocumentKinds = [
  {
    id: 'return',
    label: '送信した所得税申告書の控え',
    optional: false,
    description: '対象年の第一表・第二表・必要な明細まで含むPDF。送信した版との一致を確認。',
  },
  {
    id: 'decision',
    label: '青色申告決算書・収支内訳書',
    optional: false,
    description:
      '損益計算書と貸借対照表、減価償却等の明細。雑所得側では該当する内訳資料、または共通の申告ファイルを参照。',
  },
  {
    id: 'receipt',
    label: 'e-Tax受信通知（受付結果）',
    optional: false,
    description:
      '受付番号・受付日時・税目・対象年・受付結果を確認。申告書等送信票だけでは受付完了を確認できません。',
  },
  {
    id: 'sendlist',
    label: '申告書等送信票・追加提出の確認',
    optional: false,
    description: '別途提出が必要な書類の有無を確認。該当書類は提出控えも保存。',
  },
  {
    id: 'recovery',
    label: '申告作成ソフトの保存データ',
    optional: true,
    description:
      '作成コーナーの.data等。利用したソフトで保存できるデータを保管。作成コーナー未使用等の場合は理由を記録。',
  },
  {
    id: 'payment',
    label: '納付・還付の記録',
    optional: true,
    description:
      '送信とは別に、納付完了や口座振替、還付入金の記録を確認。納付も還付もない場合は理由を記録。',
  },
  {
    id: 'attachments',
    label: '控除・他所得・追加提出の資料',
    optional: true,
    description:
      '証明書、特定口座年間取引報告書、損失繰越等の適用資料。必要資料を一覧化したファイルやZIPでも登録可能。',
  },
] as const;
export const filingDocumentSchema = z
  .object({
    id: z.string().uuid(),
    year: yearSchema,
    kind: z.enum(filingDocumentKinds.map((k) => k.id)),
    status: z.enum(['pending', 'verified', 'na']),
    name: z.string().max(500),
    drive_id: z.string().max(200),
    sha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .or(z.literal('')),
    size: z
      .number()
      .int()
      .min(0)
      .max(25 * 1024 * 1024),
    note: z.string().max(3000),
    checked_at: z.string().datetime().or(z.literal('')),
    updated: z.string().datetime(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (
      v.status === 'verified' &&
      (!/^[a-zA-Z0-9_-]+$/.test(v.drive_id) ||
        !v.sha256 ||
        !v.checked_at ||
        !v.name ||
        !v.note.trim())
    )
      ctx.addIssue({
        code: 'custom',
        message: '読み出し確認・ファイル情報・内容確認メモが必要です',
      });
    if (
      v.status === 'na' &&
      (!filingDocumentKinds.find((k) => k.id === v.kind)?.optional || !v.note.trim())
    )
      ctx.addIssue({ code: 'custom', message: '該当なしにできる資料と理由を確認してください' });
  });
export type FilingDocument = z.infer<typeof filingDocumentSchema>;
export const filingDocumentKey = (v: FilingDocument) => `filing_document_${v.year}_${v.id}`;
export function filingDocuments(s: Snapshot, year: number) {
  return Object.entries(s.settings)
    .filter(([k]) => k.startsWith(`filing_document_${year}_`))
    .map(([, v]) => filingDocumentSchema.parse(JSON.parse(v)));
}
export function filingCompletion(s: Snapshot, year: number) {
  const docs = filingDocuments(s, year);
  return filingDocumentKinds.map((k) => ({
    ...k,
    complete: docs.some((d) => d.kind === k.id && (d.status === 'verified' || d.status === 'na')),
    documents: docs.filter((d) => d.kind === k.id),
  }));
}
export function archiveContext(s: Snapshot, years: number[]) {
  let archive;
  try {
    const p = archiveSchema.safeParse(JSON.parse(s.settings[archiveSetting] || 'null'));
    if (p.success) archive = p.data;
  } catch {
    /* Display as unavailable; never assume completeness. */
  }
  const book = s.settings.income_category || 'business';
  const matches = (x: { year: number; book: string }) =>
    years.includes(x.year) && (x.book === book || x.book === 'common');
  return {
    documents: archive?.documents.filter(matches) || [],
    assetReferences: archive?.asset_references.filter(matches) || [],
    issues: (archive?.issues.filter(matches) || []).map((i) => ({
      ...i,
      response: s.settings[archiveResponsePrefix + i.id]
        ? JSON.parse(s.settings[archiveResponsePrefix + i.id])
        : { status: 'open', note: '' },
    })),
    registered: !!archive,
  };
}
