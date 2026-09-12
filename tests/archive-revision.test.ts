import { beforeAll, expect, it } from 'vitest';
import initSqlJs, { type SqlJsStatic } from 'sql.js';
import { createRequire } from 'node:module';
import { Store } from '../src/db/store';
import { archiveSetting, archiveResponsePrefix } from '../src/domain/archive';
import { exportSyncData, importSyncData } from '../src/lib/sync-data';
import { revisionSchema, materialize, type SyncData } from '../src/lib/sync-graph';

const require = createRequire(import.meta.url);
let SQL: SqlJsStatic;
beforeAll(async () => {
  SQL = await initSqlJs({ locateFile: () => require.resolve('sql.js/dist/sql-wasm.wasm') });
});

it('OCRを含む大きな台帳と上限文字数の回答を同期履歴経由で復元する', () => {
  const a = new Store(SQL),
    b = new Store(SQL);
  const archive = {
    schema_version: '1.0',
    title: '架空の大量資料',
    folder_url: 'https://drive.google.com/drive/folders/sample',
    documents: Array.from({ length: 40 }, (_, i) => ({
      id: 'sample-' + i,
      year: 2020,
      book: 'common',
      name: '見本資料.pdf',
      category: '原本',
      original_path: 'sample-' + i + '.pdf',
      drive_url: 'https://drive.google.com/file/d/sample/view',
      sha256: 'a'.repeat(64),
      text: '検証用の文字'.repeat(2000),
    })),
    issues: [],
  };
  a.setSetting(archiveSetting, JSON.stringify(archive));
  a.setSetting(
    archiveResponsePrefix + 'sample-answer',
    JSON.stringify({ status: 'reviewing', note: '確'.repeat(10000) }),
  );
  a.setSetting('google_client_id', 'private-device-setting');
  const data = exportSyncData(a);
  expect(JSON.stringify(data['shared:' + archiveSetting]).length).toBeGreaterThan(100000);
  const revision = revisionSchema.parse({
    format: 'aoiro-sync-1',
    id: '12345678-1234-4234-8234-123456789012',
    book: 'business',
    device: '架空の端末',
    created: '2020-01-01T00:00:00Z',
    parents: [],
    changes: data,
  });
  b.atomic(() => importSyncData(b, materialize([revision]).data));
  expect(b.setting(archiveSetting)).toBe(a.setting(archiveSetting));
  expect(b.setting(archiveResponsePrefix + 'sample-answer')).toBe(
    a.setting(archiveResponsePrefix + 'sample-answer'),
  );
  expect(b.setting('google_client_id')).toBeUndefined();
  expect(
    revisionSchema.safeParse({ ...revision, changes: { 'profile:industry': 'x'.repeat(10001) } })
      .success,
  ).toBe(false);
  // Previously published small string values remain readable; bad wrappers roll back.
  const legacy: SyncData = {
    ...data,
    ['shared:' + archiveResponsePrefix + 'sample-answer']: JSON.stringify({
      status: 'resolved',
      note: '旧形式',
    }),
  };
  b.atomic(() => importSyncData(b, legacy));
  expect(b.setting(archiveResponsePrefix + 'sample-answer')).toContain('旧形式');
  expect(() =>
    b.atomic(() =>
      importSyncData(b, { ...data, ['shared:' + archiveSetting]: { kind: 'wrong', value: '{}' } }),
    ),
  ).toThrow();
  expect(b.setting(archiveResponsePrefix + 'sample-answer')).toContain('旧形式');
});
