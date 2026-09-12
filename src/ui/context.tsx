import { createContext, useContext } from 'react';
import type { Snapshot, Transaction } from '../domain/model';
import type { Engine } from '../lib/persistence';
import type { DriveAdapter } from '../lib/drive';
import type { LedgerSync, SyncStatus } from '../lib/ledger-sync';
export type Page =
  | 'dashboard'
  | 'ledger'
  | 'evidence'
  | 'bank'
  | 'assets'
  | 'archive'
  | 'reports'
  | 'consult'
  | 'closing'
  | 'settings';
export interface AppContextValue {
  engine: Engine;
  drive: DriveAdapter;
  s: Snapshot;
  year: number;
  setYear: (y: number) => void;
  page: Page;
  navigate: (p: Page) => void;
  run: <T>(fn: () => Promise<T> | T, success?: string) => Promise<T | undefined>;
  busy: boolean;
  openJournal: (t?: Transaction) => void;
  toast: (s: string) => void;
  sync: () => Promise<void>;
  connected: boolean;
  setConnected: (v: boolean) => void;
  ledgerSync: LedgerSync;
  syncStatus: SyncStatus;
}
export const AppContext = createContext<AppContextValue | null>(null);
export function useApp() {
  const c = useContext(AppContext);
  if (!c) throw new Error('App context missing');
  return c;
}
