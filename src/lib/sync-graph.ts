import { z } from 'zod';

const scalar = z.union([z.string().max(8_000_000), z.number().finite(), z.null()]);
const row = z.record(z.string(), scalar);
export const entitySchema = z.union([
  row,
  z.object({ row, lines: z.array(row).max(100), links: z.array(row).max(100) }).strict(),
  z.string().max(10000),
]);
export type Entity = z.infer<typeof entitySchema>;
export type SyncData = Record<string, Entity>;
export const revisionSchema = z
  .object({
    format: z.literal('aoiro-sync-1'),
    id: z.string().uuid(),
    book: z.enum(['business', 'misc']),
    device: z.string().max(100),
    created: z.string().datetime(),
    parents: z.array(z.string().uuid()).max(10000),
    changes: z.record(z.string().max(200), entitySchema.nullable()),
  })
  .strict();
export type Revision = z.infer<typeof revisionSchema>;
export function canonical(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  return (
    '{' +
    Object.keys(value)
      .sort()
      .map((k) => JSON.stringify(k) + ':' + canonical((value as Record<string, unknown>)[k]))
      .join(',') +
    '}'
  );
}
export function changesBetween(base: SyncData, next: SyncData) {
  const changes: Record<string, Entity | null> = Object.create(null);
  for (const key of new Set([...Object.keys(base), ...Object.keys(next)])) {
    if (canonical(base[key]) !== canonical(next[key])) changes[key] = next[key] ?? null;
  }
  return changes;
}
export interface Variant {
  revision: string;
  device: string;
  created: string;
  value: Entity | null;
}
export interface SyncConflict {
  key: string;
  variants: Variant[];
}

// Immutable revisions form a causal graph. Concurrent writes remain explicit alternatives.
// No wall clock is used to choose a winner, and deletions are retained as tombstones.
export function materialize(input: Revision[]) {
  const docs = new Map<string, Revision>();
  for (const doc of input) {
    if (docs.has(doc.id) && canonical(docs.get(doc.id)) !== canonical(doc))
      throw new Error('同じ同期IDに異なるデータがあります');
    docs.set(doc.id, doc);
  }
  const degree = new Map<string, number>(),
    children = new Map<string, string[]>();
  for (const doc of docs.values()) {
    degree.set(doc.id, new Set(doc.parents).size);
    for (const p of new Set(doc.parents)) {
      if (!docs.has(p))
        throw new Error(
          '同期履歴の一部が見つかりません。GoogleアカウントとClient IDを確認してください',
        );
      children.set(p, [...(children.get(p) || []), doc.id]);
    }
  }
  const queue = [...docs.keys()].filter((id) => degree.get(id) === 0).sort();
  const order: string[] = [];
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i];
    order.push(id);
    for (const child of children.get(id) || []) {
      degree.set(child, degree.get(child)! - 1);
      if (degree.get(child) === 0) queue.push(child);
    }
  }
  if (order.length !== docs.size) throw new Error('同期履歴に循環があります');
  const ancestor = (older: string, newer: string) => {
    const seen = new Set<string>(),
      pending = [newer];
    while (pending.length) {
      const id = pending.pop()!;
      if (id === older) return true;
      if (!seen.has(id)) {
        seen.add(id);
        pending.push(...docs.get(id)!.parents);
      }
    }
    return false;
  };
  const registers = new Map<string, Variant[]>();
  for (const id of order) {
    const d = docs.get(id)!;
    for (const [key, value] of Object.entries(d.changes)) {
      const concurrent = (registers.get(key) || []).filter((v) => !ancestor(v.revision, id));
      registers.set(key, [
        ...concurrent,
        { revision: id, device: d.device, created: d.created, value },
      ]);
    }
  }
  const data: SyncData = Object.create(null),
    conflicts: SyncConflict[] = [];
  for (const [key, variants] of registers) {
    const unique = [...new Map(variants.map((v) => [canonical(v.value), v])).values()];
    if (unique.length > 1) conflicts.push({ key, variants: unique });
    else if (unique[0].value !== null) data[key] = unique[0].value;
  }
  return { data, conflicts, heads: [...docs.keys()].filter((id) => !children.has(id)).sort() };
}
