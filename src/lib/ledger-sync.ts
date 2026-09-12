import { newId, now } from '../domain/model';
import { archiveSetting, archiveResponsePrefix } from '../domain/archive';
import type { Store } from '../db/store';
import { Engine, demoMode, flushStagedBackups } from './persistence';
import { bookKind } from './book';
import { DriveAdapter } from './drive';
import { exportSyncData, importSyncData } from './sync-data';
import {
  canonical,
  changesBetween,
  materialize,
  revisionSchema,
  type Entity,
  type Revision,
  type SyncConflict,
  type SyncData,
} from './sync-graph';

interface State {
  heads: string[];
  baseline: SyncData;
  pending: Revision[];
}
const readState = (s: Store): State =>
  JSON.parse(s.setting('ledger_sync_state') || '{"heads":[],"baseline":{},"pending":[]}');
const saveState = (s: Store, state: State) =>
  s.setSetting('ledger_sync_state', JSON.stringify(state));
// Earlier versions staged oversized archive strings before validation failed.
// Only these invalid, never-uploadable values are upgraded; valid revisions keep their bytes.
export function upgradePendingArchives(pending: Revision[]) {
  for (const doc of pending)
    for (const [key, value] of Object.entries(doc.changes))
      if (
        (key === 'shared:' + archiveSetting || key.startsWith('shared:' + archiveResponsePrefix)) &&
        typeof value === 'string' &&
        value.length > 10000
      )
        doc.changes[key] = { kind: 'source_archive_setting', value };
}
export type SyncStatus = {
  phase: 'off' | 'waiting' | 'syncing' | 'synced' | 'conflict' | 'error';
  message: string;
  conflicts: SyncConflict[];
  last: string;
};
export class LedgerSync {
  private status: SyncStatus = {
    phase: 'off',
    message: 'Google Driveに接続すると自動同期します',
    conflicts: [],
    last: '',
  };
  private listeners = new Set<() => void>();
  private running?: Promise<void>;
  private remote: Revision[] = [];
  constructor(
    private engine: Engine,
    private drive: DriveAdapter,
  ) {}
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  getSnapshot = () => this.status;
  markDirty() {
    this.update({
      phase: 'waiting',
      message: 'この端末の変更はDrive未保存です。接続中は自動保存します',
    });
  }
  private update(patch: Partial<SyncStatus>) {
    this.status = { ...this.status, ...patch };
    this.listeners.forEach((fn) => fn());
  }
  private make(
    store: Store,
    changes: Record<string, Entity | null>,
    parents: string[],
  ): Revision[] {
    let device = store.setting('ledger_sync_device');
    if (!device) {
      device = newId();
      store.setSetting('ledger_sync_device', device);
    }
    const name = store.setting('ledger_sync_device_name') || `端末 ${device.slice(0, 6)}`;
    const docs: Revision[] = [];
    let chunk: Record<string, Entity | null> = Object.create(null),
      size = 0;
    const flush = () => {
      if (!Object.keys(chunk).length) return;
      const d: Revision = {
        format: 'aoiro-sync-1',
        id: newId(),
        book: bookKind,
        device: name,
        created: now(),
        parents,
        changes: chunk,
      };
      docs.push(d);
      parents = [d.id];
      chunk = Object.create(null);
      size = 0;
    };
    for (const [k, v] of Object.entries(changes)) {
      const bytes = new TextEncoder().encode(canonical(v)).length;
      if (size + bytes > 1_000_000) flush();
      chunk[k] = v;
      size += bytes;
    }
    flush();
    return docs;
  }
  private freeze(store: Store) {
    const scope = this.drive.syncScope;
    if (!scope) throw new Error('Google Driveに再接続してください');
    if (store.setting('ledger_sync_scope') && store.setting('ledger_sync_scope') !== scope)
      throw new Error('同期先のアカウントが違います');
    store.setSetting('ledger_sync_scope', scope);
    const state = readState(store),
      data = exportSyncData(store);
    upgradePendingArchives(state.pending);
    const docs = this.make(store, changesBetween(state.baseline, data), state.heads);
    if (docs.length) {
      state.pending.push(...docs);
      state.heads = [docs.at(-1)!.id];
      state.baseline = data;
    }
    saveState(store, state);
    return state;
  }
  sync() {
    if (this.running) return this.running;
    this.running = this.perform()
      .catch((error) => {
        this.update({ phase: 'error', message: (error as Error).message });
      })
      .finally(() => {
        this.running = undefined;
      });
    return this.running;
  }
  private async perform() {
    if (demoMode || this.engine.snapshot.settings.ledger_sync_enabled === '0') {
      this.update({ phase: 'off', message: '帳簿の自動同期は停止中' });
      return;
    }
    if (!this.drive.connected || !navigator.onLine) {
      this.update({
        phase: 'waiting',
        message: navigator.onLine
          ? 'Google Driveに接続すると自動同期を再開します'
          : 'オフラインの変更は再接続後に同期します',
      });
      return;
    }
    await navigator.locks.request(`aoiro-ledger-sync-${bookKind}`, async () => {
      this.update({ phase: 'syncing', message: '帳簿の変更を同期しています' });
      // Read and validate the cloud before uploading anything from a newly connected device.
      const files = await this.drive.listRevisions();
      if (files.length > 50000)
        throw new Error('同期履歴が5万件を超えました。整理前にバックアップしてください');
      const docs: Revision[] = [];
      for (const file of files) docs.push(await this.drive.readRevision(file));
      materialize(docs);
      // Originals must have stable Drive IDs before their metadata is shared.
      const years = [
        ...new Set(
          this.engine.snapshot.evidences
            .filter((e) => !e.drive_file_id && e.status !== 'ignored')
            .map((e) => e.year),
        ),
      ];
      for (const year of years) await this.drive.flushQueue(year);
      const state = await this.engine.write((st) => this.freeze(st));
      const known = new Map(docs.map((d) => [d.id, d]));
      for (const doc of state.pending) {
        revisionSchema.parse(doc);
        if (known.has(doc.id) && canonical(known.get(doc.id)) !== canonical(doc))
          throw new Error('同期IDの内容が一致しません');
        if (!known.has(doc.id)) {
          await this.drive.appendRevision(doc);
          docs.push(doc);
          known.set(doc.id, doc);
        }
      }
      if (state.heads.some((id) => !known.has(id)))
        throw new Error(
          'この端末が同期した履歴がDriveにありません。接続先を確認してください。空の帳簿では上書きしません',
        );
      // Missing ancestors are never treated as deleted entries or an empty remote ledger.
      const merged = materialize(docs);
      this.remote = docs;
      await this.engine.write((st) => {
        const current = readState(st);
        current.pending = current.pending.filter((d) => !known.has(d.id));
        saveState(st, current);
      });
      if (merged.conflicts.length) {
        this.update({
          phase: 'conflict',
          message: `${merged.conflicts.length}件の変更が重なっています。両方を保管して確認を待っています`,
          conflicts: merged.conflicts,
        });
        return;
      }
      let applied = false;
      await this.engine.write(
        (st) => {
          const current = readState(st),
            local = exportSyncData(st);
          if (Object.keys(changesBetween(current.baseline, local)).length || current.pending.length)
            return;
          if (canonical(local) !== canonical(merged.data)) importSyncData(st, merged.data);
          saveState(st, { heads: merged.heads, baseline: exportSyncData(st), pending: [] });
          st.setSetting('ledger_sync_last', now());
          applied = true;
        },
        (st) =>
          canonical(exportSyncData(st)) !== canonical(merged.data)
            ? 'Drive帳簿の同期前'
            : undefined,
      );
      if (applied) {
        await flushStagedBackups(async (bytes, id, reason) => {
          await this.drive.storeBackup(bytes, id, reason);
          return true;
        });
        const fingerprint = canonical(merged.heads);
        if (this.engine.snapshot.settings.ledger_sync_backup_heads !== fingerprint) {
          await this.drive.storeBackup(
            this.engine.store.export(),
            newId(),
            '帳簿の自動バックアップ',
          );
          await this.engine.write((st) => st.setSetting('ledger_sync_backup_heads', fingerprint));
        }
      }
      if (canonical(exportSyncData(this.engine.store)) !== canonical(merged.data)) applied = false;
      this.update({
        phase: applied ? 'synced' : 'waiting',
        message: applied
          ? 'Google Driveに帳簿とバックアップを保存済みです'
          : '新しい編集を保存しました。次の自動同期で反映します',
        conflicts: [],
        last: this.engine.snapshot.settings.ledger_sync_last || '',
      });
    });
  }
  async resolve(choices: Record<string, string>) {
    if (this.running) throw new Error('同期の完了を待ってください');
    const merged = materialize(this.remote);
    if (!merged.conflicts.length) return;
    const changes: Record<string, Entity | null> = Object.create(null);
    for (const conflict of merged.conflicts) {
      const chosen = conflict.variants.find((v) => v.revision === choices[conflict.key]);
      if (!chosen) throw new Error('すべての競合項目で残す内容を選んでください');
      changes[conflict.key] = chosen.value;
    }
    await this.engine.write((st) => {
      const state = this.freeze(st);
      // Newer local edits must be synced and reviewed, never overwritten by an old dialog.
      if (state.pending.length)
        throw new Error(
          '確認中に編集がありました。先に「今すぐ同期」で最新の候補を取得してください',
        );
      const docs = this.make(st, changes, merged.heads);
      state.pending.push(...docs);
      state.heads = [docs.at(-1)!.id];
      saveState(st, state);
    }, '同期競合の解決前');
    await this.sync();
  }
}
