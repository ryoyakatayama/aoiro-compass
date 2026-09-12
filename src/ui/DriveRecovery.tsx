import { useState } from 'react';
import { DriveAdapter } from '../lib/drive';
import { Engine, recoverLocalCache } from '../lib/persistence';
import { bookKind, bookLabel } from '../lib/book';
import { materialize, type Revision } from '../lib/sync-graph';
import { newId, now } from '../domain/model';
import { conflictTitle, variantSummary } from './SyncSettings';

export default function DriveRecovery() {
  const [client, setClient] = useState(import.meta.env.VITE_GOOGLE_CLIENT_ID || '');
  // Recovery can authenticate without opening the possibly damaged local SQLite file.
  const [drive] = useState(() => new DriveAdapter({ snapshot: { settings: {} } } as Engine));
  const [docs, setDocs] = useState<Revision[] | null>(null),
    [choices, setChoices] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [word, setWord] = useState('');
  const merged = docs ? materialize(docs) : null;
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="recovery-screen">
      <section className="recovery-card">
        <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" width="48" />
        <p className="eyebrow">GOOGLE DRIVE · RECOVERY</p>
        <h1>Driveから環境を復旧</h1>
        <p>
          {bookLabel}の帳簿・事業情報・相談履歴・保存先を、Google
          Driveからこの端末に戻します。アプリ独自のパスワードや暗号鍵は不要です。
        </p>
        <label className="field">
          <span>復旧する帳簿</span>
          <select
            value={bookKind}
            disabled={busy}
            onChange={(e) => {
              const url = new URL(location.href);
              url.searchParams.set('book', e.target.value);
              location.assign(url.href);
            }}
          >
            <option value="business">事業所得（青色申告）</option>
            <option value="misc">雑所得</option>
          </select>
        </label>
        <label className="field">
          <span>Google OAuth Client ID</span>
          <input
            value={client}
            disabled={busy || !!docs}
            onChange={(e) => setClient(e.target.value)}
            placeholder="…apps.googleusercontent.com"
          />
        </label>
        <p className="small muted">
          同期に使ったものと同じClient ID・Googleアカウントで接続します。Client
          IDは公開可能な接続設定で、パスワードではありません。
        </p>
        <button
          className="button"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              await drive.connect(client.trim());
              const files = await drive.listRevisions();
              if (!files.length)
                throw new Error(
                  'この接続先に同期済みの帳簿がありません。所得区分・Googleアカウント・Client IDを確認してください',
                );
              if (files.length > 50000) throw new Error('同期ファイルが多すぎます');
              const revisions: Revision[] = [];
              for (const file of files) revisions.push(await drive.readRevision(file, false));
              materialize(revisions);
              setDocs(revisions);
              setChoices({});
            })
          }
        >
          {busy ? '確認しています…' : 'Googleに接続して復旧内容を確認'}
        </button>
        {merged && (
          <div className="recovery-preview">
            <h2>復旧できる内容</h2>
            <p>
              仕訳 {Object.keys(merged.data).filter((k) => k.startsWith('transactions:')).length} 件
              / 領収書 {Object.keys(merged.data).filter((k) => k.startsWith('evidences:')).length}{' '}
              件 / 変更履歴 {docs!.length} 件
            </p>
            <p className="small muted">
              領収書の原本はDriveに残し、開いたときに読み込みます。新しい編集はDriveへ反映されたものまで復旧できます。
            </p>
            {merged.conflicts.length > 0 && (
              <p className="notice">
                同じ項目への変更が重なっています。採用する内容を選んでください。両方の履歴はDriveに残ります。
              </p>
            )}
            {merged.conflicts.map((c) => (
              <fieldset className="sync-conflict" key={c.key}>
                <legend>{conflictTitle(c.key)}</legend>
                {c.variants.map((v) => (
                  <label className="check" key={v.revision}>
                    <input
                      type="radio"
                      name={c.key}
                      checked={choices[c.key] === v.revision}
                      onChange={() => setChoices({ ...choices, [c.key]: v.revision })}
                    />
                    <span>
                      {variantSummary(v.value)}
                      <small>
                        {v.device} · {new Date(v.created).toLocaleString('ja-JP')}
                      </small>
                    </span>
                  </label>
                ))}
              </fieldset>
            ))}
            <p className="notice">
              この端末の{bookLabel}
              を置き換えます。Drive未保存の変更がある場合に備え、現在の端末データを先にDriveへ退避します。他の帳簿タブを閉じてください。
            </p>
            <label className="field">
              <span>確認のため「復旧」と入力</span>
              <input value={word} onChange={(e) => setWord(e.target.value)} />
            </label>
            <button
              className="button"
              disabled={busy || word !== '復旧' || merged.conflicts.some((c) => !choices[c.key])}
              onClick={() =>
                void run(async () => {
                  let current = merged;
                  if (merged.conflicts.length) {
                    const resolution: Revision = {
                      format: 'aoiro-sync-1',
                      id: newId(),
                      book: bookKind,
                      device: 'Drive復旧画面',
                      created: now(),
                      parents: merged.heads,
                      changes: Object.fromEntries(
                        merged.conflicts.map((c) => [
                          c.key,
                          c.variants.find((v) => v.revision === choices[c.key])!.value,
                        ]),
                      ),
                    };
                    await drive.appendRevision(resolution);
                    current = materialize([...docs!, resolution]);
                  }
                  await recoverLocalCache(
                    current.data,
                    current.heads,
                    drive.syncScope,
                    client.trim(),
                    async (bytes) => {
                      await drive.storeBackup(bytes, newId(), '復旧前の端末データ');
                    },
                  );
                  const url = new URL(location.href);
                  url.searchParams.delete('recover');
                  url.hash = 'settings';
                  location.replace(url.href);
                })
              }
            >
              この内容で復旧する
            </button>
          </div>
        )}
        {error && (
          <p className="notice danger" role="alert">
            {error}
          </p>
        )}
        <a
          className="text-button"
          href={`${import.meta.env.BASE_URL}${bookKind === 'misc' ? '?book=misc' : ''}`}
        >
          帳簿に戻る
        </a>
      </section>
    </main>
  );
}
