import { useEffect, useState, useRef } from 'react';
import { Save, Cloud, HardDrive, Download, Plus, ExternalLink, ShieldCheck } from 'lucide-react';
import { z } from 'zod';
import { useApp } from './context';
import { PageHeading, Card, Field, FileButton, Modal, Badge } from './shared';
import { type Profile, historicalSchema } from '../domain/model';
import { bookLabel, bookKind } from '../lib/book';
import { download, listBackups, demoMode, getBlob } from '../lib/persistence';
import { zipFiles } from '../lib/packs';
import SyncSettings, { CloudBackups } from './SyncSettings';
import Activities from './Activities';
export default function Settings() {
  const { s, engine, drive, year, run, busy, setConnected } = useApp();
  const [profile, setProfile] = useState<Profile>(s.profile),
    [client, setClient] = useState(
      s.settings.google_client_id || import.meta.env.VITE_GOOGLE_CLIENT_ID || '',
    ),
    [root, setRoot] = useState(s.settings.drive_root || ''),
    [newYear, setNewYear] = useState(year + 1),
    [restore, setRestore] = useState<File | null>(null),
    [restoreWord, setRestoreWord] = useState(''),
    [history, setHistory] = useState<{ file: File; value: unknown } | null>(null),
    [storage, setStorage] = useState(''),
    [account, setAccount] = useState({ code: '', name: '', type: 'expense' });
  const [backups, setBackups] = useState<Awaited<ReturnType<typeof listBackups>>>([]);
  const [profileDirty, setProfileDirty] = useState(false);
  const profileBase = useRef(s.profile);
  const [rootDirty, setRootDirty] = useState(false);
  useEffect(() => {
    if (!profileDirty) {
      setProfile(s.profile);
      profileBase.current = s.profile;
    }
  }, [s.profile, profileDirty]);
  useEffect(() => {
    if (!rootDirty) setRoot(s.settings.drive_root || '');
  }, [s.settings.drive_root, rootDirty]);
  useEffect(() => {
    void listBackups().then(setBackups);
    void engine
      .persistenceStatus()
      .then((r) =>
        setStorage(
          `${engine.mode} / ${r.persisted ? '永続ストレージ許可済み' : '永続ストレージ未許可'} / 約${Math.round((r.estimate?.usage || 0) / 1024 / 1024)} MB使用`,
        ),
      );
  }, [engine, s]);
  const fields: { key: keyof Profile; label: string; placeholder: string; long?: boolean }[] = [
    { key: 'business_name', label: '屋号（任意）', placeholder: '例：〇〇デザイン' },
    { key: 'industry', label: '業種', placeholder: '例：Web制作・ITコンサルティング' },
    {
      key: 'description',
      label: '事業内容・仕事内容',
      placeholder: '誰に、どのような価値やサービスを提供していますか？',
      long: true,
    },
    {
      key: 'customers',
      label: '主な顧客・取引先の特徴',
      placeholder: '法人/個人、国内/海外、継続契約など',
      long: true,
    },
    {
      key: 'revenue_model',
      label: '収益モデル・売上の成り立ち',
      placeholder: '受託制作、月額契約、物販、広告収入など',
      long: true,
    },
    {
      key: 'work_style',
      label: '働き方・仕事場所',
      placeholder: '自宅/事務所/出張、作業時間、使用設備など',
      long: true,
    },
    {
      key: 'expenses',
      label: '主な経費・必要になる理由',
      placeholder: '機材、ソフト、外注、移動などと事業との関係',
      long: true,
    },
    {
      key: 'private_use',
      label: '私用との混在・按分の考え方',
      placeholder: '自宅家賃・通信・車など。使用実態や記録の方法',
      long: true,
    },
    {
      key: 'employees',
      label: '従業員・家族の関与',
      placeholder: '一人で運営、家族の手伝い、外注先との関係など',
    },
    {
      key: 'tax_status',
      label: '所得税・消費税の状況',
      placeholder: '青色/白色、免税/課税、未確認など',
    },
    {
      key: 'invoice_status',
      label: 'インボイス登録の状況',
      placeholder: '登録済み/未登録/検討中（登録番号は不要）',
    },
    {
      key: 'accounting_policy',
      label: '会計処理の方針',
      placeholder: '税込/税抜経理、売上の計上基準など',
    },
    {
      key: 'concerns',
      label: '相談時に踏まえてほしい背景',
      placeholder: '今後の事業計画、判断に迷っていること、過去の相談結果など',
      long: true,
    },
  ];
  return (
    <>
      <PageHeading
        eyebrow="BUSINESS & SETTINGS"
        title="あなたの事業に、合わせる。"
        description="相談の背景になる事業情報と、原本・帳簿の保存先を設定します。"
      />
      <Card
        title={bookKind === 'misc' ? '雑所得の共通プロフィール' : '事業プロフィール'}
        subtitle="相談パックに含めるかどうかは、毎回選択できます。口座番号・マイナンバー・パスワードは入力不要です。"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await engine.write((st) => {
                const latest = st.snapshot().profile,
                  next = { ...latest };
                for (const key of Object.keys(profile) as (keyof Profile)[]) {
                  if (profile[key] === profileBase.current[key]) continue;
                  if (latest[key] !== profileBase.current[key] && latest[key] !== profile[key])
                    throw new Error(
                      '編集中の項目が別の端末で変更されました。最新の事業プロフィールを確認してください',
                    );
                  next[key] = profile[key];
                }
                st.saveProfile(next);
              });
              setProfileDirty(false);
            }, '事業プロフィールを保存しました');
          }}
        >
          <div className="form-grid">
            {fields.map((f) => (
              <Field
                key={f.key}
                label={f.label}
                className={f.key === 'description' || f.key === 'concerns' ? 'span-2' : ''}
              >
                {f.long ? (
                  <textarea
                    rows={3}
                    value={profile[f.key]}
                    placeholder={f.placeholder}
                    onChange={(e) => {
                      setProfileDirty(true);
                      setProfile({ ...profile, [f.key]: e.target.value });
                    }}
                  />
                ) : (
                  <input
                    value={profile[f.key]}
                    placeholder={f.placeholder}
                    onChange={(e) => {
                      setProfileDirty(true);
                      setProfile({ ...profile, [f.key]: e.target.value });
                    }}
                  />
                )}
              </Field>
            ))}
          </div>
          <button className="button" disabled={busy} type="submit">
            <Save size={16} />
            事業プロフィールを保存
          </button>
        </form>
      </Card>
      <Activities />
      <div id="drive-configuration" />
      <Card
        title="Google Driveとの連携"
        subtitle="外部から追加した原本も読み取り、アプリが作成したファイルにだけ書き込みます。"
      >
        <div className="form-grid">
          <Field label="Google OAuth Client ID">
            <input
              value={client}
              onChange={(e) => setClient(e.target.value)}
              placeholder="…apps.googleusercontent.com"
            />
          </Field>
          <Field label="保存先ルートフォルダID（空欄なら新規作成）">
            <input
              value={root}
              onChange={(e) => {
                setRootDirty(true);
                setRoot(e.target.value);
              }}
              placeholder="DriveのフォルダURL末尾のID"
            />
          </Field>
        </div>
        <p className="small muted">
          外部原本を検出するためDrive全体の読み取り権限と、アプリ作成ファイル・アプリ専用領域の書き込み権限を使用します。Client
          Secretは使用しません。アクセストークンはメモリ内だけに保持します。
        </p>
        <div className="actions">
          <button
            className="button"
            disabled={busy || demoMode}
            onClick={() =>
              void run(async () => {
                await engine.write((st) => {
                  st.setSetting('google_client_id', client.trim());
                  if ((st.setting('drive_root') || '') !== root.trim())
                    st.run(
                      "DELETE FROM settings WHERE key GLOB 'drive_year_*' OR key GLOB 'drive_inbox_*' OR key GLOB 'drive_books_*' OR key GLOB 'drive_backup_*' OR key GLOB 'drive_token_*' OR key GLOB 'drive_layout_*' OR key GLOB 'drive_evidence_*'",
                    );
                  st.setSetting('drive_root', root.trim());
                });
                await drive.connect(client.trim());
                setRootDirty(false);
                setConnected(true);
              }, 'Google Driveに接続しました')
            }
          >
            <Cloud size={17} />
            設定を保存して接続
          </button>
          <button
            className="button secondary"
            disabled={!drive.connected}
            onClick={() => {
              drive.disconnect();
              setConnected(false);
            }}
          >
            接続を終了
          </button>
          <a
            className="text-button"
            href="https://console.cloud.google.com/apis/credentials"
            target="_blank"
            rel="noreferrer"
          >
            OAuth設定を開く
            <ExternalLink size={15} />
          </a>
        </div>
        <details className="details">
          <summary>初回のGoogle OAuth設定</summary>
          <ol>
            <li>Google Cloudでプロジェクトを作り、Google Drive APIを有効にします。</li>
            <li>OAuth同意画面を設定し、テストユーザーに自分のGoogleアカウントを追加します。</li>
            <li>
              OAuthクライアントIDの種類は「ウェブアプリケーション」。承認済みJavaScript生成元に、現在のアプリの生成元{' '}
              <code>{window.location.origin}</code> を追加します。
            </li>
            <li>
              発行されたClient
              IDを上の欄へ入力して接続します。任意のDriveファイルを読む権限にはGoogleの審査やテストモードの制限があります。
            </li>
          </ol>
          <a
            href="https://developers.google.com/workspace/drive/api/guides/api-specific-auth"
            target="_blank"
            rel="noreferrer"
          >
            Googleの公式権限ガイド
          </a>
        </details>
      </Card>
      <SyncSettings />
      {!demoMode && <CloudBackups onRestore={setRestore} />}
      {!demoMode && (
        <Card title="Driveから環境を復旧">
          <p>
            新しい端末への移行や、端末データが開けない場合に使います。Googleに接続し、復旧内容を確認してから帳簿を戻せます。
          </p>
          <a
            className="button secondary"
            href={`${import.meta.env.BASE_URL}?recover=1&book=${bookKind}`}
          >
            Driveから環境を復旧
          </a>
        </Card>
      )}
      {import.meta.env.VITE_PRIVATE_HOST === '1' && (
        <Card title="アプリのログイン">
          <p>
            この配信先はサーバーでパスワードを確認します。ログアウトしても端末の帳簿は削除しません。
          </p>
          <form method="post" action="/_auth/logout">
            <button className="button secondary" type="submit">
              アプリからログアウト
            </button>
          </form>
        </Card>
      )}
      <Card title={`${bookLabel}の保存と復元`} subtitle={storage}>
        <p>
          帳簿と正式なバックアップはGoogle
          Driveに保存します。この端末には操作用の作業データを持ちます。SQLiteには全年度・事業情報・相談履歴を含み、原本は別ファイルです。
        </p>
        <div className="actions">
          <button
            className="button secondary"
            disabled={busy}
            onClick={() =>
              void run(
                async () => {
                  if (!demoMode && !drive.connected)
                    throw new Error(
                      '先にGoogle Driveへ接続してください。正式なバックアップはDriveへ保存します',
                    );
                  const backup = await engine.backup();
                  download(`aoiro_${backup.id}.sqlite`, backup.bytes);
                },
                demoMode
                  ? 'デモのバックアップを書き出しました'
                  : 'Driveへバックアップし、手元にもコピーしました',
              )
            }
          >
            <Download size={16} />
            {demoMode ? 'SQLiteを保存' : 'Driveにバックアップしてコピーを保存'}
          </button>
          <button
            className="button secondary"
            onClick={() =>
              void run(async () => {
                const granted = await navigator.storage.persist();
                setStorage(
                  `${engine.mode} / ${granted ? '永続ストレージ許可済み' : 'ブラウザが永続保存を許可しませんでした'}`,
                );
              })
            }
          >
            <ShieldCheck size={16} />
            永続保存をリクエスト
          </button>
          <FileButton accept=".sqlite,.db" disabled={busy} onFile={(files) => setRestore(files[0])}>
            SQLiteから復元
          </FileButton>
          <button
            className="button secondary"
            onClick={() =>
              void run(async () => {
                const files: Record<string, Blob> = {};
                for (const e of s.evidences.filter((e) => !e.drive_file_id)) {
                  const blob = await getBlob(e.id);
                  if (!blob) throw new Error(`${e.filename}のローカル原本がありません`);
                  files[`${e.id}_${e.filename.replace(/[\\/:*?"<>|]/g, '_')}`] = blob;
                }
                if (!Object.keys(files).length) throw new Error('未アップロード原本はありません');
                download('aoiro_local_originals.zip', await zipFiles(files));
              }, '未アップロードの原本を書き出しました')
            }
          >
            未アップロード原本を保存
          </button>
        </div>
        <details className="details">
          <summary>Driveへ送信待ちの一時退避（{backups.length}件）</summary>
          <p className="small muted">
            オフライン時の退避です。Drive保存はまだ完了していません。再接続・同期するとDriveへ移し、端末の一時退避から除きます。
          </p>
          {backups.slice(0, 20).map((b) => (
            <div className="backup-row" key={b.id}>
              <span>
                {b.created.slice(0, 19).replace('T', ' ')} · {b.reason}
              </span>
              <button
                className="text-button"
                onClick={() => download(`aoiro_${b.id}.sqlite`, b.bytes)}
              >
                保存
              </button>
            </div>
          ))}
        </details>
      </Card>
      <Card title="会計年度・過年度の移行">
        <div className="year-list">
          {s.years.map((y) => (
            <div className="year-item" key={y.year}>
              <strong>{y.year}年</strong>
              <Badge value={y.status} />
              <span className="small muted">{y.data_completeness}</span>
            </div>
          ))}
        </div>
        <div className="actions">
          <input
            aria-label="追加する年度"
            type="number"
            min="1900"
            max="2200"
            value={newYear}
            onChange={(e) => setNewYear(Number(e.target.value))}
          />
          <button
            className="button secondary"
            disabled={busy}
            onClick={() =>
              void run(() => engine.write((st) => st.addYear(newYear)), '年度を追加しました')
            }
          >
            <Plus size={16} />
            年度を追加
          </button>
          <FileButton
            onFile={(files) =>
              void run(async () => {
                const value = historicalSchema.parse(JSON.parse(await files[0].text()));
                if (value.book && value.book !== bookKind)
                  throw new Error(
                    'このデータは別の所得区分用です。事業所得／雑所得の帳簿を切り替えてください。',
                  );
                setHistory({ file: files[0], value });
              })
            }
          >
            過年度JSONを確認
          </FileButton>
          <button
            className="text-button"
            onClick={() =>
              void run(async () =>
                download(
                  'aoiro_historical_import_kit.zip',
                  await zipFiles({
                    'schema.json': JSON.stringify(z.toJSONSchema(historicalSchema), null, 2),
                    'accounts.json': JSON.stringify(s.accounts, null, 2),
                    'prompt.md':
                      '過去の会計ソフトの帳簿や決算書をschema.jsonの形式へ変換してください。元資料の数字と整合するか検証し、不一致は勝手に補正しないでください。科目IDはaccounts.jsonを使用。新規の科目はaccountsへ定義。仕訳がなければsummary_onlyで年次summaryを含め、仕訳があるならledgerとしyearが一致する確定仕訳を含めてください。B/Sの期末利益は元入金等へ含めて貸借一致する形式にし、その調整内容を別の説明文で明示してください。アプリは過年度を閲覧専用で取り込みます。UUIDを新規生成してください。',
                  }),
                ),
              )
            }
          >
            移行用の指示・スキーマを保存
          </button>
        </div>
        {history && (
          <Modal title="過年度データの取込確認" onClose={() => setHistory(null)}>
            <div className="modal-body">
              <p>既存の年度は上書きしません。取り込んだ年度は閲覧専用になります。</p>
              <pre className="json-preview">{JSON.stringify(history.value, null, 2)}</pre>
            </div>
            <div className="modal-footer">
              <button
                className="button"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await engine.write((st) => st.importHistorical(history.value), '過年度取込前');
                    setHistory(null);
                  }, '過年度を閲覧専用で取り込みました')
                }
              >
                確認して取り込む
              </button>
            </div>
          </Modal>
        )}
      </Card>
      <Card title="勘定科目を追加">
        <div className="form-grid three">
          <Field label="コード">
            <input
              value={account.code}
              onChange={(e) => setAccount({ ...account, code: e.target.value })}
            />
          </Field>
          <Field label="科目名">
            <input
              value={account.name}
              onChange={(e) => setAccount({ ...account, name: e.target.value })}
            />
          </Field>
          <Field label="区分">
            <select
              value={account.type}
              onChange={(e) => setAccount({ ...account, type: e.target.value })}
            >
              <option value="expense">費用</option>
              <option value="revenue">収益</option>
              <option value="asset">資産</option>
              <option value="liability">負債</option>
              <option value="equity">純資産</option>
            </select>
          </Field>
        </div>
        <button
          className="button secondary"
          disabled={!account.code || !account.name || busy}
          onClick={() =>
            void run(async () => {
              await engine.write((st) => st.addAccount(account));
              setAccount({ code: '', name: '', type: 'expense' });
            }, '勘定科目を追加しました')
          }
        >
          科目を追加
        </button>
      </Card>
      <Card title="操作履歴" subtitle="直近300件。すべての履歴はSQLite内に保持しています。">
        <details className="details">
          <summary>記帳・取込・年度操作の記録を見る</summary>
          <div className="table-scroll bounded">
            <table>
              <thead>
                <tr>
                  <th>日時</th>
                  <th>操作</th>
                  <th>対象</th>
                  <th>詳細</th>
                </tr>
              </thead>
              <tbody>
                {s.events.map((e) => (
                  <tr key={e.id}>
                    <td>{e.occurred_at.slice(0, 19)}</td>
                    <td>{e.event_type}</td>
                    <td className="mono">{e.entity_id.slice(0, 12)}</td>
                    <td>
                      <details>
                        <summary>表示</summary>
                        <pre className="json-preview">{e.payload_json}</pre>
                      </details>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </Card>
      {restore && (
        <Modal title="SQLiteバックアップから復元" onClose={() => setRestore(null)}>
          <div className="modal-body">
            <p>
              <strong>{restore.name}</strong>{' '}
              でこの端末の帳簿全体を置き換えます。現在の帳簿は先に自動バックアップします。証憑原本は置き換えません。
            </p>
            <Field label="確認のため「復元」と入力">
              <input value={restoreWord} onChange={(e) => setRestoreWord(e.target.value)} />
            </Field>
          </div>
          <div className="modal-footer">
            <button
              className="button"
              disabled={busy || restoreWord !== '復元'}
              onClick={() =>
                void run(async () => {
                  await engine.restore(new Uint8Array(await restore.arrayBuffer()));
                  setRestore(null);
                  setRestoreWord('');
                  setProfile(engine.snapshot.profile);
                }, 'バックアップから復元しました')
              }
            >
              帳簿を復元する
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
