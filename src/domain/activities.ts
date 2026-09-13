import { z } from 'zod';
import { yearSchema, type Snapshot } from './model';
export const activityPrefix = 'income_activity_';
export const activitySchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().trim().min(1).max(200),
    from_year: yearSchema,
    to_year: yearSchema.nullable(),
    category: z.string().max(300),
    description: z.string().max(3000),
    income_source: z.string().max(1500),
    expenses: z.string().max(1500),
    allocation: z.string().max(1500),
    note: z.string().max(1000),
    archived: z.boolean().default(false),
    updated: z.string().datetime(),
  })
  .strict()
  .refine((v) => v.to_year === null || v.to_year >= v.from_year, '終了年を開始年以降にしてください')
  .refine((v) => JSON.stringify(v).length <= 9500, '活動情報を9500文字以内にまとめてください');
export type IncomeActivity = z.infer<typeof activitySchema>;
export function validateActivity(key: string, value: string) {
  const v = activitySchema.parse(JSON.parse(value));
  if (key !== activityPrefix + v.id) throw new Error('活動情報の識別子が一致しません');
  return v;
}
export function incomeActivities(s: Snapshot, years?: number[]) {
  return Object.entries(s.settings)
    .filter(([k]) => k.startsWith(activityPrefix))
    .map(([k, v]) => validateActivity(k, v))
    .filter(
      (a) =>
        !a.archived &&
        (!years || years.some((y) => y >= a.from_year && (a.to_year === null || y <= a.to_year))),
    );
}
