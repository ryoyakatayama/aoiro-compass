import { useState } from 'react';
import { Printer, Download } from 'lucide-react';
import { useApp } from './context';
import { PageHeading, Card, Empty } from './shared';
import { report, monthly, continuity } from '../domain/accounting';
import { isMisc, profitLabel } from '../lib/book';
import { yen } from '../domain/model';
import { download } from '../lib/persistence';
import { exportCsv } from '../lib/csv';
import { TrendChart } from './Dashboard';
export default function Reports() {
  const { s, year } = useApp();
  const [tab, setTab] = useState('pl'),
    [account, setAccount] = useState('1010');
  const r = report(s, year);
  const rows = r.balance.filter((a) => a.debit || a.credit);
  let running = 0;
  const ledger = s.transactions
    .filter((t) => t.year === year && t.status !== 'draft')
    .sort(
      (a, b) => a.transaction_date.localeCompare(b.transaction_date) || a.id.localeCompare(b.id),
    )
    .flatMap((t) =>
      t.lines
        .filter((l) => l.account_id === account)
        .map((l) => {
          running += l.debit_amount - l.credit_amount;
          return {
            date: t.transaction_date,
            description: t.description,
            debit: l.debit_amount,
            credit: l.credit_amount,
            balance: running,
          };
        }),
    );
  const comparisons = s.years
    .map((y) => ({ year: y.year, ...report(s, y.year) }))
    .sort((a, b) => a.year - b.year);
  const bsRows = r.summaryOnly
    ? (s.historicalSummaries[year]?.balance_sheet || []).map((b) => {
        const a = s.accounts.find((a) => a.id === b.account_id)!;
        return {
          ...a,
          balance:
            a.type === 'asset'
              ? b.debit_amount - b.credit_amount
              : b.credit_amount - b.debit_amount,
        };
      })
    : rows.filter((a) => !['expense', 'revenue'].includes(a.type));
  const csvRows: unknown[][] =
    tab === 'ledger'
      ? [
          ['日付', '摘要', '借方', '貸方', '借方差引残高'],
          ...ledger.map((l) => [l.date, l.description, l.debit, l.credit, l.balance]),
        ]
      : tab === 'compare'
        ? [
            ['年度', '売上', '経費', '利益'],
            ...comparisons.map((y) => [y.year, y.revenue, y.expense, y.profit]),
          ]
        : tab === 'pl'
          ? [
              ['科目', '金額'],
              ...(r.summaryOnly
                ? [
                    ['売上・収益合計', r.revenue],
                    ['必要経費合計', r.expense],
                  ]
                : r.pl
                    .filter((a) => ['revenue', 'expense'].includes(a.type))
                    .map((a) => [a.name, a.balance])),
              [profitLabel, r.profit],
            ]
          : tab === 'bs'
            ? [
                ['科目', '残高'],
                ...bsRows.map((a) => [a.name, a.balance]),
                ...(!r.summaryOnly ? [['当期事業利益', r.profit]] : []),
              ]
            : [
                ['科目', '借方', '貸方', '残高'],
                ...rows.map((a) => [a.name, a.debit, a.credit, a.balance]),
              ];
  return (
    <>
      <PageHeading
        eyebrow="REPORTS & INSIGHTS"
        title={isMisc ? '雑所得の収入と経費を、明確に。' : '数字を、次の判断へ。'}
        description="損益・財政状態・科目別の動き。確定済みの帳簿から、必要な切り口で見る。"
        actions={
          <>
            <button
              className="button secondary"
              onClick={() =>
                download(`${year}_${tab}.csv`, exportCsv(csvRows), 'text/csv;charset=utf-8')
              }
            >
              <Download size={16} />
              CSV出力
            </button>
            <button className="button secondary" onClick={() => window.print()}>
              <Printer size={16} />
              印刷 / PDF保存
            </button>
          </>
        }
      />
      <div className="tabs">
        {[
          ['pl', '損益計算書'],
          ['bs', '貸借対照表'],
          ['trial', '試算表'],
          ['ledger', '総勘定元帳'],
          ['compare', '年度比較'],
        ].map(([key, label]) => (
          <button key={key} className={tab === key ? 'active' : ''} onClick={() => setTab(key)}>
            {label}
          </button>
        ))}
      </div>
      <div className="print-heading">
        青色コンパス / {year}年 / {new Date().toLocaleDateString('ja-JP')} 作成
      </div>
      {tab === 'pl' && (
        <Card
          title={`${year}年 損益計算書`}
          subtitle={
            isMisc
              ? '1月1日〜12月31日 / 雑所得の収入・必要経費（税引前）'
              : '1月1日〜12月31日 / 税引前・青色申告特別控除前'
          }
        >
          <div className="statement">
            {r.summaryOnly ? (
              <p className="notice">過年度の年次集計データです。科目別明細は含まれていません。</p>
            ) : null}
            <div className="statement-total">
              <span>売上・収益合計</span>
              <strong>{yen(r.revenue)}</strong>
            </div>
            {!r.summaryOnly &&
              r.pl
                .filter((a) => a.type === 'revenue' && a.balance)
                .map((a) => (
                  <div className="statement-row" key={a.id}>
                    <span>{a.name}</span>
                    <span>{yen(a.balance)}</span>
                  </div>
                ))}
            <div className="statement-total">
              <span>必要経費合計</span>
              <strong>{yen(r.expense)}</strong>
            </div>
            {!r.summaryOnly &&
              r.pl
                .filter((a) => a.type === 'expense' && a.balance)
                .map((a) => (
                  <div className="statement-row" key={a.id}>
                    <span>{a.name}</span>
                    <span>{yen(a.balance)}</span>
                  </div>
                ))}
            <div className="statement-profit">
              <span>{profitLabel}</span>
              <strong>{yen(r.profit)}</strong>
            </div>
          </div>
        </Card>
      )}
      {tab === 'bs' && (
        <Card
          title={`${year}年 貸借対照表`}
          subtitle="12月31日時点 / 期首残高と確定済みの取引を反映"
        >
          <div className="balance-sheet">
            <div>
              <h3>資産の部</h3>
              {bsRows
                .filter((a) => a.type === 'asset')
                .map((a) => (
                  <div className="statement-row" key={a.id}>
                    <span>{a.name}</span>
                    <span>{yen(a.balance)}</span>
                  </div>
                ))}
              <div className="statement-total">
                <span>資産合計</span>
                <strong>
                  {yen(bsRows.filter((a) => a.type === 'asset').reduce((n, a) => n + a.balance, 0))}
                </strong>
              </div>
            </div>
            <div>
              <h3>負債・純資産の部</h3>
              {bsRows
                .filter((a) => ['liability', 'equity'].includes(a.type))
                .map((a) => (
                  <div className="statement-row" key={a.id}>
                    <span>{a.name}</span>
                    <span>{yen(a.balance)}</span>
                  </div>
                ))}
              {!r.summaryOnly && (
                <div className="statement-row">
                  <span>当期事業利益</span>
                  <span>{yen(r.profit)}</span>
                </div>
              )}
              <div className="statement-total">
                <span>負債・純資産合計</span>
                <strong>
                  {yen(
                    bsRows
                      .filter((a) => ['liability', 'equity'].includes(a.type))
                      .reduce((n, a) => n + a.balance, 0) + (r.summaryOnly ? 0 : r.profit),
                  )}
                </strong>
              </div>
            </div>
          </div>
        </Card>
      )}
      {tab === 'trial' && (
        <Card title={`${year}年 試算表`}>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>コード</th>
                  <th>勘定科目</th>
                  <th>借方累計</th>
                  <th>貸方累計</th>
                  <th>通常側残高</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((a) => (
                  <tr key={a.id}>
                    <td>{a.code}</td>
                    <td>{a.name}</td>
                    <td className="number">{yen(a.debit)}</td>
                    <td className="number">{yen(a.credit)}</td>
                    <td className="number">{yen(a.balance)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th colSpan={2}>合計</th>
                  <th>{yen(rows.reduce((n, a) => n + a.debit, 0))}</th>
                  <th>{yen(rows.reduce((n, a) => n + a.credit, 0))}</th>
                  <th />
                </tr>
              </tfoot>
            </table>
          </div>
          {r.summaryOnly && (
            <p className="notice">
              集計のみの過年度には仕訳の借貸累計がありません。P/L・B/Sをご覧ください。
            </p>
          )}
        </Card>
      )}
      {tab === 'ledger' && (
        <Card
          title={`${year}年 総勘定元帳`}
          action={
            <select
              aria-label="元帳の勘定科目"
              value={account}
              onChange={(e) => setAccount(e.target.value)}
            >
              {s.accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          }
        >
          <p className="small muted">差引残高は借方をプラス、貸方をマイナスで表示します。</p>
          {ledger.length ? (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>日付</th>
                    <th>摘要</th>
                    <th>借方</th>
                    <th>貸方</th>
                    <th>差引残高</th>
                  </tr>
                </thead>
                <tbody>
                  {ledger.map((l, i) => (
                    <tr key={i}>
                      <td>{l.date}</td>
                      <td>{l.description}</td>
                      <td>{yen(l.debit)}</td>
                      <td>{yen(l.credit)}</td>
                      <td>{yen(l.balance)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty title="この科目の確定仕訳はありません" />
          )}
        </Card>
      )}
      {tab === 'compare' && (
        <>
          <Card title="年ごとの事業の変化">
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>年度</th>
                    <th>売上</th>
                    <th>経費</th>
                    <th>利益</th>
                    <th>利益率</th>
                    <th>データ</th>
                  </tr>
                </thead>
                <tbody>
                  {comparisons.map((y) => (
                    <tr key={y.year}>
                      <td>{y.year}年</td>
                      <td>{yen(y.revenue)}</td>
                      <td>{yen(y.expense)}</td>
                      <td>{yen(y.profit)}</td>
                      <td>{y.margin.toFixed(1)}%</td>
                      <td>{y.summaryOnly ? '集計のみ' : '仕訳から集計'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
          <Card title="月次の推移と前年売上">
            <TrendChart year={year} />
          </Card>
          <Card
            title={`${year - 1}年末 → ${year}年期首の継続性`}
            subtitle="損益と事業主勘定を元入金へ振り替えた後の残高で比較します。"
          >
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>科目</th>
                    <th>前期末・繰越額</th>
                    <th>当期期首</th>
                    <th>差額</th>
                  </tr>
                </thead>
                <tbody>
                  {continuity(s, year - 1, year).map((r) => (
                    <tr key={r.account_id}>
                      <td>{r.account}</td>
                      <td>{yen(r.prior)}</td>
                      <td>{yen(r.next)}</td>
                      <td className={r.difference ? 'warning-text' : ''}>{yen(r.difference)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
      <p className="page-footnote">
        これらは記帳データから作る会計帳簿です。所得税・消費税の申告書、公式の青色申告決算書やe-Tax送信データではありません。
      </p>
    </>
  );
}
