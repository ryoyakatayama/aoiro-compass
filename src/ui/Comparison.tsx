import { useMemo, useState } from 'react';
import { Download, RefreshCw } from 'lucide-react';
import { Card, Field, PageHeading } from './shared';
import { useBooks } from './useBooks';
import { bookHref, type BookKind } from '../lib/book';
import {
  bookNames,
  checkRange,
  knownPeriod,
  comparisonSeries,
  comparisonTransactions,
  transactionAmounts,
} from '../domain/comparison';
import { today, yen } from '../domain/model';
import { download } from '../lib/persistence';
import { exportCsv } from '../lib/csv';
const display = (n: number | null) => (n === null ? '未集計' : yen(n));
export default function Comparison() {
  const { books, refresh, loadedAt, error } = useBooks();
  const [selected, setSelected] = useState<BookKind[]>(['business', 'misc']);
  const [from, setFrom] = useState(''),
    [to, setTo] = useState(today()),
    [unit, setUnit] = useState<'year' | 'month'>('year');
  const [search, setSearch] = useState(''),
    [limit, setLimit] = useState(50);
  const years = Object.values(books).flatMap((s) => s.years.map((y) => y.year));
  const start = from || `${Math.min(new Date().getFullYear(), ...years)}-01-01`;
  let rangeError = '';
  try {
    checkRange(start, to);
  } catch (e) {
    rangeError = (e as Error).message;
  }
  const data = useMemo(
    () =>
      rangeError
        ? null
        : {
            summary: knownPeriod(books, selected, start, to),
            series: comparisonSeries(books, selected, start, to, unit),
            transactions: comparisonTransactions(books, selected, start, to),
          },
    [books, selected, start, to, unit, rangeError],
  );
  const txs =
    data?.transactions.filter(({ transaction: t }) =>
      `${t.transaction_date} ${t.description}`.toLowerCase().includes(search.toLowerCase()),
    ) || [];
  const values = data?.series.map((r) => r.total.profit) || [];
  const min = Math.min(0, ...values.filter((v): v is number => v !== null)),
    max = Math.max(1, ...values.filter((v): v is number => v !== null));
  const y = (n: number) => 170 - ((n - min) / (max - min)) * 140;
  let previous = false;
  const path = values
    .map((n, i) => {
      if (n === null) {
        previous = false;
        return '';
      }
      const p = `${previous ? 'L' : 'M'}${30 + (i * 640) / Math.max(1, values.length - 1)},${y(n)}`;
      previous = true;
      return p;
    })
    .join(' ');
  return (
    <>
      <PageHeading
        eyebrow="ACROSS YEARS & INCOME"
        title="年度と所得をまたいで、比較する。"
        description="表示する所得と期間を選べます。集計は合算し、仕訳・残高・申告の所得区分は元の帳簿で管理します。"
      />
      <Card title="表示するデータ">
        <fieldset className="comparison-books">
          <legend>所得区分（複数選択）</legend>
          {(['business', 'misc'] as const).map((book) => (
            <label key={book}>
              <input
                type="checkbox"
                checked={selected.includes(book)}
                onChange={(e) =>
                  setSelected(
                    e.target.checked ? [...selected, book] : selected.filter((b) => b !== book),
                  )
                }
              />
              {bookNames[book]}
            </label>
          ))}
        </fieldset>
        <div className="form-grid">
          <Field label="比較の開始日">
            <input type="date" value={start} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="比較の終了日">
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>
          <Field label="推移の単位">
            <select value={unit} onChange={(e) => setUnit(e.target.value as 'year' | 'month')}>
              <option value="year">年ごとの比較</option>
              <option value="month">月ごとの連続推移</option>
            </select>
          </Field>
        </div>
        <div className="actions">
          <button
            className="button secondary"
            onClick={() => {
              setFrom('');
              setTo(today());
            }}
          >
            登録済みの全期間
          </button>
          <button
            className="button secondary"
            onClick={() => {
              const d = new Date();
              d.setMonth(d.getMonth() - 23, 1);
              setFrom(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`);
              setTo(today());
              setUnit('month');
            }}
          >
            直近24か月
          </button>
          <button className="text-button" onClick={() => void refresh()}>
            <RefreshCw size={15} />
            端末の帳簿を読み直す
          </button>
        </div>
        <p className="small muted">
          このブラウザーに保存された帳簿を表示します。別の帳簿も一度Google
          Driveに接続して読み込んでください。読み直し：{loadedAt || '読み込み中'}
        </p>
        {selected.map((book) => (
          <p className="small" key={book}>
            {bookNames[book]}：
            {books[book] ? `${books[book]!.years.length}年度を読み込み済み` : 'この端末で未読込'} ·{' '}
            <a href={bookHref(book, 'drive')}>{bookNames[book]}の同期画面</a>
          </p>
        ))}
        {error && (
          <p role="alert" className="notice">
            {error}
          </p>
        )}
        {rangeError && (
          <p role="alert" className="notice">
            {rangeError}
          </p>
        )}
      </Card>
      {!selected.length ? (
        <Card title="所得区分を選んでください">
          <p>片方または両方のチェックを入れると集計を表示します。</p>
        </Card>
      ) : (
        data && (
          <>
            {data.summary.partial && (
              <p className="notice">
                以下の合計は集計できる年度・期間だけの小計です。未読込・未入力・内訳不足の期間があり、全期間の総額は未確定です。期間別の表で未集計の箇所を確認してください。
              </p>
            )}
            <div className="metrics three-metrics">
              {(
                [
                  ['収入合計', data.summary.total.revenue],
                  ['経費合計', data.summary.total.expense],
                  ['差引合計（控除・損益通算前）', data.summary.total.profit],
                ] as const
              ).map(([label, n]) => (
                <div className="metric" key={label}>
                  <div className="metric-title">{label}</div>
                  <div className="metric-value">{display(n)}</div>
                </div>
              ))}
            </div>
            <p className="notice">
              下書き・事業主勘定・期首残高は損益の合計に含みません。未読込・未入力・月次内訳のない期間を0円に置き換えません。合算値は税額や申告所得を計算したものではありません。
            </p>
            <Card title="所得ごとの内訳">
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>所得</th>
                      <th>収入</th>
                      <th>経費</th>
                      <th>差引</th>
                      <th>集計の範囲</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.summary.rows.map((r) => (
                      <tr key={r.book}>
                        <th>{bookNames[r.book]}</th>
                        <td>{display(r.revenue)}</td>
                        <td>{display(r.expense)}</td>
                        <td>{display(r.profit)}</td>
                        <td>{r.notes.join(' / ')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
            <Card
              title={unit === 'year' ? '年度を並べて比較' : '年度をまたぐ月次推移'}
              subtitle="途中の年・月は表の対象期間までの集計です。未集計を含む合計は表示せず、取得できた所得ごとの内訳を残します。"
              action={
                <button
                  className="button secondary"
                  onClick={() =>
                    download(
                      '年度・所得比較.csv',
                      exportCsv([
                        ['期間', '開始', '終了', '所得', '収入', '経費', '差引', '集計範囲'],
                        ...data.series.flatMap((r) => [
                          ...r.rows.map((b) => [
                            r.label,
                            r.from,
                            r.to,
                            bookNames[b.book],
                            b.revenue,
                            b.expense,
                            b.profit,
                            b.notes.join(' / '),
                          ]),
                          [
                            r.label,
                            r.from,
                            r.to,
                            '選択区分合計',
                            r.total.revenue,
                            r.total.expense,
                            r.total.profit,
                            r.total.notes.join(' / '),
                          ],
                        ]),
                      ]),
                      'text/csv;charset=utf-8',
                    )
                  }
                >
                  <Download size={15} />
                  CSV
                </button>
              }
            >
              <svg
                className="comparison-chart"
                viewBox="0 0 700 205"
                role="img"
                aria-label="選択した所得の差引合計の推移。数値と期間は下の表に掲載"
              >
                <line x1="25" x2="675" y1={y(0)} y2={y(0)} stroke="#b6c8c0" />
                <path d={path} fill="none" stroke="#167759" strokeWidth="3" />
                {data.series.map(
                  (r, i) =>
                    r.total.profit !== null && (
                      <circle
                        key={r.label}
                        cx={30 + (i * 640) / Math.max(1, values.length - 1)}
                        cy={y(r.total.profit)}
                        r="4"
                        fill="#167759"
                      >
                        <title>
                          {r.label}：{yen(r.total.profit)}
                        </title>
                      </circle>
                    ),
                )}
                <text x="25" y="198">
                  {data.series[0]?.label}
                </text>
                <text x="675" y="198" textAnchor="end">
                  {data.series.at(-1)?.label}
                </text>
              </svg>
              <div className="table-scroll">
                <table aria-label="期間別の所得比較">
                  <thead>
                    <tr>
                      <th>期間</th>
                      {selected.map((b) => (
                        <th key={b}>{bookNames[b]}の差引</th>
                      ))}
                      <th>収入合計</th>
                      <th>経費合計</th>
                      <th>差引合計</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.series.map((r) => (
                      <tr key={r.label}>
                        <th>
                          {r.label}
                          <small className="block muted">
                            {r.from}〜{r.to}
                          </small>
                        </th>
                        {selected.map((b) => (
                          <td key={b}>{display(r.rows.find((x) => x.book === b)!.profit)}</td>
                        ))}
                        <td>{display(r.total.revenue)}</td>
                        <td>{display(r.total.expense)}</td>
                        <td>{display(r.total.profit)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
            <Card
              title="取引を所得区分付きで見る"
              subtitle="閲覧専用です。編集は各所得の帳簿へ移動して行います。年次集計だけの年度には取引明細がありません。"
            >
              <Field label="比較中の取引を検索">
                <input
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setLimit(50);
                  }}
                  placeholder="日付・摘要"
                />
              </Field>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>所得</th>
                      <th>日付</th>
                      <th>摘要</th>
                      <th>収入への計上</th>
                      <th>経費への計上</th>
                      <th>状態</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {txs.slice(0, limit).map(({ book, transaction: t }) => {
                      const amount = transactionAmounts(books[book]!, t);
                      return (
                        <tr key={`${book}:${t.id}`}>
                          <td>
                            <span className="income-tag">{bookNames[book]}</span>
                          </td>
                          <td>{t.transaction_date}</td>
                          <td>{t.description}</td>
                          <td>{yen(amount.revenue)}</td>
                          <td>{yen(amount.expense)}</td>
                          <td>{t.status === 'draft' ? '下書き・集計対象外' : '確定済み'}</td>
                          <td>
                            <a href={bookHref(book, 'ledger', t.year)}>元の帳簿へ</a>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="small">
                {txs.length}件中{Math.min(limit, txs.length)}件
              </p>
              {txs.length > limit && (
                <button className="button secondary" onClick={() => setLimit(limit + 100)}>
                  続きを表示
                </button>
              )}
            </Card>
          </>
        )
      )}
    </>
  );
}
