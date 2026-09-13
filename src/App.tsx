import {
  useState,
  useEffect,
  useMemo,
  useSyncExternalStore,
  Component,
  type ReactNode,
} from 'react';
import {
  LayoutDashboard,
  BookOpen,
  Files,
  Landmark,
  Package,
  ChartNoAxesCombined,
  MessageCircle,
  LockKeyhole,
  Settings,
  Menu,
  X,
  Cloud,
  RefreshCw,
  Download,
  Compass,
  ArrowUpRight,
  WifiOff,
} from 'lucide-react';
import type { Engine } from './lib/persistence';
import { bookKind, bookLabel, switchBook } from './lib/book';
import { demoMode, configureBackupUpload } from './lib/persistence';
import { DriveAdapter } from './lib/drive';
import { LedgerSync } from './lib/ledger-sync';
import { exportSyncData } from './lib/sync-data';
import { canonical } from './lib/sync-graph';
import { AppContext, type Page } from './ui/context';
import type { Transaction } from './domain/model';
import { labels } from './domain/model';
import Dashboard from './ui/Dashboard';
import Ledger, { JournalEditor } from './ui/Ledger';
import Evidence from './ui/Evidence';
import Bank from './ui/Bank';
import Assets from './ui/Assets';
import Reports from './ui/Reports';
import Consult from './ui/Consult';
import SettingsPage from './ui/Settings';
import Closing from './ui/Closing';
import ArchivePage from './ui/Archive';
import DriveHub, { DriveStatus } from './ui/DriveHub';
import Filing from './ui/Filing';
import Comparison from './ui/Comparison';
const nav: { id: Page; label: string; icon: typeof LayoutDashboard }[] = [
  { id: 'dashboard', label: 'ダッシュボード', icon: LayoutDashboard },
  { id: 'comparison', label: '年度・所得を比較', icon: ChartNoAxesCombined },
  { id: 'drive', label: 'Google Drive同期', icon: Cloud },
  { id: 'ledger', label: '仕訳・記帳', icon: BookOpen },
  { id: 'evidence', label: '証憑ライブラリ', icon: Files },
  { id: 'bank', label: '銀行・カード照合', icon: Landmark },
  { id: 'assets', label: '固定資産', icon: Package },
  { id: 'reports', label: '帳簿・レポート', icon: ChartNoAxesCombined },
  { id: 'consult', label: 'AI税務相談', icon: MessageCircle },
  { id: 'archive', label: '過年度資料', icon: Files },
  { id: 'filing', label: '確定申告の準備', icon: Files },
  { id: 'closing', label: '年度締め・繰越', icon: LockKeyhole },
];
export default function App({ engine }: { engine: Engine }) {
  const s = useSyncExternalStore(engine.subscribe, engine.getSnapshot);
  const [page, setPage] = useState<Page>((location.hash.slice(1) as Page) || 'comparison'),
    [year, setYear] = useState(() => {
      const saved = Number(
        new URLSearchParams(location.search).get('year') ||
          localStorage.getItem(`aoiro-selected-year-${bookKind}-${demoMode}`),
      );
      return s.years.some((y) => y.year === saved) ? saved : s.years[0].year;
    }),
    [mobile, setMobile] = useState(false),
    [toast, setToast] = useState(''),
    [busy, setBusy] = useState(false),
    [job, setJob] = useState(''),
    [connected, setConnected] = useState(false),
    [online, setOnline] = useState(navigator.onLine),
    [editor, setEditor] = useState<{ value?: Transaction } | null>(null),
    [install, setInstall] = useState<any>(null),
    [update, setUpdate] = useState<(() => void) | null>(null);
  const drive = useMemo(() => new DriveAdapter(engine), [engine]);
  const ledgerSync = useMemo(() => new LedgerSync(engine, drive), [engine, drive]);
  const syncStatus = useSyncExternalStore(ledgerSync.subscribe, ledgerSync.getSnapshot);
  useEffect(() => {
    configureBackupUpload(async (bytes, id, reason) => {
      if (demoMode || !drive.connected || !navigator.onLine) return false;
      await drive.storeBackup(bytes, id, reason);
      return true;
    });
    return () => configureBackupUpload();
  }, [drive]);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let last = canonical(exportSyncData(engine.store));
    const synchronize = () => {
      if (document.visibilityState !== 'hidden') void ledgerSync.sync();
    };
    const unsubscribe = engine.subscribe(() => {
      const next = canonical(exportSyncData(engine.store));
      if (next === last) return;
      last = next;
      ledgerSync.markDirty();
      clearTimeout(timer);
      timer = setTimeout(synchronize, 2000);
    });
    const interval = setInterval(synchronize, 30000);
    window.addEventListener('online', synchronize);
    window.addEventListener('focus', synchronize);
    document.addEventListener('visibilitychange', synchronize);
    synchronize();
    return () => {
      clearTimeout(timer);
      clearInterval(interval);
      unsubscribe();
      window.removeEventListener('online', synchronize);
      window.removeEventListener('focus', synchronize);
      document.removeEventListener('visibilitychange', synchronize);
    };
  }, [engine, ledgerSync, connected, s.settings.ledger_sync_enabled]);
  useEffect(() => {
    localStorage.setItem(`aoiro-selected-year-${bookKind}-${demoMode}`, String(year));
  }, [year]);
  useEffect(() => {
    if (!s.years.some((y) => y.year === year)) setYear(s.years[0].year);
  }, [s.years, year]);
  useEffect(() => {
    const f = () => setPage((location.hash.slice(1) || 'comparison') as Page);
    window.addEventListener('hashchange', f);
    return () => window.removeEventListener('hashchange', f);
  }, []);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(''), 7000);
    return () => clearTimeout(id);
  }, [toast]);
  useEffect(() => {
    const onInstall = (event: Event) => {
      event.preventDefault();
      setInstall(event);
    };
    const onUpdate = (event: Event) => setUpdate(() => (event as CustomEvent).detail);
    window.addEventListener('beforeinstallprompt', onInstall);
    window.addEventListener('aoiro-update', onUpdate);
    return () => {
      window.removeEventListener('beforeinstallprompt', onInstall);
      window.removeEventListener('aoiro-update', onUpdate);
    };
  }, []);
  const run = async <T,>(fn: () => Promise<T> | T, success?: string): Promise<T | undefined> => {
    setBusy(true);
    try {
      const result = await fn();
      if (success) setToast(success);
      return result;
    } catch (e) {
      const error = e as Error & { issues?: { message: string; path: unknown[] }[] };
      setToast(
        error.issues
          ? error.issues
              .map((i) => `${i.path.join('.')}: ${i.message}`)
              .slice(0, 3)
              .join(' / ')
          : error.message || '処理に失敗しました',
      );
      return undefined;
    } finally {
      setBusy(false);
    }
  };
  const sync = async () => {
    await run(async () => {
      if (!drive.connected) {
        const id = s.settings.google_client_id || import.meta.env.VITE_GOOGLE_CLIENT_ID;
        if (!id) {
          setPage('settings');
          location.hash = 'settings';
          setTimeout(() => document.getElementById('drive-configuration')?.scrollIntoView(), 0);
          throw new Error(
            '初回の接続設定が必要です。「Google Driveとの連携」にClient IDを入力してください',
          );
        }
        await drive.connect(id);
        setConnected(true);
      }
      await drive.sync(year, setJob);
      await ledgerSync.sync();
      if (ledgerSync.getSnapshot().phase !== 'synced')
        throw new Error(ledgerSync.getSnapshot().message);
    }, 'Drive同期が完了しました');
    setJob('');
  };
  useEffect(() => {
    const status = () => {
      setOnline(navigator.onLine);
      if (navigator.onLine && drive.connected)
        void drive.flushQueue(year).catch((e) => setToast((e as Error).message));
    };
    window.addEventListener('online', status);
    window.addEventListener('offline', status);
    return () => {
      window.removeEventListener('online', status);
      window.removeEventListener('offline', status);
    };
  }, [drive, year]);
  const navigate = (p: Page) => {
    setPage(p);
    location.hash = p;
    setMobile(false);
    window.scrollTo(0, 0);
  };
  const pageComponent = {
    dashboard: <Dashboard />,
    comparison: <Comparison />,
    drive: <DriveHub />,
    filing: <Filing />,
    ledger: <Ledger />,
    evidence: <Evidence />,
    bank: <Bank />,
    assets: <Assets />,
    reports: <Reports />,
    archive: <ArchivePage />,
    consult: <Consult />,
    closing: <Closing />,
    settings: <SettingsPage />,
  }[page] || <Dashboard />;
  const context = {
    engine,
    drive,
    s,
    year,
    setYear,
    page,
    navigate,
    run,
    busy,
    openJournal: (value?: Transaction) => setEditor({ value }),
    toast: setToast,
    sync,
    connected,
    setConnected,
    ledgerSync,
    syncStatus,
  };
  return (
    <AppContext.Provider value={context}>
      <div className="app-shell">
        {mobile && (
          <button
            className="nav-overlay"
            aria-label="メニューを閉じる"
            onClick={() => setMobile(false)}
          />
        )}
        <aside className={`sidebar ${mobile ? 'is-open' : ''}`}>
          <a className="brand" href="#comparison" onClick={() => navigate('comparison')}>
            <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" />
            <div>
              <strong>青色コンパス</strong>
              <span>AOIRO COMPASS</span>
            </div>
          </a>
          <div className="workspace-label">
            <span className="workspace-avatar">{s.profile.business_name?.slice(0, 1) || '個'}</span>
            <div>
              <strong>{s.profile.business_name || 'わたしの事業'}</strong>
              <small>{bookLabel}の帳簿</small>
            </div>
          </div>
          <span className="nav-label">WORKSPACE</span>
          <nav aria-label="メインナビゲーション">
            {nav.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                className={`nav-item ${page === id ? 'active' : ''}`}
                onClick={() => navigate(id)}
                aria-current={page === id ? 'page' : undefined}
              >
                <Icon size={19} />
                <span>{label}</span>
                {id === 'consult' && <span className="nav-tag">AI</span>}
              </button>
            ))}
          </nav>
          <div className="sidebar-bottom">
            <div className="local-card">
              <span className="local-icon">
                <Compass size={19} />
              </span>
              <strong>あなたの記録は、あなたのもの。</strong>
              <p>
                帳簿は端末とDriveに。
                <br />
                原本はいつものDriveに。
              </p>
              <button onClick={() => navigate('drive')}>
                保存とバックアップ
                <ArrowUpRight size={14} />
              </button>
            </div>
            <button
              className={`nav-item ${page === 'settings' ? 'active' : ''}`}
              onClick={() => navigate('settings')}
            >
              <Settings size={19} />
              <span>事業情報・設定</span>
            </button>
            <div className="version">
              AOIRO COMPASS <span>v0.5</span>
            </div>
          </div>
        </aside>
        <div className="main-shell">
          <header className="topbar">
            <div className="topbar-left">
              <button
                className="icon-button mobile-menu"
                aria-label="メニューを開く"
                onClick={() => setMobile(true)}
              >
                <Menu />
              </button>
              <span className="breadcrumb">
                ワークスペース<span>/</span>
                <strong>{nav.find((n) => n.id === page)?.label || '事業情報・設定'}</strong>
              </span>
            </div>
            <div className="topbar-actions">
              <select
                className="book-select"
                aria-label="所得区分・帳簿を切り替え"
                value={bookKind}
                disabled={!!editor || page === 'comparison'}
                onChange={(e) => switchBook(e.target.value as 'business' | 'misc')}
              >
                <option value="business">事業所得</option>
                <option value="misc">雑所得</option>
              </select>
              {!online && (
                <span className="offline-chip">
                  <WifiOff size={14} />
                  オフライン
                </span>
              )}
              <button className="drive-indicator" onClick={() => navigate('drive')}>
                <span className={`status-dot ${drive.connected ? '' : 'disconnected'}`} />
                {syncStatus.phase === 'synced'
                  ? 'Drive保存済み'
                  : syncStatus.phase === 'syncing'
                    ? 'Drive保存中'
                    : 'Drive未保存・要確認'}
              </button>
              <label className="year-select">
                <select
                  aria-label="会計年度"
                  disabled={page === 'comparison' || page === 'assets'}
                  value={year}
                  onChange={(e) => setYear(Number(e.target.value))}
                >
                  {s.years.map((y) => (
                    <option key={y.year} value={y.year}>
                      {y.year}年度 · {labels[y.status]}
                    </option>
                  ))}
                </select>
              </label>
              {install && (
                <button
                  className="icon-button"
                  aria-label="アプリをインストール"
                  onClick={() => void install.prompt()}
                >
                  <Download size={19} />
                </button>
              )}
              {update && (
                <button
                  className="button secondary compact"
                  disabled={busy || !!editor}
                  onClick={update}
                >
                  更新を適用
                </button>
              )}
            </div>
          </header>
          {demoMode && (
            <div className="demo-banner">
              <span>体験用デモ · 架空の帳簿データ / 実データとは別に保存されます</span>
              <a href={import.meta.env.BASE_URL}>
                自分の帳簿に戻る
                <ArrowUpRight size={14} />
              </a>
            </div>
          )}
          {busy && (
            <div className="progress-line" role="status">
              <span />
              {job && <small>{job}</small>}
            </div>
          )}
          {page !== 'drive' && <DriveStatus compact />}
          <main key={page}>
            <ErrorBoundary key={`${page}-${year}`}>{pageComponent}</ErrorBoundary>
          </main>
          <footer className="app-footer">
            <span>青色コンパス</span>
            <span>日々の記録から、次の一歩へ。</span>
            <span>{engine.mode} · この端末に保存</span>
          </footer>
        </div>
        {toast && (
          <div className="toast" role="status">
            <span>{toast}</span>
            <button aria-label="通知を閉じる" onClick={() => setToast('')}>
              <X size={17} />
            </button>
          </div>
        )}
        {editor && <JournalEditor initial={editor.value} onClose={() => setEditor(null)} />}
      </div>
    </AppContext.Provider>
  );
}
class ErrorBoundary extends Component<{ children: ReactNode }, { error: string }> {
  state = { error: '' };
  static getDerivedStateFromError(error: Error) {
    return { error: error.message };
  }
  render() {
    return this.state.error ? (
      <div className="fatal-error">
        <h2>画面を表示できませんでした</h2>
        <p>{this.state.error}</p>
        <button className="button" onClick={() => location.reload()}>
          再読み込み
        </button>
        <p>保存済みの帳簿は保持されています。</p>
      </div>
    ) : (
      this.props.children
    );
  }
}
