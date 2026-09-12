import { useState } from 'react';
import {
  ArrowUpRight,
  ArrowDownRight,
  Plus,
  Camera,
  MessageCircle,
  TrendingUp,
  ArrowRight,
  Wallet,
  ChevronRight,
  CheckCircle2,
} from 'lucide-react';
import { useApp } from './context';
import { PageHeading, Card, Badge, Empty, ActionLink, CheckRow } from './shared';
import { report, monthly } from '../domain/accounting';
import { yen, monthDay, today } from '../domain/model';
import { isMisc, profitLabel } from '../lib/book';
import { demoMode } from '../lib/persistence';
function linePath(values: (number | null)[], xs: (i: number) => number, y: (n: number) => number) {
  let previous = false;
  return values
    .map((n, i) => {
      if (n === null) {
        previous = false;
        return '';
      }
      const segment = (previous ? 'L' : 'M') + (xs(i) + 3) + ',' + y(n);
      previous = true;
      return segment;
    })
    .join(' ');
}
export function TrendChart({ year, compare = true }: { year: number; compare?: boolean }) {
  const { s } = useApp();
  const [table, setTable] = useState(false);
  const thisYear = new Date().getFullYear(),
    thisMonth = new Date().getMonth() + 1;
  const chartSnapshot =
    year === thisYear
      ? { ...s, transactions: s.transactions.filter((t) => t.transaction_date <= today()) }
      : s;
  const data = monthly(chartSnapshot, year).map((m) => ({
      ...m,
      available: m.available && (year < thisYear || (year === thisYear && m.month <= thisMonth)),
    })),
    prev = monthly(s, year - 1);
  const max = Math.max(
    10000,
    ...data.flatMap((m) => (m.available ? [m.revenue ?? 0, m.expense ?? 0, m.profit ?? 0] : [0])),
    ...prev.map((m) => (compare ? (m.revenue ?? 0) : 0)),
  );
  const min = Math.min(
    0,
    ...data.flatMap((m) => (m.available ? [m.revenue ?? 0, m.expense ?? 0, m.profit ?? 0] : [0])),
    ...prev.map((m) => (compare ? (m.revenue ?? 0) : 0)),
  );
  const y = (n: number) => 200 - ((n - min) / (max - min)) * 170;
  const xs = (i: number) => 62 + i * 54;
  const ticks = Array.from({ length: 4 }, (_, i) => min + ((max - min) * i) / 3);
  return (
    <>
      <p className="small muted">未集計の月・項目は表示しません。0円と未集計を区別しています。</p>
      <div className="chart-legend">
        <span>
          <i className="dot revenue" />
          売上
        </span>
        <span>
          <i className="dot expense" />
          経費
        </span>
        <span>
          <i className="line-dot" />
          利益
        </span>
        {compare && s.years.some((y) => y.year === year - 1) && (
          <span className="muted">点線：前年売上</span>
        )}
        <button className="text-button" onClick={() => setTable(!table)}>
          {table ? 'グラフ表示' : '数値で見る'}
        </button>
      </div>
      {table ? (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>月</th>
                <th>売上</th>
                <th>経費</th>
                <th>利益</th>
              </tr>
            </thead>
            <tbody>
              {data.map((m) => (
                <tr key={m.month}>
                  <td>{m.month}月</td>
                  <td>{m.available && m.revenue !== null ? yen(m.revenue) : '未集計'}</td>
                  <td>{m.available && m.expense !== null ? yen(m.expense) : '未集計'}</td>
                  <td>{m.available && m.profit !== null ? yen(m.profit) : '未集計'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <svg
          className="trend-chart"
          viewBox="0 0 700 235"
          role="img"
          aria-label={`${year}年月別の売上・経費・利益の推移。数値で見るボタンから詳細を確認できます。`}
        >
          {ticks.map((n, i) => (
            <g key={i}>
              <line x1="42" x2="684" y1={y(n)} y2={y(n)} stroke="#e5eae6" strokeDasharray="3 5" />
              <text x="34" y={y(n) + 4} textAnchor="end" className="chart-label">
                {Math.round(n / 10000)}万
              </text>
            </g>
          ))}
          <line x1="42" x2="684" y1={y(0)} y2={y(0)} stroke="#ced9d2" />
          {data.map((m, i) => (
            <g key={i}>
              {m.available && m.revenue !== null && (
                <rect
                  x={xs(i) - 12}
                  y={y(Math.max(0, m.revenue))}
                  width="14"
                  height={Math.abs(y(m.revenue) - y(0))}
                  rx="3"
                  fill="#377c73"
                >
                  <title>
                    {m.month}月 売上 {yen(m.revenue)}
                  </title>
                </rect>
              )}
              {m.available && m.expense !== null && (
                <rect
                  x={xs(i) + 5}
                  y={y(Math.max(0, m.expense))}
                  width="14"
                  height={Math.abs(y(m.expense) - y(0))}
                  rx="3"
                  fill="#c9ddcb"
                >
                  <title>
                    {m.month}月 経費 {yen(m.expense)}
                  </title>
                </rect>
              )}
              <text x={xs(i) + 3} y="224" textAnchor="middle" className="chart-label">
                {m.month}月
              </text>
            </g>
          ))}
          {compare && s.years.some((y) => y.year === year - 1) && (
            <path
              d={linePath(
                prev.map((m) => m.revenue),
                xs,
                y,
              )}
              fill="none"
              stroke="#a7b4ae"
              strokeWidth="1.5"
              strokeDasharray="4 5"
            />
          )}
          <path
            d={linePath(
              data.map((m) => (m.available ? m.profit : null)),
              xs,
              y,
            )}
            fill="none"
            stroke="#d6aa55"
            strokeWidth="2.5"
          />
          {data.map(
            (m, i) =>
              m.available &&
              m.profit !== null && (
                <circle
                  key={i}
                  cx={xs(i) + 3}
                  cy={y(m.profit)}
                  r="3.5"
                  fill="#d6aa55"
                  stroke="white"
                  strokeWidth="2"
                >
                  <title>
                    {m.month}月 利益 {yen(m.profit)}
                  </title>
                </circle>
              ),
          )}
        </svg>
      )}
    </>
  );
}
export default function Dashboard() {
  const { s, year, navigate, openJournal } = useApp();
  const [period, setPeriod] = useState('year');
  const current = new Date();
  const month = year === current.getFullYear() ? current.getMonth() + 1 : 12;
  const summaryOnly = s.years.find((y) => y.year === year)?.data_completeness === 'summary_only';
  const from =
    period === 'month' && !summaryOnly
      ? `${year}-${String(month).padStart(2, '0')}-01`
      : `${year}-01-01`;
  const to = year === current.getFullYear() ? today() : `${year}-12-31`;
  const r = report(s, year, from, to);
  const previous = report(
    s,
    year - 1,
    from.replace(String(year), String(year - 1)),
    to.replace(String(year), String(year - 1)),
  );
  const hasPrevious = s.years.some((y) => y.year === year - 1);
  const tx = s.transactions.filter((t) => t.year === year);
  const evidences = s.evidences.filter((e) => e.year === year);
  const draft = tx.filter((t) => t.status === 'draft').length;
  const pending = evidences.filter(
    (e) => !tx.some((t) => t.evidence_ids.includes(e.id)) && e.status !== 'ignored',
  ).length;
  const findings = s.findings.filter(
    (f) =>
      !['resolved', 'dismissed'].includes(f.status) &&
      s.audits.some((a) => a.id === f.audit_id && a.target_years.includes(year)),
  ).length;
  const categories = r.pl
    .filter((a) => a.type === 'expense' && a.balance > 0)
    .sort((a, b) => b.balance - a.balance)
    .slice(0, 5);
  return (
    <>
      <PageHeading
        eyebrow="YOUR BUSINESS, IN FOCUS"
        title={isMisc ? '雑所得も、すっきり見渡す。' : '事業の今と、これからを。'}
        description={`${year}年の数字を、一目で。小さな記録が、次の一歩につながります。`}
        actions={
          <button className="button" onClick={() => openJournal()}>
            <Plus size={17} />
            取引を記帳
          </button>
        }
      />
      {!tx.length && !r.summaryOnly && (
        <div className="welcome-banner">
          <div>
            <strong>青色コンパスへようこそ。</strong>
            <p>最初の取引を記帳して、事業の見通しをつくりましょう。</p>
          </div>
          <a className="button secondary" href="?demo=1">
            デモで使い心地を見る
            <ArrowUpRight size={16} />
          </a>
        </div>
      )}
      <div className="dashboard-topline">
        <span className="section-label">
          BUSINESS OVERVIEW{' '}
          <span>
            {year}年1月〜{month}月
          </span>
        </span>
        <div className="segmented">
          <button
            className={period === 'year' || summaryOnly ? 'selected' : ''}
            onClick={() => setPeriod('year')}
          >
            年累計
          </button>
          <button
            disabled={summaryOnly}
            title={summaryOnly ? '集計のみの過年度は年次合計を表示します' : ''}
            className={period === 'month' && !summaryOnly ? 'selected' : ''}
            onClick={() => setPeriod('month')}
          >
            {month}月
          </button>
        </div>
      </div>
      <div className="metrics">
        {[
          {
            title: isMisc ? '収入' : '売上',
            value: r.revenue,
            previous: previous.revenue,
            icon: <ArrowUpRight />,
            className: '',
          },
          {
            title: '経費',
            value: r.expense,
            previous: previous.expense,
            icon: <ArrowDownRight />,
            className: '',
          },
          {
            title: profitLabel,
            value: r.profit,
            previous: previous.profit,
            icon: <TrendingUp />,
            className: 'metric-profit',
          },
        ].map((m) => (
          <div className={`metric ${m.className}`} key={m.title}>
            <div className="metric-title">
              {m.title}
              <span>{m.icon}</span>
            </div>
            <div className="metric-value">{yen(m.value)}</div>
            <div className="metric-foot">
              {hasPrevious &&
              m.previous !== 0 &&
              (!previous.summaryOnly || (from.endsWith('-01-01') && to.endsWith('-12-31'))) ? (
                <>
                  <span className={m.value - m.previous >= 0 ? 'trend-up' : 'trend-down'}>
                    {m.value - m.previous >= 0 ? '↗' : '↘'}{' '}
                    {Math.abs(((m.value - m.previous) / Math.abs(m.previous)) * 100).toFixed(1)}%
                  </span>
                  前年同期間比
                </>
              ) : (
                <span>
                  {r.summaryOnly
                    ? '過年度の年次集計値'
                    : m.title === profitLabel
                      ? '収入 − 経費（税引前）'
                      : '確定済みの仕訳から集計'}
                </span>
              )}
            </div>
          </div>
        ))}
        <div className="metric">
          <div className="metric-title">
            利益率
            <span>
              <Wallet />
            </span>
          </div>
          <div className="metric-value">
            {r.margin.toFixed(1)}
            <small>%</small>
          </div>
          <div className="metric-foot">売上に対する事業利益の割合</div>
        </div>
      </div>
      <div className="dashboard-grid">
        <Card
          title="売上と利益の推移"
          subtitle="記録した数字から、事業のリズムを知る。"
          action={<span className="small muted">{year}年 / 月次</span>}
          className="chart-card"
        >
          <TrendChart year={year} />
        </Card>
        <Card title="次にやること" subtitle="少しずつ、帳簿を整える。" className="todo-card">
          {[
            {
              icon: <Camera size={20} />,
              title: '証憑の確認',
              text: '領収書・請求書を記帳へ',
              count: pending,
              page: 'evidence' as const,
            },
            {
              icon: <CheckCircle2 size={20} />,
              title: '下書きの確定',
              text: '内容を確認して帳簿に反映',
              count: draft,
              page: 'ledger' as const,
            },
            {
              icon: <MessageCircle size={20} />,
              title: 'AIの指摘を確認',
              text: '回答して、相談を一歩先へ',
              count: findings,
              page: 'consult' as const,
            },
          ].map((t) => (
            <button className="todo-item" key={t.title} onClick={() => navigate(t.page)}>
              <span className="todo-icon">{t.icon}</span>
              <span>
                <strong>{t.title}</strong>
                <small>{t.text}</small>
              </span>
              <b>{t.count}</b>
              <ChevronRight size={16} />
            </button>
          ))}
          <div className="todo-footer">
            <span className="status-dot" />
            データはこの端末に保存されています
          </div>
        </Card>
      </div>
      <div className="dashboard-bottom">
        <Card
          title="最近の取引"
          subtitle="日々の記録が、事業の地図になる。"
          action={<ActionLink onClick={() => navigate('ledger')}>すべて見る</ActionLink>}
        >
          {tx.length ? (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>日付</th>
                    <th>取引内容</th>
                    <th>金額</th>
                    <th>状態</th>
                  </tr>
                </thead>
                <tbody>
                  {tx.slice(0, 5).map((t) => (
                    <tr key={t.id} onClick={() => openJournal(t)} className="clickable">
                      <td className="muted">{monthDay(t.transaction_date)}</td>
                      <td>
                        <button
                          className="plain-link"
                          onClick={(e) => {
                            e.stopPropagation();
                            openJournal(t);
                          }}
                        >
                          {t.description}
                        </button>
                        <small className="table-sub">
                          {s.accounts.find((a) => a.id === t.lines[0]?.account_id)?.name}
                        </small>
                      </td>
                      <td className="number">
                        {yen(t.lines.reduce((n, l) => n + l.debit_amount, 0))}
                      </td>
                      <td>
                        <Badge value={t.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty
              title="まだ取引がありません"
              action={
                <button className="button secondary" onClick={() => openJournal()}>
                  最初の取引を記帳
                </button>
              }
            >
              売上も経費も、ここから記録できます。
            </Empty>
          )}
        </Card>
        <Card
          title="経費の内訳"
          subtitle="お金の使い道を、クリアに。"
          action={<ActionLink onClick={() => navigate('reports')}>詳細</ActionLink>}
        >
          {categories.length ? (
            <div className="category-list">
              {categories.map((c, i) => (
                <div className="category-item" key={c.id}>
                  <div>
                    <span>
                      <i
                        style={{
                          background: ['#377c73', '#769e81', '#b6cda5', '#d5b275', '#9caaa2'][i],
                        }}
                      />
                      {c.name}
                    </span>
                    <strong>{yen(c.balance)}</strong>
                  </div>
                  <div className="bar-track">
                    <span
                      style={{
                        width: `${Math.max(2, (c.balance / Math.max(r.expense, 1)) * 100)}%`,
                        background: ['#377c73', '#769e81', '#b6cda5', '#d5b275', '#9caaa2'][i],
                      }}
                    />
                  </div>
                </div>
              ))}
              <p className="small muted">経費合計 {yen(r.expense)} / 上位5科目</p>
            </div>
          ) : (
            <Empty title="経費の記録を待っています">記帳すると科目ごとの内訳が表示されます。</Empty>
          )}
        </Card>
      </div>
      <div className="consult-banner">
        <span className="consult-symbol">
          <MessageCircle size={30} />
        </span>
        <div>
          <span className="eyebrow">THINK IT THROUGH</span>
          <h3>その経費のこと、事業の背景から相談しよう。</h3>
          <p>業種・働き方・取引の実態を添えて。AIとの対話を、専門家への相談準備に。</p>
        </div>
        <button className="button secondary" onClick={() => navigate('consult')}>
          相談を準備する
          <ArrowRight size={17} />
        </button>
      </div>
      <p className="page-footnote">
        {demoMode
          ? 'デモ用の架空データを表示しています。実帳簿とは別に保存されます。'
          : '現預金残高 ' +
            yen(r.cash) +
            ' · 売掛金 ' +
            yen(r.receivable) +
            ' · 確定済み仕訳を集計'}
        {r.summaryOnly ? ' · 過年度の集計データを使用' : ''}
      </p>
    </>
  );
}
