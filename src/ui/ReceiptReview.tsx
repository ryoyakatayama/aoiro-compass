import { useEffect, useRef, useState } from 'react';
import { Check, ArrowRight, ScanLine } from 'lucide-react';
import { useApp } from './context';
import { Card, Field, Modal } from './shared';
import { newId, yen, type Snapshot, type Transaction, type Extraction } from '../domain/model';
import { getBlob, sha256 } from '../lib/persistence';
import { report } from '../domain/accounting';
import { ownerBalances, ownerSettlement, type SettlementKind } from '../domain/owner-settlement';

type Item = { key: string; transaction?: Transaction; extraction?: Extraction };
export function reviewItems(s: Snapshot, year: number): Item[] {
  const drafts = s.transactions.filter(
    (t) => t.year === year && t.status === 'draft' && t.kind === 'normal' && t.evidence_ids.length,
  );
  const newest = new Map<string, Extraction>();
  for (const x of s.extractions)
    if (
      !x.transaction_id &&
      s.evidences.some((e) => e.id === x.evidence_id && e.year === year) &&
      !s.transactions.some((t) => t.evidence_ids.includes(x.evidence_id))
    )
      newest.set(x.evidence_id, x);
  const items: Item[] = [
    ...drafts.map((t) => ({ key: t.id, transaction: t })),
    ...Array.from(newest.values(), (x) => ({ key: x.id, extraction: x })),
  ];
  return items.sort((a, b) =>
    (a.transaction?.transaction_date || a.extraction!.transaction_date).localeCompare(
      b.transaction?.transaction_date || b.extraction!.transaction_date,
    ),
  );
}
export default function ReceiptReviewButton() {
  const { s, year } = useApp();
  const [open, setOpen] = useState(false);
  const count = reviewItems(s, year).length,
    locked = s.years.find((y) => y.year === year)?.status !== 'active';
  return (
    <>
      <button
        className="button secondary"
        disabled={!count || locked}
        onClick={() => setOpen(true)}
      >
        <ScanLine size={17} />
        領収書を連続仕訳（{count}件）
      </button>
      {open && <ReviewQueue onClose={() => setOpen(false)} />}
    </>
  );
}
function ReviewQueue({ onClose }: { onClose: () => void }) {
  const { s, year } = useApp();
  const [items] = useState(() => reviewItems(s, year)),
    [index, setIndex] = useState(0),
    [count, setCount] = useState(0),
    [skipped, setSkipped] = useState(0);
  const [payment, setPayment] = useState('3100'),
    [lastAccount, setLastAccount] = useState('');
  const current = items[index];
  if (!current)
    return (
      <Modal title="連続仕訳の確認が終わりました" onClose={onClose}>
        <div className="modal-body">
          <h3>{count}件を確定しました</h3>
          <p>{skipped}件を保留しました。未確定の候補は次回も一覧に残ります。</p>
          <p className="small muted">Driveへの保存状況は画面上部で確認できます。</p>
        </div>
        <div className="modal-footer">
          <button className="button" onClick={onClose}>
            一覧に戻る
          </button>
        </div>
      </Modal>
    );
  return (
    <ReviewItem
      key={current.key}
      item={current}
      position={index + 1}
      total={items.length}
      payment={payment}
      setPayment={setPayment}
      lastAccount={lastAccount}
      onNext={(account) => {
        if (account) {
          setCount((c) => c + 1);
          setLastAccount(account);
        } else setSkipped((c) => c + 1);
        setIndex((i) => i + 1);
      }}
      onClose={onClose}
    />
  );
}
function ReviewItem({
  item,
  position,
  total,
  payment,
  setPayment,
  lastAccount,
  onNext,
  onClose,
}: {
  item: Item;
  position: number;
  total: number;
  payment: string;
  setPayment: (s: string) => void;
  lastAccount: string;
  onNext: (account?: string) => void;
  onClose: () => void;
}) {
  const { s, engine, drive, run, busy, openJournal } = useApp();
  const t = item.transaction,
    x = item.extraction,
    eid = x?.evidence_id || t!.evidence_ids[0],
    e = s.evidences.find((e) => e.id === eid)!;
  const debit = t?.lines.find((l) => l.debit_amount > 0),
    credit = t?.lines.find((l) => l.credit_amount > 0);
  const suggested = s.accounts.find(
    (a) => a.id === x?.suggested_account || a.name === x?.suggested_account,
  );
  const simple =
    !t ||
    (t.lines.length === 2 &&
      !!debit &&
      !!credit &&
      debit.debit_amount === credit.credit_amount &&
      !s.accounts.some((a) => a.id === credit.account_id && a.type === 'revenue'));
  const needsDetail = !simple || suggested?.type === 'revenue';
  const [account, setAccount] = useState(''),
    [query, setQuery] = useState('');
  const [date, setDate] = useState(t?.transaction_date || x!.transaction_date),
    [description, setDescription] = useState(t?.description || x!.vendor),
    [amount, setAmount] = useState(debit?.debit_amount || x?.gross_amount || 0),
    [tax, setTax] = useState(debit?.tax_category || '対象外');
  const [preview, setPreview] = useState(''),
    [previewError, setPreviewError] = useState(''),
    [checkedElsewhere, setCheckedElsewhere] = useState(false);
  const [extra, setExtra] = useState({ code: '', name: '' });
  const saving = useRef(false),
    search = useRef<HTMLInputElement>(null);
  const initial = useRef({ date, description, amount, tax });
  const dirty =
    !!account ||
    Object.entries(initial.current).some(
      ([k, v]) => (({ date, description, amount, tax }) as any)[k] !== v,
    );
  const close = () => {
    if (
      !saving.current &&
      (!dirty || window.confirm('未保存の編集を破棄して連続仕訳を閉じますか？'))
    )
      onClose();
  };
  useEffect(() => {
    search.current?.focus();
  }, []);
  useEffect(() => {
    const f = (event: BeforeUnloadEvent) => {
      if (dirty) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', f);
    return () => window.removeEventListener('beforeunload', f);
  }, [dirty]);
  useEffect(() => {
    let active = true,
      url = '';
    void (async () => {
      const blob =
        (await getBlob(eid)) ||
        (e.drive_file_id && drive.connected ? await drive.download(e.drive_file_id) : undefined);
      if (!blob) throw new Error('原本を表示するにはDriveに接続してください');
      if ((await sha256(blob)) !== e.sha256)
        throw new Error('原本の内容が変更されています。証憑画面で確認してください');
      if (active) {
        url = URL.createObjectURL(blob);
        setPreview(url);
      }
    })().catch((error) => {
      if (active) setPreviewError((error as Error).message);
    });
    return () => {
      active = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [eid, e.drive_file_id, e.sha256, drive]);
  const accounts = s.accounts.filter(
    (a) =>
      a.is_active &&
      (a.type === 'expense' ||
        (a.type === 'asset' && !['1000', '1010', '1100', '1600'].includes(a.id))) &&
      `${a.code} ${a.name}`.toLowerCase().includes(query.toLowerCase()),
  );
  const blocked = ['missing', 'modified', 'duplicate', 'ignored'].includes(e.status);
  const canSave =
    !!account &&
    amount > 0 &&
    Number.isSafeInteger(amount) &&
    amount <= 1e12 &&
    !!description.trim() &&
    !needsDetail &&
    !blocked &&
    (!!preview || checkedElsewhere) &&
    (!previewError || checkedElsewhere) &&
    !busy;
  const save = async () => {
    if (saving.current || !canSave) return;
    saving.current = true;
    const transaction: Transaction = {
      ...(t || { id: newId(), year: e.year, source: 'ai', kind: 'normal', evidence_ids: [eid] }),
      status: 'confirmed',
      transaction_date: date,
      description,
      lines: [
        {
          ...(debit || { memo: '' }),
          account_id: account,
          debit_amount: amount,
          credit_amount: 0,
          tax_category: tax,
        },
        {
          ...(credit || { memo: '' }),
          account_id: payment,
          debit_amount: 0,
          credit_amount: amount,
          tax_category: credit?.tax_category || '対象外',
        },
      ],
    };
    const ok = await run(
      () =>
        engine.write((st) =>
          x ? st.saveReviewedExtraction(x.id, transaction) : st.saveTransaction(transaction),
        ),
      '確定して次の領収書へ進みました',
    );
    saving.current = false;
    if (ok) onNext(account);
  };
  const detail = async () => {
    if (dirty && !window.confirm('この画面の未保存の変更を破棄して、詳細編集へ移りますか？'))
      return;
    if (t) {
      onClose();
      openJournal(t);
      return;
    }
    const id = await run(() => engine.write((st) => st.draftFromExtraction(x!.id)));
    if (id) {
      onClose();
      openJournal(engine.snapshot.transactions.find((t) => t.id === id));
    }
  };
  return (
    <Modal title={`領収書を連続仕訳 · ${position} / ${total}`} wide onClose={close}>
      <div
        className="modal-body receipt-review"
        onKeyDown={(event) => {
          if (
            !event.nativeEvent.isComposing &&
            (event.ctrlKey || event.metaKey) &&
            event.key === 'Enter'
          ) {
            event.preventDefault();
            void save();
          }
        }}
      >
        <section className="review-original">
          <h3>{e.filename}</h3>
          {preview &&
            (e.mime_type === 'application/pdf' ? (
              <iframe title="確認する領収書PDF" src={preview} />
            ) : (
              <img
                src={preview}
                alt="確認する領収書"
                onError={() =>
                  setPreviewError('この形式は表示できません。原本を別のアプリで確認してください')
                }
              />
            ))}
          {previewError && <p className="notice">{previewError}</p>}
          {(!preview || previewError) && (
            <label className="check-row">
              <input
                type="checkbox"
                checked={checkedElsewhere}
                onChange={(event) => setCheckedElsewhere(event.target.checked)}
              />
              原本を別途確認しました
            </label>
          )}
          {x && (
            <div className="notice-block">
              <strong>AI候補：{x.suggested_account}</strong>
              <p>
                信頼度 {Math.round(x.confidence * 100)}% ·{' '}
                {x.warnings.join(' / ') || '確認事項なし'}
              </p>
              {x.tax_summary.length > 1 && (
                <p>複数税率があります。必要なら詳細編集で明細を分けてください。</p>
              )}
            </div>
          )}
          {t && (
            <p className="small muted">
              複数の原本がある場合も既存の紐付けは保持します。現在の支払科目：
              {s.accounts.find((a) => a.id === credit?.account_id)?.name || '詳細を確認'}
            </p>
          )}
        </section>
        <section className="review-fields">
          <div className="review-payment">
            <Field label="この連続処理の支払側（貸方）">
              <select
                value={payment}
                disabled={busy}
                onChange={(event) => setPayment(event.target.value)}
              >
                {s.accounts
                  .filter((a) => a.is_active && ['asset', 'liability', 'equity'].includes(a.type))
                  .map((a) => (
                    <option value={a.id} key={a.id}>
                      {a.name}
                    </option>
                  ))}
              </select>
            </Field>
            <p>初期値は事業主借です。領収書ごとに現金・カードを選び直す必要はありません。</p>
          </div>
          {needsDetail || blocked ? (
            <div className="notice">
              <p>
                {blocked
                  ? '原本の状態に確認が必要です。証憑画面で確認してから確定してください。'
                  : '売上・複合仕訳の候補です。明細を保持して詳細編集で確認してください。'}
              </p>
              <button className="button secondary" disabled={busy} onClick={() => void detail()}>
                詳細編集で開く
              </button>
            </div>
          ) : (
            <>
              <div className="form-grid">
                <Field label="確認する取引日">
                  <input
                    type="date"
                    value={date}
                    onChange={(event) => setDate(event.target.value)}
                  />
                </Field>
                <Field label="確認する金額">
                  <input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={1e12}
                    value={amount || ''}
                    onFocus={(event) => event.target.select()}
                    onChange={(event) => setAmount(Number(event.target.value))}
                  />
                </Field>
              </div>
              <Field label="確認する摘要">
                <input
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                />
              </Field>
              <Field label="経費科目を検索">
                <input
                  ref={search}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="科目名・コードで絞り込み"
                />
              </Field>
              <p className="small muted">借方を選んで確定します。AIの候補は自動確定しません。</p>
              {lastAccount && (
                <button className="text-button" onClick={() => setAccount(lastAccount)}>
                  前と同じ：{s.accounts.find((a) => a.id === lastAccount)?.name}
                </button>
              )}
              <div className="review-accounts" role="group" aria-label="経費科目の候補">
                {accounts.map((a) => (
                  <button
                    key={a.id}
                    className={`account-choice ${account === a.id ? 'selected' : ''}`}
                    aria-pressed={account === a.id}
                    onClick={() => setAccount(a.id)}
                  >
                    {a.name}
                  </button>
                ))}
              </div>
              <details className="details">
                <summary>科目を追加・税区分を確認</summary>
                <div className="form-grid">
                  <Field label="連続仕訳で追加する科目コード">
                    <input
                      value={extra.code}
                      onChange={(e) => setExtra({ ...extra, code: e.target.value })}
                    />
                  </Field>
                  <Field label="連続仕訳で追加する科目名">
                    <input
                      value={extra.name}
                      onChange={(e) => setExtra({ ...extra, name: e.target.value })}
                    />
                  </Field>
                </div>
                <button
                  className="button secondary"
                  disabled={busy || !extra.code || !extra.name}
                  onClick={() =>
                    void run(async () => {
                      await engine.write((st) => st.addAccount({ ...extra, type: 'expense' }));
                      setAccount(extra.code);
                      setQuery('');
                      setExtra({ code: '', name: '' });
                    })
                  }
                >
                  追加してこの領収書に使う
                </button>
                <Field label="確認する税区分">
                  <input value={tax} onChange={(event) => setTax(event.target.value)} />
                </Field>
                <p className="small muted">
                  複数明細・按分・消費税の分割が必要な取引は詳細編集を使います。
                </p>
                <button className="text-button" onClick={() => void detail()}>
                  詳細編集で開く
                </button>
              </details>
            </>
          )}
        </section>
      </div>
      <div className="modal-footer review-footer">
        <div>
          <strong>
            {account ? s.accounts.find((a) => a.id === account)?.name : '経費科目を選択'} /{' '}
            {s.accounts.find((a) => a.id === payment)?.name}
          </strong>
          <small>{yen(amount)} · Ctrl / ⌘ + Enterで確定</small>
        </div>
        <div className="actions">
          <button
            className="button secondary"
            disabled={busy}
            onClick={() => {
              if (!dirty || window.confirm('この領収書の編集を保存せず保留しますか？')) onNext();
            }}
          >
            保留して次へ
          </button>
          <button
            className="button"
            disabled={!canSave || (!!previewError && !checkedElsewhere)}
            onClick={() => void save()}
          >
            <Check size={17} />
            確定して次へ
            <ArrowRight size={16} />
          </button>
        </div>
      </div>
    </Modal>
  );
}

export function OwnerSettlement() {
  const { s, year, openJournal, engine, run, busy } = useApp();
  const [amount, setAmount] = useState(0),
    [date, setDate] = useState(`${year}-12-31`),
    [payment, setPayment] = useState('1000'),
    [memo, setMemo] = useState('');
  const [ack, setAck] = useState(false);
  const r = report(s, year),
    owner = r.balance.find((a) => a.id === '3100')?.balance || 0,
    cash = r.balance.find((a) => a.id === payment)?.balance || 0;
  const balances = ownerBalances(s, year),
    [cashAck, setCashAck] = useState(false),
    saving = useRef(false);
  useEffect(() => setCashAck(false), [date, balances.borrow, balances.lend]);
  const execute = async (kind: SettlementKind) => {
    if (saving.current || busy || (kind !== 'offset' && !cashAck)) return;
    saving.current = true;
    await run(
      () =>
        engine.write((st) => {
          const current = st.snapshot(),
            latest = ownerBalances(current, year);
          if (JSON.stringify(latest) !== JSON.stringify(balances))
            throw new Error('残高が更新されました。最新の金額を確認してから実行してください');
          return st.saveTransaction(ownerSettlement(current, year, date, kind));
        }, '事業主勘定の整理前'),
      '事業主勘定の整理仕訳を確定しました',
    );
    saving.current = false;
  };
  return (
    <Card
      title="事業主借の精算・調整"
      subtitle="経費を事業主借で記帳した後、実際に事業用の現金などから精算した金額を入力します。"
    >
      <p>
        事業主勘定の残高があるだけで相殺・現金精算が必要になるわけではありません。残高は翌期の元入金への繰越でも扱えます。
      </p>
      <div className="settlement-balances">
        <span>
          事業主借 <strong>{yen(balances.borrow)}</strong>
        </span>
        <span>
          事業主貸 <strong>{yen(balances.lend)}</strong>
        </span>
        <span>
          現金 <strong>{yen(balances.cash)}</strong>
        </span>
      </div>
      <Field label="ワンクリック処理の記帳日">
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </Field>
      <label className="check-row">
        <input type="checkbox" checked={cashAck} onChange={(e) => setCashAck(e.target.checked)} />
        現金を動かす処理は、この日付・金額で実際に現金を授受しました
      </label>
      <div className="settlement-actions">
        {(['offset', 'cash_in', 'cash_out'] as const).map((kind) => {
          const value =
            kind === 'offset'
              ? Math.max(0, Math.min(balances.borrow, balances.lend))
              : Math.max(0, kind === 'cash_in' ? balances.lend : balances.borrow);
          const after = {
            borrow: balances.borrow - (kind === 'cash_in' ? 0 : value),
            lend: balances.lend - (kind === 'cash_out' ? 0 : value),
            cash: balances.cash + (kind === 'cash_in' ? value : kind === 'cash_out' ? -value : 0),
          };
          return (
            <section key={kind}>
              <h3>
                {kind === 'offset'
                  ? '事業主貸と事業主借を相殺'
                  : kind === 'cash_in'
                    ? '本人から現金を補填'
                    : '本人へ現金で精算'}
              </h3>
              <strong>{yen(value)}</strong>
              <p>
                {kind === 'offset'
                  ? '借方 事業主借 / 貸方 事業主貸'
                  : kind === 'cash_in'
                    ? '借方 現金 / 貸方 事業主貸'
                    : '借方 事業主借 / 貸方 現金'}
              </p>
              <p className="small muted">
                処理後：事業主借 {yen(after.borrow)}・事業主貸 {yen(after.lend)}・現金{' '}
                {yen(after.cash)}
              </p>
              <button
                className="button secondary"
                disabled={
                  busy ||
                  value <= 0 ||
                  !date.startsWith(`${year}-`) ||
                  s.years.find((y) => y.year === year)?.status !== 'active' ||
                  (kind !== 'offset' && !cashAck) ||
                  (kind === 'cash_out' && after.cash < 0)
                }
                onClick={() => void execute(kind)}
              >
                {kind === 'offset'
                  ? 'この金額で相殺を確定'
                  : kind === 'cash_in'
                    ? '現金補填の仕訳を確定'
                    : '現金精算の仕訳を確定'}
              </button>
              {kind === 'cash_out' && after.cash < 0 && (
                <p className="small">
                  現金残高が不足しています。現金の入出金を先に確認してください。
                </p>
              )}
            </section>
          );
        })}
      </div>
      <details className="details">
        <summary>一部の金額・普通預金で精算する</summary>
        <div className="settlement-balances">
          <span>
            事業主借の帳簿残高 <strong>{yen(owner)}</strong>
          </span>
          <span>
            支払口座の帳簿残高 <strong>{yen(cash)}</strong>
          </span>
        </div>
        <div className="form-grid">
          <Field label="精算・調整日">
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="精算に使った口座">
            <select value={payment} onChange={(e) => setPayment(e.target.value)}>
              {s.accounts
                .filter((a) => ['1000', '1010'].includes(a.id))
                .map((a) => (
                  <option value={a.id} key={a.id}>
                    {a.name}
                  </option>
                ))}
            </select>
          </Field>
          <Field label="実際に精算した金額">
            <input
              type="number"
              min={1}
              max={1e12}
              inputMode="numeric"
              value={amount || ''}
              onChange={(e) => setAmount(Number(e.target.value))}
            />
          </Field>
          <Field label="精算・調整の根拠">
            <input
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              placeholder="精算日、対象期間、金額を確かめた資料など"
            />
          </Field>
        </div>
        <p>
          作成する仕訳：借方 事業主借 {yen(amount)} / 貸方{' '}
          {s.accounts.find((a) => a.id === payment)?.name} {yen(amount)}
          。経費を再計上せず、精算だけを記録します。
        </p>
        {amount > 0 && (
          <p className={cash - amount < 0 || owner - amount < 0 ? 'notice' : 'small muted'}>
            確定後の見込み：事業主借 {yen(owner - amount)} / 支払口座 {yen(cash - amount)}。
            {cash - amount < 0 || owner - amount < 0
              ? '残高が負になります。金額と元の帳簿を確認してください。'
              : ''}
          </p>
        )}
        <label className="check-row">
          <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
          実際の精算・支払と根拠を確認しました
        </label>
        <button
          className="button secondary"
          disabled={
            !ack ||
            !memo.trim() ||
            !Number.isSafeInteger(amount) ||
            amount <= 0 ||
            amount > 1e12 ||
            !date.startsWith(String(year) + '-') ||
            s.years.find((y) => y.year === year)?.status !== 'active'
          }
          onClick={() =>
            openJournal({
              id: newId(),
              year,
              transaction_date: date,
              description: `事業主借の精算：${memo}`,
              status: 'draft',
              source: 'owner_settlement',
              kind: 'normal',
              evidence_ids: [],
              lines: [
                {
                  account_id: '3100',
                  debit_amount: amount,
                  credit_amount: 0,
                  tax_category: '対象外',
                  memo,
                },
                {
                  account_id: payment,
                  debit_amount: 0,
                  credit_amount: amount,
                  tax_category: '対象外',
                  memo,
                },
              ],
            })
          }
        >
          調整仕訳の下書きを確認
        </button>
      </details>
      <p className="small muted">
        残高を合わせる目的で全額を自動振替しません。私費で負担したままの分、元の記帳誤り、年度をまたぐ取引は区別して確認できます。
        <a
          href="https://www.nta.go.jp/taxes/shiraberu/shinkoku/tebiki/2025/pdf/046.pdf"
          target="_blank"
          rel="noreferrer"
        >
          国税庁：事業主借の説明
        </a>
      </p>
    </Card>
  );
}
