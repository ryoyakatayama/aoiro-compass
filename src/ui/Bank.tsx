import { useState } from 'react';
import { Download, Link2, Check } from 'lucide-react';
import { useApp } from './context';
import { Card, PageHeading, FileButton, Field, Empty, Modal } from './shared';
import { parseBankCsv, readTextFile, exportCsv } from '../lib/csv';
import { sha256, download } from '../lib/persistence';
import { reconciliationCandidates } from '../domain/accounting';
import { yen, type BankEntry } from '../domain/model';
export default function Bank() {
  const { s, year, engine, run, busy } = useApp();
  const [account, setAccount] = useState('1010'),
    [encoding, setEncoding] = useState('utf-8'),
    [mapping, setMapping] = useState({ date: '日付', description: '摘要', amount: '金額' }),
    [preview, setPreview] = useState<{
      rows: ReturnType<typeof parseBankCsv>;
      hash: string;
      name: string;
    } | null>(null),
    [match, setMatch] = useState<BankEntry | null>(null),
    [unmatched, setUnmatched] = useState(false);
  const rows = s.banks.filter(
    (b) => b.year === year && (!unmatched || b.reconciliation_status === 'unmatched'),
  );
  return (
    <>
      <PageHeading
        eyebrow="RECONCILIATION"
        title="明細と帳簿を、つなぐ。"
        description="銀行・カードのCSVを取り込み、同じ金額・近い日付の仕訳を確認して照合します。"
        actions={
          <button
            className="button secondary"
            onClick={() =>
              download(
                '銀行明細テンプレート.csv',
                exportCsv([
                  ['日付', '摘要', '金額'],
                  [`${year}-01-15`, '売上入金', 110000],
                  [`${year}-01-20`, '備品購入', -5500],
                ]),
                'text/csv;charset=utf-8',
              )
            }
          >
            <Download size={16} />
            CSVの見本
          </button>
        }
      />
      <Card
        title="明細を取り込む"
        subtitle="入金はプラス、出金・カード利用はマイナスの整数で指定してください。"
      >
        <div className="form-grid three">
          <Field label="照合する口座">
            <select value={account} onChange={(e) => setAccount(e.target.value)}>
              {s.accounts
                .filter((a) => ['asset', 'liability'].includes(a.type))
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
            </select>
          </Field>
          <Field label="文字コード">
            <select value={encoding} onChange={(e) => setEncoding(e.target.value)}>
              <option value="utf-8">UTF-8</option>
              <option value="shift_jis">Shift JIS</option>
            </select>
          </Field>
          <div className="field end">
            <FileButton
              accept=".csv"
              disabled={busy}
              onFile={(files) =>
                void run(async () => {
                  const file = files[0],
                    text = await readTextFile(file, encoding);
                  setPreview({
                    rows: parseBankCsv(text, year, account, mapping),
                    hash: await sha256(file),
                    name: file.name,
                  });
                })
              }
            >
              CSVを選択
            </FileButton>
          </div>
        </div>
        <details className="details">
          <summary>CSVの列名を指定する</summary>
          <div className="form-grid three">
            {(
              [
                ['date', '日付の列名'],
                ['description', '摘要の列名'],
                ['amount', '金額の列名'],
              ] as const
            ).map(([key, label]) => (
              <Field key={key} label={label}>
                <input
                  value={mapping[key]}
                  onChange={(e) => setMapping({ ...mapping, [key]: e.target.value })}
                />
              </Field>
            ))}
          </div>
          <p className="small muted">
            入金列・出金列が分かれているCSVは、差額を1本の「金額」列にして取り込んでください。
          </p>
        </details>
      </Card>
      <Card
        title="取り込んだ明細"
        subtitle={`${rows.length}件`}
        action={
          <label className="inline-check">
            <input
              type="checkbox"
              checked={unmatched}
              onChange={(e) => setUnmatched(e.target.checked)}
            />
            未照合のみ
          </label>
        }
      >
        {rows.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>日付</th>
                  <th>摘要</th>
                  <th>口座</th>
                  <th>金額</th>
                  <th>照合</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((b) => (
                  <tr key={b.id}>
                    <td>{b.transaction_date}</td>
                    <td>{b.description}</td>
                    <td>{s.accounts.find((a) => a.id === b.account_id)?.name}</td>
                    <td className={`number ${b.amount < 0 ? '' : 'positive'}`}>{yen(b.amount)}</td>
                    <td>
                      {b.reconciliation_status === 'matched' ? (
                        <span className="badge badge-confirmed">
                          <Check size={13} />
                          照合済み
                        </span>
                      ) : b.reconciliation_status === 'ignored' ? (
                        <span className="badge">対象外</span>
                      ) : (
                        <button className="button secondary compact" onClick={() => setMatch(b)}>
                          <Link2 size={15} />
                          候補を確認
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="明細を取り込むと、照合を始められます。">
            帳簿は自動で追加・確定されません。候補を確認して1件ずつ紐付けます。
          </Empty>
        )}
      </Card>
      {preview && (
        <Modal
          title={`CSVの取込内容（${preview.rows.length}件）`}
          wide
          onClose={() => setPreview(null)}
        >
          <div className="modal-body">
            <div className="table-scroll bounded">
              <table>
                <thead>
                  <tr>
                    <th>日付</th>
                    <th>摘要</th>
                    <th>金額</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.slice(0, 100).map((r, i) => (
                    <tr key={i}>
                      <td>{r.transaction_date}</td>
                      <td>{r.description}</td>
                      <td>{yen(r.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {preview.rows.length > 100 && <p>先頭100件を表示しています。</p>}
          </div>
          <div className="modal-footer">
            <button
              className="button"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await engine.write(
                    (st) => st.importBank(preview.rows, preview.hash, preview.name),
                    '銀行CSV取込前',
                  );
                  setPreview(null);
                }, '銀行明細を取り込みました')
              }
            >
              内容を確認して取り込む
            </button>
          </div>
        </Modal>
      )}
      {match && (
        <Modal title="仕訳との照合" wide onClose={() => setMatch(null)}>
          <div className="modal-body">
            <p>
              {match.transaction_date} · {match.description} · <strong>{yen(match.amount)}</strong>
            </p>
            {reconciliationCandidates(match, s.transactions)
              .filter((c) => !s.banks.some((b) => b.transaction_id === c.transaction.id))
              .map((c) => (
                <div className="reconciliation-choice" key={c.transaction.id}>
                  <span>
                    <strong>{c.transaction.description}</strong>
                    <small>
                      {c.transaction.transaction_date} / 一致度 {c.score}%
                    </small>
                  </span>
                  <button
                    className="button secondary"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        await engine.write((st) => st.reconcile(match.id, c.transaction.id));
                        setMatch(null);
                      }, '照合しました')
                    }
                  >
                    この仕訳と照合
                  </button>
                </div>
              ))}
            {!reconciliationCandidates(match, s.transactions).length && (
              <Empty title="一致する確定仕訳がありません">
                該当口座の増減額と、前後7日以内の日付で候補を探します。先に記帳・確定してください。
              </Empty>
            )}
          </div>
          <div className="modal-footer">
            <button
              className="button secondary"
              onClick={() =>
                void run(async () => {
                  await engine.write((st) => st.reconcile(match.id, null));
                  setMatch(null);
                }, '対象外として記録しました')
              }
            >
              この明細を照合対象外にする
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
