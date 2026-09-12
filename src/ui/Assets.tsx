import { useState } from 'react';
import { Plus, Calculator, Package, Download } from 'lucide-react';
import { useApp } from './context';
import { Card, PageHeading, Modal, Field, Empty } from './shared';
import { newId, today, yen, type Asset } from '../domain/model';
import { download } from '../lib/persistence';
import { exportCsv } from '../lib/csv';
export default function Assets() {
  const { s, year, run, engine, busy } = useApp();
  const [adding, setAdding] = useState(false),
    [depreciate, setDepreciate] = useState<Asset | null>(null);
  const assets = s.assets.filter(
    (a) => a.year <= year && (!a.disposed_at || a.disposed_at >= `${year}-01-01`),
  );
  const locked = s.years.find((y) => y.year === year)?.status !== 'active';
  return (
    <>
      <PageHeading
        eyebrow="FIXED ASSETS"
        title="事業を支える資産を、記録する。"
        description="取得から毎年の償却まで、根拠と一緒に引き継ぐ固定資産台帳。"
        actions={
          <>
            <button
              className="button secondary"
              onClick={() =>
                download(
                  `${year}_固定資産台帳.csv`,
                  exportCsv([
                    ['名称', '取得日', '供用日', '取得価額', '耐用年数', '事業割合', '当年償却額'],
                    ...assets.map((a) => [
                      a.name,
                      a.acquisition_date,
                      a.in_service_date,
                      a.acquisition_cost,
                      a.useful_life_years,
                      a.business_use_ratio,
                      s.depreciations.find((d) => d.asset_id === a.id && d.year === year)
                        ?.depreciation_amount ?? '未登録',
                    ]),
                  ]),
                  'text/csv;charset=utf-8',
                )
              }
            >
              <Download size={16} />
              CSV出力
            </button>
            <button className="button" disabled={locked} onClick={() => setAdding(true)}>
              <Plus size={17} />
              資産を登録
            </button>
          </>
        }
      />
      <div className="metrics three-metrics">
        <div className="metric">
          <div className="metric-title">
            管理している資産
            <Package size={20} />
          </div>
          <div className="metric-value">
            {assets.length}
            <small>件</small>
          </div>
        </div>
        <div className="metric">
          <div className="metric-title">取得価額の合計</div>
          <div className="metric-value">
            {yen(assets.reduce((n, a) => n + a.acquisition_cost, 0))}
          </div>
        </div>
        <div className="metric metric-profit">
          <div className="metric-title">当年償却額（事業分）</div>
          <div className="metric-value">
            {yen(
              s.depreciations
                .filter((d) => d.year === year)
                .reduce(
                  (n, d) =>
                    n +
                    Math.floor(
                      (d.depreciation_amount *
                        (s.assets.find((a) => a.id === d.asset_id)?.business_use_ratio || 0)) /
                        100,
                    ),
                  0,
                ),
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
                  <th>資産名 / 種類</th>
                  <th>取得日 / 供用日</th>
                  <th>取得価額</th>
                  <th>耐用年数 / 事業割合</th>
                  <th>当年償却 / 期末簿価</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {assets.map((a) => {
                  const d = s.depreciations.find((d) => d.asset_id === a.id && d.year === year);
                  return (
                    <tr key={a.id}>
                      <td>
                        <strong>{a.name}</strong>
                        <small className="table-sub">{a.asset_class}</small>
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
                          </>
                        ) : (
                          '未登録'
                        )}
                      </td>
                      <td>
                        {d ? (
                          <details>
                            <summary>根拠</summary>
                            <p>{d.rule_version}</p>
                            <p className="preserve-lines">{d.calculation}</p>
                          </details>
                        ) : (
                          <button
                            className="button secondary compact"
                            disabled={locked}
                            onClick={() => setDepreciate(a)}
                          >
                            <Calculator size={15} />
                            償却を登録
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
            PC・機材・車両など、継続して事業に使う資産を管理できます。取得仕訳は別途記帳してください。
          </Empty>
        )}
      </Card>
      <p className="notice">
        償却額は対象年度の制度・取得日・償却方法を確認して入力します。この版は税率・特例を自動判定せず、入力した金額と根拠を保持し、記帳用の下書きを作成します。
      </p>
      {adding && <AssetForm onClose={() => setAdding(false)} />}{' '}
      {depreciate && <DepreciationForm asset={depreciate} onClose={() => setDepreciate(null)} />}
    </>
  );
}
function AssetForm({ onClose }: { onClose: () => void }) {
  const { year, engine, run, busy } = useApp();
  const date = today().startsWith(String(year)) ? today() : `${year}-01-01`;
  const [a, setA] = useState<Asset>({
    id: newId(),
    year,
    name: '',
    acquisition_date: date,
    in_service_date: date,
    acquisition_cost: 0,
    asset_class: '工具器具備品',
    useful_life_years: 4,
    depreciation_method: 'manual',
    business_use_ratio: 100,
    disposed_at: null,
    note: '',
  });
  return (
    <Modal title="固定資産を登録" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            await engine.write((st) => st.saveAsset(a));
            onClose();
          }, '資産を登録しました。取得の仕訳も記帳してください');
        }}
      >
        <div className="modal-body">
          <Field label="資産名">
            <input required value={a.name} onChange={(e) => setA({ ...a, name: e.target.value })} />
          </Field>
          <div className="form-grid">
            <Field label="資産区分">
              <select
                value={a.asset_class}
                onChange={(e) => setA({ ...a, asset_class: e.target.value })}
              >
                <option>工具器具備品</option>
                <option>車両運搬具</option>
              </select>
            </Field>
            <Field label="取得価額（円）">
              <input
                type="number"
                required
                min="1"
                step="1"
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
            <Field label="事業供用日">
              <input
                type="date"
                required
                value={a.in_service_date}
                onChange={(e) => setA({ ...a, in_service_date: e.target.value })}
              />
            </Field>
            <Field label="耐用年数（確認した年数）">
              <input
                type="number"
                min="1"
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
                step="0.1"
                value={a.business_use_ratio}
                onChange={(e) => setA({ ...a, business_use_ratio: Number(e.target.value) })}
              />
            </Field>
          </div>
          <Field label="確認した償却方法・根拠のメモ">
            <textarea
              required
              value={a.note}
              onChange={(e) => setA({ ...a, note: e.target.value })}
              placeholder="定額法などの方法、確認した資料、用途を記入"
            />
          </Field>
        </div>
        <div className="modal-footer">
          <button className="button" type="submit" disabled={busy}>
            資産を登録
          </button>
        </div>
      </form>
    </Modal>
  );
}
function DepreciationForm({ asset: a, onClose }: { asset: Asset; onClose: () => void }) {
  const { s, year, engine, run, busy } = useApp();
  const prior = s.depreciations
    .filter((d) => d.asset_id === a.id && d.year < year)
    .sort((a, b) => b.year - a.year)[0];
  const [opening, setOpening] = useState(prior?.closing_book_value ?? a.acquisition_cost),
    [amount, setAmount] = useState(0),
    [rule, setRule] = useState(''),
    [basis, setBasis] = useState('');
  return (
    <Modal title={`${a.name} / ${year}年の償却`} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            await engine.write((st) =>
              st.addDepreciation({
                asset_id: a.id,
                year,
                opening_book_value: opening,
                depreciation_amount: amount,
                rule_version: rule,
                calculation: basis,
              }),
            );
            onClose();
          }, '償却明細と下書き仕訳を作成しました');
        }}
      >
        <div className="modal-body">
          <p>対象年度の制度で確認した償却額を入力してください。</p>
          <div className="form-grid">
            <Field label="期首簿価（円）">
              <input
                type="number"
                required
                min="0"
                step="1"
                value={opening}
                onChange={(e) => setOpening(Number(e.target.value))}
              />
            </Field>
            <Field label="当年の償却額・私用分込み（円）">
              <input
                type="number"
                min="0"
                step="1"
                required
                value={amount}
                onChange={(e) => setAmount(Number(e.target.value))}
              />
            </Field>
          </div>
          <div className="notice-block">
            事業分 {yen(Math.floor((amount * a.business_use_ratio) / 100))} / 期末簿価{' '}
            {yen(opening - amount)}
          </div>
          <Field label="税制・計算ルールの版">
            <input
              required
              placeholder={`${year}年 / 確認資料・償却方法`}
              value={rule}
              onChange={(e) => setRule(e.target.value)}
            />
          </Field>
          <Field label="計算根拠・参照した資料">
            <textarea required value={basis} onChange={(e) => setBasis(e.target.value)} />
          </Field>
        </div>
        <div className="modal-footer">
          <button className="button" type="submit" disabled={busy}>
            根拠を保存して下書き作成
          </button>
        </div>
      </form>
    </Modal>
  );
}
