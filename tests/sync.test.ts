import { beforeAll, beforeEach, expect, it, vi } from 'vitest';
import initSqlJs, { type SqlJsStatic } from 'sql.js';
import { createRequire } from 'node:module';
import { Store } from '../src/db/store';
import { newId } from '../src/domain/model';
import { canonical, materialize, type Revision } from '../src/lib/sync-graph';
import { exportSyncData, importSyncData } from '../src/lib/sync-data';
vi.mock('../src/lib/persistence', () => ({
  demoMode: false,
  Engine: class {},
  flushStagedBackups: async () => {},
}));
import { LedgerSync } from '../src/lib/ledger-sync';
const require = createRequire(import.meta.url);
let SQL: SqlJsStatic;
beforeAll(async () => {
  SQL = await initSqlJs({ locateFile: () => require.resolve('sql.js/dist/sql-wasm.wasm') });
});
beforeEach(() => {
  vi.stubGlobal('navigator', {
    onLine: true,
    locks: { request: async (_name: string, fn: () => unknown) => fn() },
  });
});
const rev = (changes: Revision['changes'], parents: string[] = [], device = 'PC'): Revision => ({
  format: 'aoiro-sync-1',
  id: newId(),
  book: 'business',
  device,
  created: new Date().toISOString(),
  parents,
  changes,
});
it('unrelated concurrent additions converge independent of arrival order', () => {
  const a = rev({ 'accounts:x': { id: 'x' } }),
    b = rev({ 'accounts:y': { id: 'y' } });
  expect(materialize([a, b]).conflicts).toHaveLength(0);
  expect(canonical(materialize([a, b]).data)).toBe(canonical(materialize([b, a]).data));
});
it('concurrent edits and edit versus deletion remain alternatives until explicitly resolved', () => {
  const root = rev({ x: 'first' }),
    a = rev({ x: 'edit' }, [root.id]),
    b = rev({ x: null }, [root.id], 'phone');
  const m = materialize([a, root, b]);
  expect(m.conflicts).toHaveLength(1);
  const resolution = rev({ x: 'edit' }, m.heads);
  expect(materialize([b, resolution, root, a]).data.x).toBe('edit');
  expect(materialize([b, resolution, root, a]).conflicts).toHaveLength(0);
});
it('duplicate retries are idempotent and missing or cyclic ancestry fails closed', () => {
  const a = rev({ x: 'v' });
  expect(materialize([a, a]).data.x).toBe('v');
  expect(() => materialize([rev({ x: 'v' }, [newId()])])).toThrow('履歴');
  expect(() => materialize([{ ...a, parents: [a.id] }])).toThrow('循環');
  expect(() => materialize([a, { ...a, changes: { x: 'tampered' } }])).toThrow('異なる');
});
class MemoryEngine {
  store = new Store(SQL);
  snapshot = this.store.snapshot();
  backups = 0;
  async write<T>(fn: (s: Store) => T, reason?: string | ((s: Store) => string | undefined)) {
    if (typeof reason === 'function' ? reason(this.store) : reason) this.backups++;
    const result = this.store.atomic(() => fn(this.store));
    this.snapshot = this.store.snapshot();
    return result;
  }
}
function devices() {
  const cloud: Revision[] = [];
  const drive = {
    connected: true,
    syncScope: 'client:owner',
    flushQueue: async () => 0,
    storeBackup: async () => ({ id: 'backup' }),
    listRevisions: async () => cloud.map((d) => ({ id: d.id })),
    readRevision: async (f: { id: string }) => structuredClone(cloud.find((d) => d.id === f.id)!),
    appendRevision: async (d: Revision) => {
      cloud.push(structuredClone(d));
    },
  };
  const a = new MemoryEngine(),
    b = new MemoryEngine();
  const sa = new LedgerSync(a as any, drive as any),
    sb = new LedgerSync(b as any, drive as any);
  return { a, b, sa, sb, cloud, drive };
}
const entry = (description: string) => ({
  id: newId(),
  year: new Date().getFullYear(),
  transaction_date: `${new Date().getFullYear()}-01-01`,
  description,
  status: 'draft',
  source: 'manual',
  lines: [
    { account_id: '5200', debit_amount: 123, credit_amount: 0 },
    { account_id: '3100', debit_amount: 0, credit_amount: 123 },
  ],
});
it('real SQLite ledgers synchronize entries, new accounts, profile and deletions', async () => {
  const { a, b, sa, sb, cloud } = devices();
  await a.write((st) => {
    st.addAccount({ code: '6800', name: '研修費', type: 'expense' });
    st.saveProfile({ industry: 'IT' });
    st.saveTransaction(entry('PC入力'));
    st.setSetting('google_client_id', 'DO_NOT_UPLOAD');
  });
  await sa.sync();
  await sb.sync();
  await sa.sync();
  expect(b.snapshot.transactions[0].description).toBe('PC入力');
  expect(b.snapshot.accounts.some((v) => v.code === '6800')).toBe(true);
  expect(b.snapshot.profile.industry).toBe('IT');
  expect(JSON.stringify(cloud)).not.toContain('DO_NOT_UPLOAD');
  await b.write((st) => st.deleteDraft(b.snapshot.transactions[0].id));
  await sb.sync();
  await sa.sync();
  expect(a.snapshot.transactions).toHaveLength(0);
  const count = cloud.length,
    backups = a.backups;
  await sa.sync();
  expect(cloud.length).toBe(count);
  expect(a.backups).toBe(backups);
});
it('offline changes on separate devices are retained and merged', async () => {
  const { a, b, sa, sb } = devices();
  await sa.sync();
  await sb.sync();
  await sa.sync();
  await a.write((st) => st.saveTransaction(entry('PC')));
  await b.write((st) => st.saveTransaction(entry('phone')));
  await Promise.all([sa.sync(), sb.sync()]);
  await sa.sync();
  await sb.sync();
  expect(a.snapshot.transactions).toHaveLength(2);
  expect(b.snapshot.transactions).toHaveLength(2);
});
it('same journal edits preserve both versions and resolve via an explicit choice', async () => {
  const { a, b, sa, sb } = devices();
  await a.write((st) => st.saveTransaction(entry('original')));
  await sa.sync();
  await sb.sync();
  await sa.sync();
  await a.write((st) =>
    st.saveTransaction({ ...a.snapshot.transactions[0], description: 'PC correction' }),
  );
  await b.write((st) =>
    st.saveTransaction({ ...b.snapshot.transactions[0], description: 'phone correction' }),
  );
  await sa.sync();
  await sb.sync();
  await sa.sync();
  expect(sa.getSnapshot().phase).toBe('conflict');
  expect(a.snapshot.transactions[0].description).toBe('PC correction');
  expect(b.snapshot.transactions[0].description).toBe('phone correction');
  const choices = Object.fromEntries(
    sa
      .getSnapshot()
      .conflicts.map((c) => [
        c.key,
        c.variants.find((v) => canonical(v.value).includes('phone correction'))!.revision,
      ]),
  );
  await sa.resolve(choices);
  await sb.sync();
  expect(a.snapshot.transactions[0].description).toBe('phone correction');
  expect(b.snapshot.transactions[0].description).toBe('phone correction');
});
it('lost cloud history and account switching never erase the local book', async () => {
  const { a, sa, cloud, drive } = devices();
  await a.write((st) => st.saveTransaction(entry('retain')));
  await sa.sync();
  cloud.length = 0;
  await sa.sync();
  expect(sa.getSnapshot().phase).toBe('error');
  expect(a.snapshot.transactions).toHaveLength(1);
  drive.syncScope = 'different:account';
  await sa.sync();
  expect(sa.getSnapshot().phase).toBe('error');
  expect(cloud).toHaveLength(0);
});
it('invalid incoming rows rollback the whole merge, and local settings remain private', () => {
  const a = new Store(SQL),
    b = new Store(SQL);
  a.atomic(() => a.saveTransaction(entry('good')));
  b.atomic(() => b.setSetting('google_client_id', 'private-device-setting'));
  const data = exportSyncData(a);
  b.atomic(() => importSyncData(b, data));
  expect(b.setting('google_client_id')).toBe('private-device-setting');
  const before = canonical(exportSyncData(b));
  expect(() =>
    b.atomic(() => importSyncData(b, { ...data, 'evil:sql': { value: 'DROP TABLE accounts' } })),
  ).toThrow('未対応');
  expect(canonical(exportSyncData(b))).toBe(before);
});
it('confirmed edits are atomic and stale revisions cannot overwrite newer work', () => {
  const s = new Store(SQL);
  s.atomic(() => s.saveTransaction({ ...entry('confirmed'), status: 'confirmed' }));
  const old = s.snapshot().transactions[0];
  expect(() => s.atomic(() => s.reviseTransaction({ ...old, description: 'bad' }, ''))).toThrow(
    '理由',
  );
  expect(s.snapshot().transactions[0].status).toBe('confirmed');
  s.atomic(() => s.reviseTransaction({ ...old, description: 'corrected' }, '誤入力の訂正'));
  expect(s.snapshot().transactions[0].description).toBe('corrected');
  expect(() =>
    s.atomic(() => s.reviseTransaction({ ...old, description: 'stale' }, '訂正')),
  ).toThrow('更新');
});
