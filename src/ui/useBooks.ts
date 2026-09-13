import { useEffect, useState, useCallback } from 'react';
import { useApp } from './context';
import { bookKind, type BookKind } from '../lib/book';
import { bookNamespace, readBookSnapshot } from '../lib/persistence';
import type { Snapshot } from '../domain/model';
import type { Books } from '../domain/comparison';
export function useBooks() {
  const { s } = useApp();
  const other: BookKind = bookKind === 'business' ? 'misc' : 'business';
  const [snapshot, setSnapshot] = useState<Snapshot>(),
    [error, setError] = useState(''),
    [loadedAt, setLoadedAt] = useState('');
  const refresh = useCallback(async () => {
    try {
      setSnapshot(await readBookSnapshot(other));
      setLoadedAt(new Date().toLocaleString());
      setError('');
    } catch (e) {
      setSnapshot(undefined);
      setError((e as Error).message);
    }
  }, [other]);
  useEffect(() => {
    void refresh();
    const c = new BroadcastChannel(bookNamespace(other));
    c.onmessage = () => {
      void refresh();
    };
    const onFocus = () => {
      void refresh();
    };
    window.addEventListener('focus', onFocus);
    return () => {
      c.close();
      window.removeEventListener('focus', onFocus);
    };
  }, [refresh, other]);
  const differentAccount = !!(
    snapshot?.settings.ledger_sync_scope &&
    s.settings.ledger_sync_scope &&
    snapshot.settings.ledger_sync_scope !== s.settings.ledger_sync_scope
  );
  const books: Books = {
    [bookKind]: s,
    ...(!differentAccount && snapshot ? { [other]: snapshot } : {}),
  };
  return {
    books,
    refresh,
    loadedAt,
    error: differentAccount
      ? '帳簿のGoogleアカウントが異なるため合算していません。同じアカウントの帳簿を接続してください。'
      : error,
  };
}
