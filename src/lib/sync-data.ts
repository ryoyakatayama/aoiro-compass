import {
  archiveSchema,
  archiveResponseSchema,
  archiveSetting,
  archiveResponsePrefix,
} from '../domain/archive';
import type { Store } from '../db/store';
import { profileSchema } from '../domain/model';
import type { Entity, SyncData } from './sync-graph';
import { archiveSyncValueSchema } from './sync-graph';
import type { SqlValue } from 'sql.js';

const tables = [
  'fiscal_years',
  'accounts',
  'evidences',
  'transactions',
  'ai_extractions',
  'assets',
  'depreciation_entries',
  'bank_import_batches',
  'bank_entries',
  'ai_audits',
  'ai_audit_findings',
  'consultation_messages',
  'historical_summaries',
  'audit_events',
] as const;
type Row = Record<string, SqlValue>;
const archiveValue = (value: Entity) =>
  typeof value === 'string'
    ? value // Read earlier small archive revisions as well.
    : archiveSyncValueSchema.parse(value).value;
const pk = (table: string) =>
  table === 'fiscal_years' || table === 'historical_summaries' ? 'year' : 'id';
export function exportSyncData(store: Store): SyncData {
  const data: SyncData = Object.create(null);
  for (const table of tables)
    for (const row of store.all(`SELECT * FROM ${table}`)) {
      const key = `${table}:${row[pk(table)]}`;
      data[key] =
        table === 'transactions'
          ? ({
              row,
              lines: store.all(
                'SELECT * FROM journal_lines WHERE transaction_id=? ORDER BY sort_order,id',
                [row.id],
              ),
              links: store.all(
                'SELECT * FROM evidence_transaction_links WHERE transaction_id=? ORDER BY evidence_id',
                [row.id],
              ),
            } as Entity)
          : (row as Entity);
    }
  const profile = profileSchema.parse(JSON.parse(store.setting('profile') || '{}'));
  for (const [key, value] of Object.entries(profile)) if (value) data['profile:' + key] = value;
  // Tokens, Client ID, sync state, queue errors and device preferences never leave this device.
  const root = store.setting('drive_root');
  if (root) data['shared:drive_root'] = root;
  for (const row of store.all('SELECT key,value FROM settings WHERE key = ? OR key LIKE ?', [
    archiveSetting,
    archiveResponsePrefix + '%',
  ]))
    data['shared:' + String(row.key)] = {
      kind: 'source_archive_setting',
      value: String(row.value),
    };
  return data;
}
export function importSyncData(store: Store, data: SyncData) {
  const columns = new Map<string, string[]>();
  for (const table of [...tables, 'journal_lines', 'evidence_transaction_links'])
    columns.set(
      table,
      store.all(`PRAGMA table_info(${table})`).map((r) => String(r.name)),
    );
  const insert = (table: string, input: unknown) => {
    const names = columns.get(table)!;
    if (!input || typeof input !== 'object' || Array.isArray(input))
      throw new Error('同期データの行が不正です');
    const row = input as Row;
    if (
      Object.keys(row).length !== names.length ||
      names.some((n) => !(n in row)) ||
      Object.values(row).some(
        (v) =>
          v !== null &&
          typeof v !== 'string' &&
          !(typeof v === 'number' && Number.isSafeInteger(v)),
      )
    )
      throw new Error('同期データの列が不正です');
    store.run(
      `INSERT INTO ${table} (${names.join(',')}) VALUES(${names.map(() => '?').join(',')})`,
      names.map((n) => row[n]),
    );
  };
  const queued = store.all('SELECT * FROM upload_queue');
  store.run('PRAGMA defer_foreign_keys=ON');
  store.run('DELETE FROM upload_queue');
  store.run('DELETE FROM drive_sync_state');
  store.run('DELETE FROM evidence_transaction_links');
  store.run('DELETE FROM journal_lines');
  for (const table of [...tables].reverse()) store.run(`DELETE FROM ${table}`);
  const profile: Record<string, string> = {};
  const transactionChildren: { lines: Row[]; links: Row[] }[] = [];
  for (const [key, value] of Object.entries(data)) {
    const colon = key.indexOf(':'),
      table = key.slice(0, colon),
      id = key.slice(colon + 1);
    if (table === 'profile') {
      if (!Object.hasOwn(profileSchema.shape, id) || typeof value !== 'string')
        throw new Error('事業情報の同期データが不正です');
      profile[id] = value;
      continue;
    }
    if (key === 'shared:' + archiveSetting || key.startsWith('shared:' + archiveResponsePrefix)) {
      (key === 'shared:' + archiveSetting ? archiveSchema : archiveResponseSchema).parse(
        JSON.parse(archiveValue(value)),
      );
      continue;
    }
    if (key === 'shared:drive_root' && typeof value === 'string') continue;
    if (!(tables as readonly string[]).includes(table))
      throw new Error('未対応の同期データです: ' + table);
    const entry = value as unknown as { row: Row; lines: Row[]; links: Row[] };
    const row = table === 'transactions' ? entry.row : (value as Row);
    if (!row || String(row[pk(table)]) !== id) throw new Error('同期データの識別子が一致しません');
    insert(table, row);
    if (table === 'transactions') {
      if (
        !Array.isArray(entry.lines) ||
        !Array.isArray(entry.links) ||
        [...entry.lines, ...entry.links].some((r) => r.transaction_id !== id)
      )
        throw new Error('仕訳の明細が一致しません');
      transactionChildren.push(entry);
    }
  }
  for (const entry of transactionChildren) {
    for (const row of entry.lines) insert('journal_lines', row);
    for (const row of entry.links) insert('evidence_transaction_links', row);
  }
  store.setSetting('profile', JSON.stringify(profileSchema.parse(profile)));
  store.run('DELETE FROM settings WHERE key = ? OR key LIKE ?', [
    archiveSetting,
    archiveResponsePrefix + '%',
  ]);
  for (const [key, value] of Object.entries(data))
    if (key === 'shared:' + archiveSetting || key.startsWith('shared:' + archiveResponsePrefix))
      store.setSetting(key.slice(7), archiveValue(value));
  const previousRoot = store.setting('drive_root') || '';
  const nextRoot = String(data['shared:drive_root'] || '');
  store.setSetting('drive_root', nextRoot);
  if (previousRoot !== nextRoot)
    store.run(
      "DELETE FROM settings WHERE key GLOB 'drive_year_*' OR key GLOB 'drive_inbox_*' OR key GLOB 'drive_books_*' OR key GLOB 'drive_backup_*' OR key GLOB 'drive_token_*'",
    );
  for (const q of queued)
    if (store.all('SELECT id FROM evidences WHERE id=? AND drive_file_id IS NULL', [q.id]).length)
      store.run('INSERT INTO upload_queue VALUES(?,?,?,?,?)', [
        q.id,
        q.target_folder_id,
        q.status,
        q.retry_count,
        q.last_error,
      ]);
  store.validate();
  if (
    store.all(
      "SELECT t.id FROM transactions t JOIN fiscal_years y ON y.year=t.year WHERE y.status='closed' AND t.status!='locked'",
    ).length
  )
    throw new Error(
      '年度締めと別端末の記帳が重なりました。締めた端末で年度を解除して再同期してください。両方の履歴は保存されています',
    );
}
