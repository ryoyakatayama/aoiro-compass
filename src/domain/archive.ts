import { z } from 'zod';
import { yearSchema } from './model';

export const archiveUrlSchema = z
  .string()
  .url()
  .max(2000)
  .refine((value) => {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      ['drive.google.com', 'docs.google.com'].includes(url.hostname) &&
      !url.username &&
      !url.password
    );
  }, 'Google DriveまたはGoogleドキュメントのHTTPS URLを指定してください');
const book = z.enum(['business', 'misc', 'common']);
const id = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
export const archiveSchema = z
  .object({
    schema_version: z.literal('1.0'),
    title: z.string().min(1).max(300),
    folder_url: archiveUrlSchema,
    documents: z
      .array(
        z.object({
          id,
          year: yearSchema,
          book,
          name: z.string().min(1).max(500),
          category: z.string().max(200),
          original_path: z.string().max(2000),
          drive_url: archiveUrlSchema,
          sha256: z.string().regex(/^[a-f0-9]{64}$/),
          text: z.string().max(30000).default(''),
          note: z.string().max(4000).default(''),
        }),
      )
      .max(5000),
    issues: z
      .array(
        z.object({
          id,
          year: yearSchema,
          book,
          title: z.string().min(1).max(500),
          detail: z.string().max(10000),
          source_ids: z.array(id).max(100),
        }),
      )
      .max(500),
  })
  .superRefine((value, ctx) => {
    for (const items of [value.documents, value.issues]) {
      if (new Set(items.map((x) => x.id)).size !== items.length)
        ctx.addIssue({ code: 'custom', message: '資料または確認事項のIDが重複しています' });
    }
    const ids = new Set(value.documents.map((d) => d.id));
    if (value.issues.some((i) => i.source_ids.some((source) => !ids.has(source))))
      ctx.addIssue({ code: 'custom', message: '確認事項の参照先資料がありません' });
  });
export type Archive = z.infer<typeof archiveSchema>;
export const archiveResponseSchema = z.object({
  status: z.enum(['open', 'reviewing', 'resolved']),
  note: z.string().max(10000),
});
export const archiveSetting = 'source_archive';
export const archiveResponsePrefix = 'source_archive_response_';
