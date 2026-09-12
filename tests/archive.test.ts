import { beforeAll, expect, it } from 'vitest';
import initSqlJs, { type SqlJsStatic } from 'sql.js';
import { createRequire } from 'node:module';
import { Store } from '../src/db/store';
import { monthly, report } from '../src/domain/accounting';
import { archiveSchema, archiveSetting, archiveResponsePrefix } from '../src/domain/archive';
import { exportSyncData, importSyncData } from '../src/lib/sync-data';
import { readTextFile } from '../src/lib/csv';
const require = createRequire(import.meta.url);
let SQL: SqlJsStatic;
beforeAll(async () => {
  SQL = await initSqlJs({ locateFile: () => require.resolve('sql.js/dist/sql-wasm.wasm') });
});
const sample = () => ({
  schema_version: '1.0',
  title: '架空の資料台帳',
  folder_url: 'https://drive.google.com/drive/folders/sample',
  documents: [
    {
      id: 'doc-1',
      year: 2020,
      book: 'common',
      name: '見本.pdf',
      category: '原本',
      original_path: '見本.pdf',
      drive_url: 'https://drive.google.com/file/d/sample/view',
      sha256: 'a'.repeat(64),
    },
  ],
  issues: [
    {
      id: 'question-1',
      year: 2020,
      book: 'common',
      title: '日付を確認',
      detail: '原本の日付を確認してください',
      source_ids: ['doc-1'],
    },
  ],
});
it('月別経費が不明でも既知の売上を表示し、利益や未登録年度を0円にしない', () => {
  const st = new Store(SQL);
  st.atomic(() =>
    st.importHistorical({
      schema_version: '1.0',
      year: 2020,
      data_completeness: 'summary_only',
      summary: {
        revenue: 12000,
        expense: 3000,
        monthly: Array.from({ length: 12 }, (_, i) => ({
          month: i + 1,
          revenue: 1000,
          expense: null,
        })),
      },
    }),
  );
  expect(monthly(st.snapshot(), 2020)[0]).toMatchObject({
    revenue: 1000,
    expense: null,
    profit: null,
  });
  expect(monthly(st.snapshot(), 2019)[0]).toMatchObject({ revenue: null, available: false });
  expect(report(st.snapshot(), 2020).profit).toBe(9000);
  expect(() =>
    st.atomic(() =>
      st.importHistorical({
        schema_version: '1.0',
        year: 2019,
        data_completeness: 'summary_only',
        summary: {
          revenue: 100,
          expense: 0,
          monthly: Array.from({ length: 12 }, (_, i) => ({
            month: i + 1,
            revenue: 101,
            expense: null,
          })),
        },
      }),
    ),
  ).toThrow('月次');
  expect(st.snapshot().years.some((y) => y.year === 2019)).toBe(false);
  st.atomic(() =>
    st.importHistorical({
      schema_version: '1.0',
      year: 2018,
      data_completeness: 'summary_only',
      summary: {
        revenue: 0,
        expense: 1000,
        monthly: Array.from({ length: 12 }, (_, i) => ({
          month: i + 1,
          revenue: 0,
          expense: i === 0 ? 1500 : i === 11 ? -500 : 0,
        })),
      },
    }),
  );
  expect(monthly(st.snapshot(), 2018)[11]).toMatchObject({ expense: -500, profit: 500 });
});
it('資料リンク・重複ID・存在しない参照を拒否する', () => {
  expect(archiveSchema.safeParse(sample()).success).toBe(true);
  const input = sample();
  input.documents[0].drive_url = 'https://drive.google.com.evil.example/file';
  expect(archiveSchema.safeParse(input).success).toBe(false);
  const duplicate = sample();
  duplicate.documents.push({ ...duplicate.documents[0] });
  expect(archiveSchema.safeParse(duplicate).success).toBe(false);
  const dangling = sample();
  dangling.issues[0].source_ids = ['missing'];
  expect(archiveSchema.safeParse(dangling).success).toBe(false);
});
it('台帳と個別回答を端末間で同期し、Googleの認証情報は同期しない', () => {
  const a = new Store(SQL),
    b = new Store(SQL);
  a.setSetting(archiveSetting, JSON.stringify(archiveSchema.parse(sample())));
  a.setSetting(
    archiveResponsePrefix + 'question-1',
    JSON.stringify({ status: 'reviewing', note: '確認中の回答' }),
  );
  a.setSetting('google_client_id', 'device-only');
  const data = exportSyncData(a);
  b.atomic(() => importSyncData(b, data));
  expect(b.setting(archiveSetting)).toBe(a.setting(archiveSetting));
  expect(b.setting(archiveResponsePrefix + 'question-1')).toBe(
    a.setting(archiveResponsePrefix + 'question-1'),
  );
  expect(b.setting('google_client_id')).toBeUndefined();
});
it('CSVを名乗るExcelバイナリには変換手順を表示する', async () => {
  await expect(
    readTextFile(new File([new Uint8Array([80, 75, 3, 4, 0])], '見本.csv')),
  ).rejects.toThrow('Excel');
});
