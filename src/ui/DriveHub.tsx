import { Cloud, RefreshCw, ArrowRight, CheckCircle2, AlertCircle } from 'lucide-react';
import { useApp } from './context';
import { PageHeading, Card } from './shared';
import SyncSettings from './SyncSettings';
import { demoMode } from '../lib/persistence';
import { bookLabel } from '../lib/book';

export function DriveStatus({ compact = false }: { compact?: boolean }) {
  const { s, drive, syncStatus, sync, busy, navigate } = useApp();
  const connected = drive.connected;
  const paused = s.settings.ledger_sync_enabled === '0';
  const pending = s.evidences.filter((e) => !e.drive_file_id && e.status !== 'ignored').length;
  const working = busy || syncStatus.phase === 'syncing';
  const saved = connected && syncStatus.phase === 'synced' && !pending;
  const problem = ['error', 'conflict'].includes(syncStatus.phase);
  const label = demoMode
    ? 'デモ用の帳簿'
    : !navigator.onLine
      ? 'オフライン・端末に保存'
      : !connected
        ? 'Google Driveに接続してください'
        : paused
          ? '自動同期は停止中'
          : saved
            ? 'Google Driveに保存済み'
            : working
              ? 'Google Driveと同期しています'
              : problem
                ? '同期に確認が必要です'
                : '端末の変更をDriveへ保存待ち';
  const last = syncStatus.last || s.settings.ledger_sync_last;
  return (
    <section
      className={`drive-status ${compact ? 'compact' : ''} ${saved ? 'saved' : problem ? 'problem' : ''}`}
      aria-label="Google Driveの保存状況"
    >
      <div className="drive-status-copy">
        {saved ? (
          <CheckCircle2 size={23} />
        ) : problem ? (
          <AlertCircle size={23} />
        ) : (
          <Cloud size={23} />
        )}
        <div>
          <strong role="status">{label}</strong>
          <small>
            {bookLabel}の帳簿 ·{' '}
            {last
              ? `前回の同期 ${new Date(last).toLocaleString('ja-JP')}`
              : 'この端末からの同期はまだ完了していません'}
            {pending > 0 ? ` · 原本 ${pending}件が送信待ち` : ''}
          </small>
        </div>
      </div>
      <div className="actions">
        <button
          className="button"
          disabled={working || demoMode || !navigator.onLine}
          onClick={() => (paused ? navigate('drive') : void sync())}
        >
          <RefreshCw size={16} />
          {!connected
            ? 'Googleに接続して同期'
            : paused
              ? '自動同期を再開する'
              : problem
                ? '同期を再試行'
                : '今すぐ同期'}
        </button>
        {compact && (
          <button className="text-button" onClick={() => navigate('drive')}>
            同期・復元の詳細
            <ArrowRight size={15} />
          </button>
        )}
      </div>
    </section>
  );
}

export default function DriveHub() {
  const { s, engine, drive, syncStatus, run, navigate, year } = useApp();
  const root = s.settings.drive_root;
  return (
    <>
      <PageHeading
        eyebrow="GOOGLE DRIVE"
        title="帳簿を保存。どの端末でも続きから。"
        description="最初にGoogleへ接続すると、編集中の帳簿と復元用バックアップを自動保存します。"
      />
      <DriveStatus />
      {s.settings.ledger_sync_enabled === '0' && (
        <button
          className="button"
          onClick={() =>
            void run(
              () => engine.write((st) => st.setSetting('ledger_sync_enabled', '1')),
              '自動同期を再開しました',
            )
          }
        >
          自動同期を再開
        </button>
      )}
      <div className="workflow-grid">
        <Card title="1. Googleに接続">
          <p>
            上の「Googleに接続して同期」を押し、帳簿を置くアカウントを選びます。スマホでも同じアカウントで接続します。
          </p>
          <p className="small muted">
            アプリを開き直した時や認証の期限が切れた時は、もう一度接続してください。
          </p>
        </Card>
        <Card title="2. あとは自動で保存">
          <p>
            変更後と約30秒ごとに同期します。「保存済み」になれば、帳簿と復元用バックアップの送信が完了しています。
          </p>
          <p className="small muted">
            オフラインでは端末に保存し、接続後に送信します。アプリを閉じている間の同期は行いません。
          </p>
        </Card>
        <Card title="3. スマホでも同じ帳簿">
          <p>
            同じアプリURLを開き、同じ所得区分を選んで接続してください。帳簿は全年度をまとめて同期します。
          </p>
          <p className="small muted">
            事業所得・雑所得は別の帳簿です。それぞれで接続・同期します。選択中の {year}{' '}
            年度の原本フォルダも確認します。
          </p>
        </Card>
      </div>
      {syncStatus.phase === 'error' && (
        <Card title="同期が完了していません">
          <p>
            端末のデータを残しています。接続と通信状態を確認して再試行してください。同じエラーが続く場合は更新を適用し、詳細を確認してください。
          </p>
          <details>
            <summary>エラーの詳細</summary>
            <pre className="json-preview">{syncStatus.message}</pre>
          </details>
        </Card>
      )}
      <SyncSettings />
      <Card title="保存先と復元">
        <p>
          領収書などの原本はDriveの通常のフォルダに、帳簿とバックアップはこのアプリ専用の領域に保存されます。通常のDrive一覧に帳簿ファイルがなくても、下のバックアップ履歴から確認できます。
        </p>
        <div className="actions">
          {root && /^[\w-]+$/.test(root) && (
            <a
              className="button secondary"
              href={`https://drive.google.com/drive/folders/${root}`}
              target="_blank"
              rel="noreferrer"
            >
              原本フォルダを開く
            </a>
          )}
          <button
            className="button secondary"
            onClick={() => {
              navigate('settings');
              setTimeout(() => document.getElementById('cloud-backups')?.scrollIntoView(), 0);
            }}
          >
            バックアップ履歴・復元
          </button>
          <a
            className="button secondary"
            href={`${import.meta.env.BASE_URL}?${new URLSearchParams({ book: new URLSearchParams(location.search).get('book') || 'business', recover: '1' })}`}
          >
            新しい端末・復旧用の入口
          </a>
          <button
            className="text-button"
            onClick={() => {
              navigate('settings');
              setTimeout(() => document.getElementById('drive-configuration')?.scrollIntoView(), 0);
            }}
          >
            接続設定・保存先を変更
          </button>
        </div>
        <p className="small muted">
          {drive.connected ? '現在のGoogle接続は有効です。' : 'Googleへの接続が必要です。'}{' '}
          復元前に内容を確認できます。ブラウザのデータを消す前に「保存済み」を確認してください。
        </p>
      </Card>
    </>
  );
}
