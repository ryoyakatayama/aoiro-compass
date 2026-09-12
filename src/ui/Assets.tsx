import { useState } from 'react';
import { Plus, Calculator, Download } from 'lucide-react';
import { useApp } from './context';
import { Card, PageHeading, Modal, Field, Empty } from './shared';
import { newId, today, yen, type Asset } from '../domain/model';
import { download } from '../lib/persistence';
import { exportCsv } from '../lib/csv';
import {
  straightLine,
  openingValue,
  businessDepreciation,
  recordedBusinessAmount,
  depreciationSources,
} from '../domain/depreciation';

export default function Assets() {
  const { s, year, openJournal } = useApp();
  const [adding, setAdding] = useState(false),
    [depreciate, setDepreciate] = useState<Asset | null>(null);
  const assets = s.assets.filter(
    (a) => a.year <= year && (!a.disposed_at || a.disposed_at >= year + '-01-01'),
  );
  const locked = s.years.find((y) => y.year === year)?.status !== 'active';
  const entries = s.depreciations.filter((d) => d.year === year);
  const csv = () =>
    exportCsv([
      [
        '資産名',
        '種類',
        '取得日',
        '供用日',
        '取得価額',
        '方法',
        '耐用年数',
        '事業割合',
        '期首簿価',
        '当年償却額（全体）',
        '必要経費算入額（仕訳）',
        '期末未償却残高',
        '記帳状況',
        '根拠',
      ],
      ...assets.map((a) => {
        const d = entries.find((d) => d.asset_id === a.id);
        const t = s.transactions.find((t) => t.id === d?.transaction_id);
        return [
          a.name,
          a.asset_class,
          a.acquisition_date,
          a.in_service_date,
          a.acquisition_cost,
          a.depreciation_method === 'straight_line' ? '定額法' : '根拠による手動入力',
          a.useful_life_years,
          a.business_use_ratio,
          d?.opening_book_value ?? a.opening_book_value ?? '',
          d?.depreciation_amount ?? '',
          d ? (recordedBusinessAmount(s, d) ?? '要確認') : '',
          d?.closing_book_value ?? '',
          t?.status ?? (d ? '仕訳なし' : '未登録'),
          d?.calculation ?? a.note,
        ];
      }),
    ]);
  return (
    <>
      <PageHeading
        eyebrow="FIXED ASSETS"
        title="減価償却を計算し、申告へ引き継ぐ。"
        description="計算結果と前年末簿価を確認して下書きを作成し、仕訳を確定します。"
        actions={
          <>
            <button
              className="button secondary"
              onClick={() => download(year + '_減価償却明細.csv', csv(), 'text/csv;charset=utf-8')}
            >
              <Download size={16} />
              申告用明細CSV
            </button>
            <button className="button" disabled={locked} onClick={() => setAdding(true)}>
              <Plus size={17} />
              資産を登録・引継ぎ
            </button>
          </>
        }
      />
      <div className="metrics three-metrics">
        <div className="metric">
          <div className="metric-title">管理中の資産</div>
          <div className="metric-value">
            {assets.length}
            <small>件</small>
          </div>
        </div>
        <div className="metric">
          <div className="metric-title">償却明細の作成待ち</div>
          <div className="metric-value">
            {assets.filter((a) => !entries.some((d) => d.asset_id === a.id)).length}
            <small>件</small>
          </div>
        </div>
        <div className="metric metric-profit">
          <div className="metric-title">確定済みの減価償却費（事業分）</div>
          <div className="metric-value">
            {yen(
              entries
                .filter((d) =>
                  s.transactions.some((t) => t.id === d.transaction_id && t.status !== 'draft'),
                )
                .reduce((n, d) => n + (recordedBusinessAmount(s, d) ?? 0), 0),
            )}
          </div>
        </div>
      </div>
      <Card>
        {assets.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>資産 / 償却方法</th>
                  <th>取得日 / 供用日</th>
                  <th>取得価額</th>
                  <th>耐用年数 / 事業割合</th>
                  <th>当年償却 / 期末簿価</th>
                  <th>記帳</th>
                </tr>
              </thead>
              <tbody>
                {assets.map((a) => {
                  const d = entries.find((d) => d.asset_id === a.id),
                    t = s.transactions.find((t) => t.id === d?.transaction_id);
                  return (
                    <tr key={a.id}>
                      <td>
                        <strong>{a.name}</strong>
                        <small className="table-sub">
                          {a.asset_class} ·{' '}
                          {a.depreciation_method === 'straight_line' ? '定額法' : '手動確認'}
                        </small>
                        {a.opening_year && (
                          <small className="table-sub">{a.opening_year}年から引継ぎ</small>
                        )}
                      </td>
                      <td>
                        {a.acquisition_date}
                        <small className="table-sub">{a.in_service_date}</small>
                      </td>
                      <td className="number">{yen(a.acquisition_cost)}</td>
                      <td>
                        {a.useful_life_years}年 / {a.business_use_ratio}%
                      </td>
                      <td>
                        {d ? (
                          <>
                            {yen(d.depreciation_amount)}
                            <small className="table-sub">期末 {yen(d.closing_book_value)}</small>
                            <details>
                              <summary>計算根拠</summary>
                              <p>{d.rule_version}</p>
                              <p className="preserve-lines">{d.calculation}</p>
                            </details>
                          </>
                        ) : (
                          '未登録'
                        )}
                      </td>
                      <td>
                        {d ? (
                          t ? (
                            <button
                              className="button secondary compact"
                              onClick={() => openJournal(t)}
                            >
                              {t.status === 'draft' ? '下書きを確認・確定' : '確定済み仕訳を見る'}
                            </button>
                          ) : (
                            '償却0円・仕訳なし'
                          )
                        ) : (
                          <button
                            className="button secondary compact"
                            disabled={locked}
                            onClick={() => setDepreciate(a)}
                          >
                            <Calculator size={15} />
                            償却を計算・登録
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="固定資産を登録しましょう。">
            新規取得の機材・PC・車などに加え、他ソフトの前年末簿価から引き継げます。取得・期首残高の仕訳は別途確認してください。
          </Empty>
        )}
      </Card>
      <Card title="e-Taxへ入力する際の確認">
        <p>
          一般的な有形資産の定額法を自動計算します。使用月数・耐用年数・事業割合を確認してください。旧法、定率法、無形資産、一括償却、少額資産の特例、売却・除却・用途変更は、対象年度の計算を確認して手動の金額と根拠を登録します。
        </p>
        <p>
          新たな取得仕訳を二重に作らないよう、先に仕訳帳を確認してください。過年度からの引継ぎ登録では、以前の償却を再計上しません。取得日と供用日は別々に確認します。
        </p>
        <div className="actions">
          <a href={depreciationSources.method} target="_blank" rel="noreferrer">
            定額法・定率法の説明
          </a>
          <a href={depreciationSources.special} target="_blank" rel="noreferrer">
            少額資産・一括償却の適用条件
          </a>
          <a
            href="https://www.e-tax.nta.go.jp/toiawase/faq/nyuryoku/07.htm"
            target="_blank"
            rel="noreferrer"
          >
            e-Taxでの減価償却の入力
          </a>
        </div>
      </Card>
      {adding && <AssetForm onClose={() => setAdding(false)} />}
      {depreciate && <DepreciationForm asset={depreciate} onClose={() => setDepreciate(null)} />}
    </>
  );
}
function AssetForm({ onClose }: { onClose: () => void }) {
  const { s, year, engine, run, busy } = useApp();
  const date = today().startsWith(String(year)) ? today() : year + '-01-01';
  const [carry, setCarry] = useState(false),
    [balance, setBalance] = useState(0),
    [basis, setBasis] = useState('');
  const [a, setA] = useState<Asset>({
    id: newId(),
    year,
    name: '',
    acquisition_date: date,
    in_service_date: date,
    acquisition_cost: 0,
    asset_class: '工具器具備品',
    asset_account_id: '1500',
    useful_life_years: 4,
    depreciation_method: 'straight_line',
    business_use_ratio: 100,
    disposed_at: null,
    note: '',
  });
  return (
    <Modal title="固定資産の登録・引継ぎ" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            await engine.write((st) =>
              st.saveAsset({
                ...a,
                ...(carry
                  ? { opening_year: year, opening_book_value: balance, opening_basis: basis }
                  : {}),
              }),
            );
            onClose();
          }, '資産を登録しました。取得・期首仕訳の重複と残高を確認してください');
        }}
      >
        <div className="modal-body">
          <label className="check-row">
            <input type="checkbox" checked={carry} onChange={(e) => setCarry(e.target.checked)} />
            他ソフト・前年の固定資産台帳から引き継ぐ
          </label>
          <Field label="資産名">
            <input
              required
              maxLength={300}
              value={a.name}
              onChange={(e) => setA({ ...a, name: e.target.value })}
            />
          </Field>
          <div className="form-grid">
            <Field label="資産の勘定科目">
              <select
                value={a.asset_account_id}
                onChange={(e) =>
                  setA({
                    ...a,
                    asset_account_id: e.target.value,
                    asset_class: s.accounts.find((v) => v.id === e.target.value)!.name,
                  })
                }
              >
                {s.accounts
                  .filter((v) => v.type === 'asset' && v.is_active)
                  .map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="取得価額（円）">
              <input
                type="number"
                min="1"
                max="1000000000000"
                step="1"
                required
                value={a.acquisition_cost || ''}
                onChange={(e) => setA({ ...a, acquisition_cost: Number(e.target.value) })}
              />
            </Field>
            <Field label="取得日">
              <input
                type="date"
                required
                value={a.acquisition_date}
                onChange={(e) => setA({ ...a, acquisition_date: e.target.value })}
              />
            </Field>
            <Field label="事業供用日（実際に使い始めた日）">
              <input
                type="date"
                required
                value={a.in_service_date}
                onChange={(e) => setA({ ...a, in_service_date: e.target.value })}
              />
            </Field>
            <Field label="償却方法">
              <select
                value={a.depreciation_method}
                onChange={(e) =>
                  setA({
                    ...a,
                    depreciation_method: e.target.value as Asset['depreciation_method'],
                  })
                }
              >
                <option value="straight_line">定額法（有形資産・自動計算）</option>
                <option value="manual">その他の方法・確認した額を入力</option>
              </select>
            </Field>
            <Field label="確認した耐用年数">
              <input
                type="number"
                min="2"
                max="100"
                required
                value={a.useful_life_years}
                onChange={(e) => setA({ ...a, useful_life_years: Number(e.target.value) })}
              />
            </Field>
            <Field label="事業使用割合（%）">
              <input
                type="number"
                min="0"
                max="100"
                step="0.01"
                required
                value={a.business_use_ratio}
                onChange={(e) => setA({ ...a, business_use_ratio: Number(e.target.value) })}
              />
            </Field>
            {carry && (
              <Field label={year - 1 + '年末の未償却残高（円・私用分込み）'}>
                <input
                  type="number"
                  min="0"
                  max={a.acquisition_cost}
                  required
                  value={balance}
                  onChange={(e) => setBalance(Number(e.target.value))}
                />
              </Field>
            )}
          </div>
          {carry && (
            <Field label="引継ぎ残高の根拠">
              <textarea
                required
                maxLength={3000}
                value={basis}
                onChange={(e) => setBasis(e.target.value)}
                placeholder="前年の確定済み固定資産台帳の名称・ページ、未償却残高を確認した記録"
              />
            </Field>
          )}
          <Field label="用途・耐用年数・割合の根拠">
            <textarea
              required
              maxLength={3000}
              value={a.note}
              onChange={(e) => setA({ ...a, note: e.target.value })}
              placeholder="中古資産の耐用年数や事業使用割合も根拠を残します。"
            />
          </Field>
          <p className="small muted">
            この登録だけで取得費や過年度の償却費を仕訳に追加することはありません。引継ぎ簿価は帳簿の期首残高とも照合してください。
          </p>
        </div>
        <div className="modal-footer">
          <button className="button" disabled={busy} type="submit">
            確認した内容で資産を登録
          </button>
        </div>
      </form>
    </Modal>
  );
}
function DepreciationForm({ asset: a, onClose }: { asset: Asset; onClose: () => void }) {
  const { s, year, engine, run, busy } = useApp();
  let opening = 0,
    openingError = '';
  try {
    opening = openingValue(a, year, s.depreciations);
  } catch (e) {
    openingError = (e as Error).message;
  }
  const [automatic, setAutomatic] = useState(a.depreciation_method === 'straight_line');
  const [months, setMonths] = useState(
    Math.max(
      1,
      12 -
        (a.in_service_date.startsWith(String(year))
          ? Number(a.in_service_date.slice(5, 7)) - 1
          : 0),
    ),
  );
  const [manualAmount, setAmount] = useState(0),
    [rule, setRule] = useState(''),
    [basis, setBasis] = useState(''),
    [confirmed, setConfirmed] = useState(false);
  let calc: ReturnType<typeof straightLine> | undefined,
    error = openingError;
  if (automatic && !error)
    try {
      calc = straightLine(a, year, opening, months);
    } catch (e) {
      error = (e as Error).message;
    }
  const amount = automatic ? (calc?.amount ?? 0) : manualAmount;
  return (
    <Modal title={a.name + ' / ' + year + '年の減価償却'} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (error || !confirmed) return;
          void run(async () => {
            await engine.write((st) =>
              st.addDepreciation({
                asset_id: a.id,
                year,
                opening_book_value: opening,
                depreciation_amount: amount,
                rule_version: automatic ? calc!.rule : rule,
                calculation: automatic ? calc!.basis : basis,
                automatic,
                months,
              }),
            );
            onClose();
          }, '償却明細と下書きを作成しました。仕訳を確認・確定してください');
        }}
      >
        <div className="modal-body">
          {a.depreciation_method === 'straight_line' && (
            <label className="check-row">
              <input
                type="checkbox"
                checked={automatic}
                onChange={(e) => {
                  setAutomatic(e.target.checked);
                  setConfirmed(false);
                }}
              />
              定額法で計算する
            </label>
          )}
          <p>
            期首簿価 {yen(opening)} / 取得価額 {yen(a.acquisition_cost)} / 耐用年数{' '}
            {a.useful_life_years}年
          </p>
          {automatic ? (
            <>
              <Field label="本年中に事業に使用した月数">
                <input
                  type="number"
                  required
                  min="1"
                  max="12"
                  value={months}
                  onChange={(e) => {
                    setMonths(Number(e.target.value));
                    setConfirmed(false);
                  }}
                />
              </Field>
              <p className="small muted">
                供用月を含む月数を初期表示します。処分や中途での変更がある場合は実際の使用月数を確認してください。
              </p>
            </>
          ) : (
            <>
              <Field label="当年償却額（私用分込み・円）">
                <input
                  type="number"
                  min="0"
                  max={opening}
                  step="1"
                  required
                  value={manualAmount}
                  onChange={(e) => {
                    setAmount(Number(e.target.value));
                    setConfirmed(false);
                  }}
                />
              </Field>
              <Field label="対象年度・償却方法・計算ルール">
                <input
                  required
                  maxLength={200}
                  value={rule}
                  onChange={(e) => setRule(e.target.value)}
                />
              </Field>
              <Field label="計算根拠・資料">
                <textarea
                  required
                  maxLength={5000}
                  value={basis}
                  onChange={(e) => setBasis(e.target.value)}
                />
              </Field>
            </>
          )}
          {error ? (
            <p role="alert" className="notice">
              {error}
            </p>
          ) : (
            <>
              <div className="notice-block">
                償却額 {yen(amount)} / 必要経費{' '}
                {yen(businessDepreciation(amount, a.business_use_ratio))} / 期末未償却残高{' '}
                {yen(opening - amount)}
              </div>
              {calc && (
                <details open>
                  <summary>計算式と根拠</summary>
                  <p className="preserve-lines">{calc.basis}</p>
                </details>
              )}
              <label className="check-row">
                <input
                  type="checkbox"
                  required
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                />
                供用月数・耐用年数・事業割合・前年末簿価を確認しました
              </label>
            </>
          )}
        </div>
        <div className="modal-footer">
          <button className="button" type="submit" disabled={busy || !!error || !confirmed}>
            根拠を保存して下書き作成
          </button>
        </div>
      </form>
    </Modal>
  );
}
