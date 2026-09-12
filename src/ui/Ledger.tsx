import { useState } from 'react';
import { Plus, Search, Download, Trash2, LockKeyhole, Check } from 'lucide-react';
import { useApp } from './context';
import { PageHeading, Card, Badge, Empty, Modal, Field } from './shared';
import { newId, today, yen, type Transaction, type JournalLine } from '../domain/model';
import { total } from '../domain/accounting';
import { download } from '../lib/persistence';
import { journalCsv } from '../lib/packs';
export default function Ledger() {
  const { s, year, openJournal } = useApp();
  const [q, setQ] = useState(''),
    [status, setStatus] = useState('all'),
    [month, setMonth] = useState('all'),
    [account, setAccount] = useState('all');
  const tx = s.transactions.filter(
    (t) =>
      t.year === year &&
      (status === 'all' || t.status === status) &&
      (month === 'all' || Number(t.transaction_date.slice(5, 7)) === Number(month)) &&
      (account === 'all' || t.lines.some((l) => l.account_id === account)) &&
      (t.description.toLowerCase().includes(q.toLowerCase()) || t.id.includes(q)),
  );
  return (
    <>
      <PageHeading
        eyebrow="JOURNAL"
        title="日々の取引を、整える。"
        description="売上・経費から複合仕訳まで。下書きを確かめてから正式な帳簿へ。"
        actions={
          <>
            <button
              className="button secondary"
              onClick={() =>
                download(`${year}_仕訳帳.csv`, journalCsv(s, year), 'text/csv;charset=utf-8')
              }
            >
              <Download size={16} />
              CSV出力
            </button>
            <button className="button" onClick={() => openJournal()}>
              <Plus size={17} />
              取引を記帳
            </button>
          </>
        }
      />
      <Card>
        <div className="filterbar">
          <label className="search-field">
            <Search size={17} />
            <input
              aria-label="仕訳を検索"
              placeholder="取引内容を検索"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </label>
          <select
            aria-label="仕訳の状態"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="all">すべての状態</option>
            <option value="draft">下書き</option>
            <option value="confirmed">確定</option>
            <option value="locked">ロック</option>
          </select>
          <select aria-label="対象月" value={month} onChange={(e) => setMonth(e.target.value)}>
            <option value="all">すべての月</option>
            {Array.from({ length: 12 }, (_, i) => (
              <option key={i} value={i + 1}>
                {i + 1}月
              </option>
            ))}
          </select>
          <select
            aria-label="対象科目"
            value={account}
            onChange={(e) => setAccount(e.target.value)}
          >
            <option value="all">すべての科目</option>
            {s.accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <span className="small muted">{tx.length}件</span>
        </div>
        {tx.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>日付</th>
                  <th>摘要 / 科目</th>
                  <th>借方合計</th>
                  <th>貸方合計</th>
                  <th>証憑</th>
                  <th>状態</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {tx.map((t) => (
                  <tr key={t.id}>
                    <td>{t.transaction_date}</td>
                    <td>
                      <button className="plain-link" onClick={() => openJournal(t)}>
                        {t.description}
                      </button>
                      <small className="table-sub">
                        {t.kind === 'opening' ? '期首残高 · ' : ''}
                        {[
                          ...new Set(
                            t.lines.map((l) => s.accounts.find((a) => a.id === l.account_id)?.name),
                          ),
                        ].join(' / ')}
                      </small>
                    </td>
                    <td className="number">{yen(total(t.lines, 'debit_amount'))}</td>
                    <td className="number">{yen(total(t.lines, 'credit_amount'))}</td>
                    <td>{t.evidence_ids.length}件</td>
                    <td>
                      <Badge value={t.status} />
                    </td>
                    <td>
                      <button className="text-button" onClick={() => openJournal(t)}>
                        開く
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="表示する仕訳がありません">
            条件を変えるか、「取引を記帳」から追加してください。
          </Empty>
        )}
      </Card>
    </>
  );
}
export function JournalEditor({
  initial,
  onClose,
}: {
  initial?: Transaction;
  onClose: () => void;
}) {
  const { s, year, engine, run, busy } = useApp();
  const targetYear = initial?.year || year;
  const locked = s.years.find((y) => y.year === targetYear)?.status !== 'active';
  const [value, setValue] = useState<Transaction>(
    initial || {
      id: newId(),
      year: targetYear,
      transaction_date: today().startsWith(String(targetYear)) ? today() : `${targetYear}-01-01`,
      description: '',
      status: 'draft',
      source: 'manual',
      kind: 'normal',
      lines: [
        { account_id: '5200', debit_amount: 0, credit_amount: 0, tax_category: '対象外', memo: '' },
        { account_id: '3100', debit_amount: 0, credit_amount: 0, tax_category: '対象外', memo: '' },
      ],
      evidence_ids: [],
    },
  );
  const [reason, setReason] = useState('');
  const [newAccount, setNewAccount] = useState({ code: '', name: '', type: 'expense' });
  const readonly = locked || value.status !== 'draft';
  const debit = total(value.lines, 'debit_amount'),
    credit = total(value.lines, 'credit_amount');
  const changeLine = (i: number, patch: Partial<JournalLine>) =>
    setValue((v) => ({ ...v, lines: v.lines.map((l, j) => (i === j ? { ...l, ...patch } : l)) }));
  const save = async (status: 'draft' | 'confirmed') => {
    const ok = await run(
      () => engine.write((st) => st.saveTransaction({ ...value, status })),
      status === 'confirmed' ? '仕訳を確定しました' : '下書きを保存しました',
    );
    if (ok) onClose();
  };
  return (
    <Modal title={initial ? '仕訳の詳細' : '取引を記帳'} wide onClose={onClose}>
      <div className="modal-body">
        <div className="journal-state">
          <Badge value={value.status} />
          <span className="small muted">
            {targetYear}年 · {value.source === 'ai' ? 'AI読取から作成した候補です' : '複式簿記'}
          </span>
        </div>
        <div className="form-grid">
          <Field label="取引日">
            <input
              type="date"
              value={value.transaction_date}
              disabled={readonly}
              onChange={(e) => setValue({ ...value, transaction_date: e.target.value })}
            />
          </Field>
          <Field label="取引区分">
            <select
              value={value.kind}
              disabled={readonly}
              onChange={(e) => setValue({ ...value, kind: e.target.value as 'normal' | 'opening' })}
            >
              <option value="normal">通常の取引</option>
              <option value="opening">期首残高</option>
            </select>
          </Field>
          <Field label="摘要（取引内容）" className="span-2">
            <input
              value={value.description}
              maxLength={2000}
              disabled={readonly}
              placeholder="例：9月分の制作報酬 / 作業用の備品購入"
              onChange={(e) => setValue({ ...value, description: e.target.value })}
            />
          </Field>
        </div>
        {!readonly && (
          <div className="quick-presets">
            <span>かんたん入力</span>
            <button
              onClick={() =>
                setValue({
                  ...value,
                  lines: [
                    {
                      ...value.lines[0],
                      account_id: '1010',
                      debit_amount: debit,
                      credit_amount: 0,
                    },
                    {
                      ...value.lines[1],
                      account_id: '4000',
                      debit_amount: 0,
                      credit_amount: debit,
                    },
                  ],
                })
              }
            >
              売上入金
            </button>
            <button
              onClick={() =>
                setValue({
                  ...value,
                  lines: [
                    {
                      ...value.lines[0],
                      account_id: '5200',
                      debit_amount: debit,
                      credit_amount: 0,
                    },
                    {
                      ...value.lines[1],
                      account_id: '3100',
                      debit_amount: 0,
                      credit_amount: debit,
                    },
                  ],
                })
              }
            >
              個人立替の経費
            </button>
            <button
              onClick={() =>
                setValue({
                  ...value,
                  lines: [
                    {
                      ...value.lines[0],
                      account_id: '1010',
                      debit_amount: debit,
                      credit_amount: 0,
                    },
                    {
                      ...value.lines[1],
                      account_id: '1100',
                      debit_amount: 0,
                      credit_amount: debit,
                    },
                  ],
                })
              }
            >
              売掛金の回収
            </button>
          </div>
        )}
        <div className="journal-lines">
          <div className="journal-line line-head">
            <span>勘定科目</span>
            <span>借方（円）</span>
            <span>貸方（円）</span>
            <span />
          </div>
          {value.lines.map((l, i) => (
            <div className="journal-line-wrap" key={i}>
              <div className="journal-line">
                <select
                  aria-label={`${i + 1}行目の勘定科目`}
                  disabled={readonly}
                  value={l.account_id}
                  onChange={(e) => changeLine(i, { account_id: e.target.value })}
                >
                  {s.accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
                <input
                  aria-label={`${i + 1}行目の借方`}
                  type="number"
                  min="0"
                  step="1"
                  value={l.debit_amount || ''}
                  disabled={readonly}
                  onChange={(e) => changeLine(i, { debit_amount: Number(e.target.value) })}
                  placeholder="0"
                />
                <input
                  aria-label={`${i + 1}行目の貸方`}
                  type="number"
                  min="0"
                  step="1"
                  value={l.credit_amount || ''}
                  disabled={readonly}
                  onChange={(e) => changeLine(i, { credit_amount: Number(e.target.value) })}
                  placeholder="0"
                />
                <button
                  className="icon-button"
                  disabled={readonly || value.lines.length <= 2}
                  aria-label={`${i + 1}行目を削除`}
                  onClick={() =>
                    setValue({ ...value, lines: value.lines.filter((_, j) => i !== j) })
                  }
                >
                  <Trash2 size={16} />
                </button>
              </div>
              <div className="line-options">
                <input
                  aria-label={`${i + 1}行目の税区分`}
                  value={l.tax_category}
                  disabled={readonly}
                  placeholder="税区分"
                  list="tax-categories"
                  onChange={(e) => changeLine(i, { tax_category: e.target.value })}
                />
                <input
                  aria-label={`${i + 1}行目のメモ`}
                  value={l.memo}
                  disabled={readonly}
                  placeholder="明細メモ（任意）"
                  onChange={(e) => changeLine(i, { memo: e.target.value })}
                />
              </div>
            </div>
          ))}
          <datalist id="tax-categories">
            <option value="対象外" />
            <option value="課税10%" />
            <option value="軽減8%" />
            <option value="非課税" />
            <option value="不課税" />
            <option value="要確認" />
          </datalist>
          {!readonly && (
            <button
              className="text-button"
              onClick={() =>
                setValue({
                  ...value,
                  lines: [
                    ...value.lines,
                    {
                      account_id: '5200',
                      debit_amount: 0,
                      credit_amount: 0,
                      tax_category: '対象外',
                      memo: '',
                    },
                  ],
                })
              }
            >
              <Plus size={16} />
              明細を追加
            </button>
          )}
        </div>
        <div
          className={`balance-strip ${debit === credit && debit > 0 ? 'balanced' : 'unbalanced'}`}
        >
          <span>借方 {yen(debit)}</span>
          <span>貸方 {yen(credit)}</span>
          <strong>
            {debit === credit && debit > 0 ? (
              <>
                <Check size={16} />
                借貸一致
              </>
            ) : (
              `差額 ${yen(debit - credit)}`
            )}
          </strong>
        </div>
        {!readonly && (
          <details className="details inline-account">
            <summary>勘定科目が見つからないとき：ここで新しく登録</summary>
            <p className="small muted">
              スマホでも、仕訳の入力内容を残したまま科目を追加できます。登録後は1行目の科目に設定されます。
            </p>
            <div className="form-grid three">
              <Field label="追加する科目コード">
                <input
                  value={newAccount.code}
                  placeholder="例：6800"
                  onChange={(e) => setNewAccount({ ...newAccount, code: e.target.value })}
                />
              </Field>
              <Field label="追加する勘定科目名">
                <input
                  value={newAccount.name}
                  placeholder="例：研修費"
                  onChange={(e) => setNewAccount({ ...newAccount, name: e.target.value })}
                />
              </Field>
              <Field label="追加する科目の区分">
                <select
                  value={newAccount.type}
                  onChange={(e) => setNewAccount({ ...newAccount, type: e.target.value })}
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
              disabled={busy || !newAccount.code.trim() || !newAccount.name.trim()}
              onClick={() =>
                void run(async () => {
                  await engine.write((st) => st.addAccount(newAccount));
                  changeLine(0, { account_id: newAccount.code });
                  setNewAccount({ code: '', name: '', type: 'expense' });
                }, '勘定科目を登録し、1行目に設定しました')
              }
            >
              <Plus size={16} />
              科目を登録してこの仕訳で使う
            </button>
          </details>
        )}
        <details className="details">
          <summary>関連する証憑（{value.evidence_ids.length}件）</summary>
          <div className="checkbox-list">
            {s.evidences
              .filter((e) => e.year === targetYear)
              .map((e) => (
                <label key={e.id}>
                  <input
                    type="checkbox"
                    disabled={readonly}
                    checked={value.evidence_ids.includes(e.id)}
                    onChange={(event) =>
                      setValue({
                        ...value,
                        evidence_ids: event.target.checked
                          ? [...value.evidence_ids, e.id]
                          : value.evidence_ids.filter((id) => id !== e.id),
                      })
                    }
                  />
                  <span>{e.filename}</span>
                  <Badge value={e.status} />
                </label>
              ))}
            {!s.evidences.some((e) => e.year === targetYear) && (
              <p className="small muted">この年度に証憑はまだありません。</p>
            )}
          </div>
        </details>
        {locked && (
          <p className="notice">
            <LockKeyhole size={17} />
            この年度は閲覧専用です。
          </p>
        )}
        {!locked && value.status !== 'draft' && (
          <div className="notice-block">
            <p>確定済みの仕訳です。変更前の内容と修正理由を履歴に残します。</p>
            <Field label="修正理由">
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="例：領収書を確認して金額を訂正"
              />
            </Field>
            <button
              className="button secondary"
              disabled={busy || !reason.trim()}
              onClick={() =>
                void run(async () => {
                  await engine.write((st) => st.unlockTransaction(value.id, reason));
                  const fresh = engine.snapshot.transactions.find((t) => t.id === value.id)!;
                  setValue(fresh);
                }, '下書きに戻しました')
              }
            >
              修正のため下書きに戻す
            </button>
          </div>
        )}
      </div>
      <div className="modal-footer">
        {!readonly ? (
          <>
            {initial && (
              <button
                className="text-button delete-draft"
                disabled={busy}
                onClick={() => {
                  if (
                    window.confirm('この下書きを削除しますか？変更前のデータは操作履歴に残します。')
                  )
                    void run(async () => {
                      await engine.write((st) => st.deleteDraft(value.id));
                      onClose();
                    }, '下書きを削除しました');
                }}
              >
                下書きを削除
              </button>
            )}
            <button className="button secondary" disabled={busy} onClick={() => void save('draft')}>
              下書き保存
            </button>
            <button
              className="button"
              disabled={busy || !value.description.trim() || debit !== credit || debit === 0}
              onClick={() => void save('confirmed')}
            >
              <Check size={17} />
              内容を確認して確定
            </button>
          </>
        ) : (
          <button className="button secondary" onClick={onClose}>
            閉じる
          </button>
        )}
      </div>
    </Modal>
  );
}
