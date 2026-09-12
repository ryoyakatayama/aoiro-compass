import { useState } from 'react';
import { useApp } from './context';
import { Card, Field } from './shared';
import type { Entity } from '../lib/sync-graph';
import type { DriveFile } from '../lib/drive';
import { download } from '../lib/persistence';
export function CloudBackups({ onRestore }: { onRestore: (file: File) => void }) {
  const { drive, run, busy } = useApp();
  const [files, setFiles] = useState<DriveFile[]>([]),
    [loaded, setLoaded] = useState(false);
  return (
    <Card
      title="Google Driveのバックアップ"
      subtitle="同期した変更ごとに復元用の帳簿を残します。元の領収書はDriveの原本フォルダで管理します。"
    >
      <button
        className="button secondary"
        disabled={busy || !drive.connected}
        onClick={() =>
          void run(async () => {
            setFiles(await drive.listBackups());
            setLoaded(true);
          })
        }
      >
        Driveのバックアップ履歴を表示
      </button>
      {loaded && !files.length && (
        <p>バックアップはまだありません。帳簿を同期すると作成されます。</p>
      )}
      {files.slice(0, 40).map((file) => (
        <div className="backup-row" key={file.id}>
          <span>
            {new Date(file.appProperties?.created || file.modifiedTime || '').toLocaleString(
              'ja-JP',
            )}{' '}
            · {file.appProperties?.reason || '帳簿'}
          </span>
          <div className="actions">
            <button
              className="text-button"
              disabled={busy}
              onClick={() =>
                void run(async () => download(file.name, await drive.downloadBackup(file)))
              }
            >
              コピーを保存
            </button>
            <button
              className="text-button"
              disabled={busy}
              onClick={() =>
                void run(async () =>
                  onRestore(new File([await drive.downloadBackup(file)], file.name)),
                )
              }
            >
              復元内容を確認
            </button>
          </div>
        </div>
      ))}
      <p className="small muted">
        Driveのアプリ専用領域に保存されるため、通常のフォルダ一覧には出ません。ここから確認・書き出し・復元できます。独自の暗号化は行わず、Googleアカウントのアクセス権で保護します。
      </p>
    </Card>
  );
}
export function conflictTitle(key: string) {
  const names: Record<string, string> = {
    transactions: '仕訳',
    accounts: '勘定科目',
    evidences: '領収書',
    profile: '事業プロフィール',
    fiscal_years: '会計年度',
    assets: '固定資産',
    consultation_messages: '相談の対話',
    ai_audit_findings: 'AIの指摘',
    shared: 'Drive保存先',
  };
  return names[key.split(':')[0]] || '帳簿の項目';
}
export function variantSummary(value: Entity | null): string {
  if (value === null) return 'この項目を削除';
  if (typeof value === 'string') return value.slice(0, 180);
  const row = ('row' in value ? value.row : value) as Record<string, unknown>;
  return (
    [
      row.transaction_date,
      row.description || row.name || row.filename || row.content || row.title || row.year,
      row.status,
    ]
      .filter((v) => typeof v === 'string' || typeof v === 'number')
      .join(' · ')
      .slice(0, 220) || '項目の内容を更新'
  );
}
export default function SyncSettings() {
  const { s, engine, drive, ledgerSync, syncStatus, run, busy } = useApp();
  const [name, setName] = useState(s.settings.ledger_sync_device_name || '');
  const [choices, setChoices] = useState<Record<string, string>>({});
  return (
    <Card
      title="帳簿の自動同期"
      subtitle="同じGoogleアカウント・同じClient IDで接続すると、PCとスマホの帳簿・科目・事業情報・相談を共有します。事業所得と雑所得は別々です。"
    >
      <label className="check-row">
        <input
          type="checkbox"
          checked={s.settings.ledger_sync_enabled !== '0'}
          onChange={(e) =>
            void run(() =>
              engine.write((st) =>
                st.setSetting('ledger_sync_enabled', e.target.checked ? '1' : '0'),
              ),
            )
          }
        />
        接続中は帳簿を自動同期する
      </label>
      <p
        role="status"
        className={
          syncStatus.phase === 'error' || syncStatus.phase === 'conflict' ? 'notice' : 'small muted'
        }
      >
        {syncStatus.message}
      </p>
      {syncStatus.last && (
        <p className="small muted">最終同期: {new Date(syncStatus.last).toLocaleString('ja-JP')}</p>
      )}
      <div className="form-grid">
        <Field label="この端末の名前" hint="競合したときに、どの端末の編集か見分けられます。">
          <input
            maxLength={80}
            placeholder="例：自宅PC / スマホ"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
      </div>
      <div className="actions">
        <button
          className="button secondary"
          disabled={busy}
          onClick={() =>
            void run(
              () => engine.write((st) => st.setSetting('ledger_sync_device_name', name.trim())),
              '端末名を保存しました',
            )
          }
        >
          端末名を保存
        </button>
        <button
          className="button"
          disabled={busy || !drive.connected || syncStatus.phase === 'syncing'}
          onClick={() => void ledgerSync.sync()}
        >
          帳簿を今すぐ同期
        </button>
      </div>
      <p className="small muted">
        変更後と30秒間隔、再接続時に同期します。Googleの認証が切れた場合は再接続が必要です。同期データはDriveのアプリ専用領域に保存し、他人とは共有しません。アプリを閉じている間は次回起動時に再開します。
      </p>
      {syncStatus.conflicts.length > 0 && (
        <div className="sync-conflicts">
          <h3>重なった変更を確認</h3>
          <p>選ばなかった内容も同期履歴に残ります。自動的に新しい方を採用することはありません。</p>
          {syncStatus.conflicts.map((c) => (
            <fieldset key={c.key}>
              <legend>{conflictTitle(c.key)}</legend>
              {c.variants.map((v) => (
                <label className="sync-variant" key={v.revision}>
                  <input
                    type="radio"
                    name={c.key}
                    value={v.revision}
                    checked={choices[c.key] === v.revision}
                    onChange={() => setChoices({ ...choices, [c.key]: v.revision })}
                  />
                  <span>
                    <strong>{variantSummary(v.value)}</strong>
                    <br />
                    {v.device} · {new Date(v.created).toLocaleString('ja-JP')}
                    <details>
                      <summary>{v.value === null ? '削除する変更' : '変更内容を見る'}</summary>
                      <pre className="json-preview">{JSON.stringify(v.value, null, 2)}</pre>
                    </details>
                  </span>
                </label>
              ))}
            </fieldset>
          ))}
          <button
            className="button"
            disabled={
              busy ||
              syncStatus.conflicts.some(
                (c) => !c.variants.some((v) => v.revision === choices[c.key]),
              )
            }
            onClick={() =>
              void run(() => ledgerSync.resolve(choices), '選択した内容で同期を再確認しました')
            }
          >
            選択した内容を採用して同期
          </button>
        </div>
      )}
    </Card>
  );
}
