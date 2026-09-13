import { bookKind, type BookKind } from './book';
import initSqlJs from 'sql.js';
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import { openDB } from 'idb';
import { Store } from '../db/store';
import type { Snapshot } from '../domain/model';
let SQLPromise: ReturnType<typeof initSqlJs> | undefined;
const getSQL = () => (SQLPromise ??= initSqlJs({ locateFile: () => wasmUrl }));
let backupUploader:
  ((bytes: Uint8Array, id: string, reason: string) => Promise<boolean>) | undefined;
export function configureBackupUpload(upload?: typeof backupUploader) {
  backupUploader = upload;
}
export const demoMode =
  typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('demo') === '1';
export const bookNamespace = (book: BookKind) =>
  (demoMode ? 'aoiro-compass-demo' : 'aoiro-compass') + (book === 'misc' ? '-misc' : '');
const namespace = bookNamespace(bookKind);
// Read another book without creating an Engine, writing defaults or synchronizing it.
export async function readBookSnapshot(book: BookKind): Promise<Snapshot | undefined> {
  const name = bookNamespace(book);
  return navigator.locks.request(name, async () => {
    let bytes: Uint8Array | undefined;
    if (navigator.storage?.getDirectory) {
      const root = await navigator.storage.getDirectory();
      try {
        bytes = new Uint8Array(
          await (await (await root.getFileHandle(`${name}.sqlite`)).getFile()).arrayBuffer(),
        );
      } catch (error) {
        if ((error as DOMException).name !== 'NotFoundError') throw error;
      }
    }
    if (!bytes) {
      if (indexedDB.databases && !(await indexedDB.databases()).some((d) => d.name === name))
        return undefined;
      const db = await openDB(name);
      try {
        if (db.objectStoreNames.contains('files')) bytes = await db.get('files', 'ledger');
      } finally {
        db.close();
      }
    }
    if (!bytes) return undefined;
    const store = new Store(await getSQL(), bytes);
    try {
      if ((store.setting('income_category') || 'business') !== book)
        throw new Error('比較対象の所得区分が一致しません');
      return store.snapshot();
    } finally {
      store.close();
    }
  });
}
const dbPromise = () =>
  openDB(namespace, 1, {
    upgrade(db) {
      db.createObjectStore('files');
      db.createObjectStore('backups', { keyPath: 'id' });
    },
  });
export async function putBlob(id: string, blob: Blob) {
  const db = await dbPromise();
  await db.put('files', blob, id);
}
export async function getBlob(id: string) {
  const db = await dbPromise();
  return db.get('files', id) as Promise<Blob | undefined>;
}
export async function listBackups() {
  const db = await dbPromise();
  const rows = (await db.getAll('backups')).sort((a, b) => b.created.localeCompare(a.created)) as {
    id: string;
    created: string;
    reason: string;
    bytes: Uint8Array;
  }[];
  return rows;
}
export async function saveBackup(bytes: Uint8Array, reason: string) {
  const id = `${new Date().toISOString().replace(/[:.]/g, '-')}_${crypto.randomUUID().slice(0, 8)}`;
  const db = await dbPromise();
  await db.put('backups', { id, created: new Date().toISOString(), reason, bytes });
  if (backupUploader && (await backupUploader(bytes, id, reason))) await db.delete('backups', id);
  return id;
}
export async function flushStagedBackups(upload: NonNullable<typeof backupUploader>) {
  for (const backup of await listBackups()) {
    if (await upload(backup.bytes, backup.id, backup.reason))
      await (await dbPromise()).delete('backups', backup.id);
  }
}
export async function recoverLocalCache(
  data: import('./sync-graph').SyncData,
  heads: string[],
  scope: string,
  clientId: string,
  preserve: (bytes: Uint8Array) => Promise<void>,
) {
  const { importSyncData, exportSyncData } = await import('./sync-data');
  const restored = new Store(await getSQL());
  try {
    restored.atomic(() => {
      restored.setSetting('income_category', bookKind);
      importSyncData(restored, data);
      restored.setSetting('google_client_id', clientId);
      restored.setSetting('ledger_sync_scope', scope);
      restored.setSetting(
        'ledger_sync_state',
        JSON.stringify({ heads, baseline: exportSyncData(restored), pending: [] }),
      );
    });
    restored.validate();
    const bytes = restored.export();
    await navigator.locks.request(namespace, async () => {
      if (navigator.storage?.getDirectory) {
        const root = await navigator.storage.getDirectory();
        let handle: FileSystemFileHandle | undefined;
        try {
          handle = await root.getFileHandle(`${namespace}.sqlite`);
        } catch (error) {
          if ((error as DOMException).name !== 'NotFoundError') throw error;
        }
        if (handle) await preserve(new Uint8Array(await (await handle.getFile()).arrayBuffer()));
        handle ||= await root.getFileHandle(`${namespace}.sqlite`, { create: true });
        const stream = await handle.createWritable();
        try {
          await stream.write(new Uint8Array(bytes));
          await stream.close();
        } catch (error) {
          await stream.abort().catch(() => {});
          throw error;
        }
      } else {
        const db = await dbPromise(),
          previous = await db.get('files', 'ledger');
        if (previous) await preserve(previous);
        await db.put('files', bytes, 'ledger');
      }
    });
  } finally {
    restored.close();
  }
}

export class Engine {
  store!: Store;
  mode: 'OPFS' | 'IndexedDB' = 'IndexedDB';
  private root: FileSystemDirectoryHandle | undefined;
  private queue: Promise<unknown> = Promise.resolve();
  private listeners = new Set<() => void>();
  snapshot!: Snapshot;
  private channel: BroadcastChannel | undefined;
  async init() {
    await this.lock(async () => {
      const sql = await getSQL();
      if (navigator.storage?.getDirectory) {
        this.root = await navigator.storage.getDirectory();
        this.mode = 'OPFS';
      }
      const data = await this.read();
      this.store = new Store(sql, data);
      if (!data) {
        this.store.atomic(() => {
          this.store.setSetting('income_category', bookKind);
          if (bookKind === 'misc')
            this.store.run("UPDATE accounts SET name='雑所得収入' WHERE id='4000'");
        });
        await this.persist(this.store.export());
      }
      this.snapshot = this.store.snapshot();
    });
    if (typeof BroadcastChannel !== 'undefined') {
      this.channel = new BroadcastChannel(namespace);
      this.channel.onmessage = () => {
        void this.refresh().catch(console.error);
      };
    }
    return this;
  }
  private async read(): Promise<Uint8Array | undefined> {
    if (this.root) {
      try {
        const h = await this.root.getFileHandle(`${namespace}.sqlite`);
        return new Uint8Array(await (await h.getFile()).arrayBuffer());
      } catch (e) {
        if ((e as DOMException).name === 'NotFoundError') return undefined;
        throw e;
      }
    }
    const db = await dbPromise();
    return db.get('files', 'ledger');
  }
  private async persist(bytes: Uint8Array) {
    if (this.root) {
      const h = await this.root.getFileHandle(`${namespace}.sqlite`, { create: true });
      const w = await h.createWritable();
      try {
        await w.write(new Uint8Array(bytes));
        await w.close();
      } catch (e) {
        await w.abort().catch(() => {});
        throw e;
      }
    } else {
      const db = await dbPromise();
      await db.put('files', bytes, 'ledger');
    }
  }
  private lock<T>(fn: () => Promise<T>) {
    if (!navigator.locks)
      throw new Error(
        '安全な保存のためWeb Locks対応ブラウザ（最新のChrome / Edge / Safari）を使用してください',
      );
    return navigator.locks.request(namespace, fn);
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getSnapshot = () => this.snapshot;
  private notify() {
    this.snapshot = this.store.snapshot();
    this.listeners.forEach((fn) => fn());
  }
  async refresh() {
    await this.serial(() =>
      this.lock(async () => {
        const data = await this.read();
        if (data) {
          const fresh = new Store(await getSQL(), data);
          this.store.close();
          this.store = fresh;
          this.notify();
        }
      }),
    );
  }
  private serial<T>(fn: () => Promise<T>) {
    const next = this.queue.then(fn, fn);
    this.queue = next.catch(() => {});
    return next;
  }
  async write<T>(
    fn: (store: Store) => T,
    backupReason?: string | ((store: Store) => string | undefined),
  ): Promise<T> {
    return this.serial(() =>
      this.lock(async () => {
        const data = await this.read();
        const fresh = new Store(await getSQL(), data);
        try {
          const reason = typeof backupReason === 'function' ? backupReason(fresh) : backupReason;
          if (reason) await saveBackup(fresh.export(), reason);
          const result = fresh.atomic(() => {
            const result = fn(fresh);
            fresh.setSetting('revision', String(Number(fresh.setting('revision') || '0') + 1));
            return result;
          });
          await this.persist(fresh.export());
          this.store.close();
          this.store = fresh;
          this.notify();
          this.channel?.postMessage('changed');
          return result;
        } catch (e) {
          fresh.close();
          throw e;
        }
      }),
    );
  }
  async backup(reason = '手動バックアップ') {
    return this.serial(() =>
      this.lock(async () => {
        const bytes = (await this.read()) || this.store.export();
        const id = await saveBackup(bytes, reason);
        const fresh = new Store(await getSQL(), bytes);
        const snapshot = fresh.snapshot();
        fresh.close();
        return { id, bytes, snapshot };
      }),
    );
  }
  async restore(bytes: Uint8Array) {
    return this.serial(() =>
      this.lock(async () => {
        if (bytes.length > 100 * 1024 * 1024)
          throw new Error('100MB以下のSQLiteを指定してください');
        const restored = new Store(await getSQL(), bytes);
        try {
          restored.validate();
          if ((restored.setting('income_category') || 'business') !== bookKind)
            throw new Error(
              'バックアップの所得区分が違います。該当する帳簿に切り替えて復元してください',
            );
          const beforeBytes = (await this.read()) || this.store.export();
          await saveBackup(beforeBytes, '復元前');
          const previous = new Store(await getSQL(), beforeBytes);
          try {
            if (previous.setting('ledger_sync_scope')) {
              if (
                restored.setting('ledger_sync_scope') &&
                restored.setting('ledger_sync_scope') !== previous.setting('ledger_sync_scope')
              )
                throw new Error(
                  '異なるGoogleアカウントの同期済みバックアップは、この帳簿に復元できません',
                );
              restored.atomic(() => {
                restored.run("DELETE FROM settings WHERE key GLOB 'ledger_sync_*'");
                for (const row of previous.all(
                  "SELECT key,value FROM settings WHERE key GLOB 'ledger_sync_*'",
                ))
                  restored.setSetting(String(row.key), String(row.value));
              });
            }
          } finally {
            previous.close();
          }
          restored.atomic(() => restored.event('database_restored', 'database'));
          await this.persist(restored.export());
          this.store.close();
          this.store = restored;
          this.notify();
          this.channel?.postMessage('changed');
        } catch (e) {
          restored.close();
          throw e;
        }
      }),
    );
  }
  async persistenceStatus() {
    return {
      persisted: await navigator.storage?.persisted?.(),
      estimate: await navigator.storage?.estimate?.(),
    };
  }
}
export function download(
  name: string,
  data: Blob | string | Uint8Array,
  type = 'application/octet-stream',
) {
  const blob =
    data instanceof Blob
      ? data
      : new Blob([typeof data === 'string' ? data : new Uint8Array(data)], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
export async function sha256(data: Blob | Uint8Array | string) {
  const bytes =
    typeof data === 'string'
      ? new TextEncoder().encode(data)
      : data instanceof Blob
        ? new Uint8Array(await data.arrayBuffer())
        : new Uint8Array(data);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((x) => x.toString(16).padStart(2, '0')).join('');
}
