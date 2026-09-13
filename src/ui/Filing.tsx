import { useState } from 'react';
import { z } from 'zod';
import { ArrowRight, Download, Plus, CheckCircle2, AlertCircle, ExternalLink } from 'lucide-react';
import { useApp, type Page } from './context';
import { PageHeading, Card, Field, Modal } from './shared';
import { report } from '../domain/accounting';
import {
  filingItems,
  filingState,
  filingStatusSchema,
  filingDetailSchema,
  detailKinds,
  filingFiles,
  filingChecks,
  filingSources,
} from '../domain/filing';
import { newId, now, yen } from '../domain/model';
import { bookLabel, isMisc } from '../lib/book';
import { zipFiles } from '../lib/packs';
import { download } from '../lib/persistence';
import FilingDocuments from './FilingDocuments';

export default function Filing() {
  const { s, year, navigate, run, busy, engine, syncStatus } = useApp();
  const state = filingState(s, year),
    r = report(s, year),
    checks = filingChecks(s, year);
  const [editing, setEditing] = useState<(typeof filingItems)[number] | null>(null),
    [detail, setDetail] = useState<z.infer<typeof filingDetailSchema> | null>(null);
  const unresolved = filingItems.filter(
    (i) => !state.checks.some((c) => c.item === i.id && c.status !== 'todo'),
  ).length;
  const warnings = checks.filter((c) => c.count > 0);
  return (
    <>
      <PageHeading
        eyebrow="E-TAX PREPARATION"
        title={`${year}年の確定申告を、順番に準備。`}
        description={`${bookLabel}の集計と準備状況です。事業と雑所得はそれぞれ確認し、国税庁の作成コーナーで所得税申告をまとめます。`}
        actions={
          <button
            className="button"
            disabled={busy}
            onClick={() =>
              void run(
                async () =>
                  download(
                    `${year}_${bookLabel}_申告準備.zip`,
                    await zipFiles(filingFiles(s, year, bookLabel)),
                  ),
                '申告準備資料を書き出しました',
              )
            }
          >
            <Download size={16} />
            申告準備資料をまとめて保存
          </button>
        }
      />
      <div className="filing-path">
        <span>1 資料・記帳</span>
        <ArrowRight size={16} />
        <span>2 決算整理</span>
        <ArrowRight size={16} />
        <span>3 e-Tax入力</span>
        <ArrowRight size={16} />
        <span>4 送信・保存</span>
      </div>
      <Card
        title="控除・株式はマイナポータル連携で自動入力"
        subtitle="国税庁の作成コーナーで取得する流れです。このアプリにマイナンバーや暗証番号を入力する必要はありません。"
      >
        <p>
          連携済みの保険料控除証明書、寄附金、医療費通知情報、特定口座年間取引報告書などを、作成コーナーで取得して申告書へ反映できます。連携先・対象年・発行状況によって取得できる資料が異なります。
        </p>
        <ol>
          <li>事前準備で、証券会社・保険会社等の連携と電子交付を確認します。</li>
          <li>
            下の「作成コーナーで取得する」を開き、マイナンバーカード方式とマイナポータル連携を選びます。
          </li>
          <li>
            取得結果の年分・件数・金額を確認し、未取得分を補います。手入力・XML読込と同じ資料を二重入力しないようにします。
          </li>
        </ol>
        <div className="actions">
          <a className="button" href={filingSources.start} target="_blank" rel="noreferrer">
            作成コーナーで取得する
            <ExternalLink size={16} />
          </a>
          <a
            className="button secondary"
            href="https://www.nta.go.jp/taxes/tetsuzuki/mynumberinfo/mnp_junbi/kakutei.htm"
            target="_blank"
            rel="noreferrer"
          >
            連携の準備・対象資料
          </a>
          <a
            className="text-button"
            href="https://www.nta.go.jp/taxes/tetsuzuki/mynumberinfo/list.htm"
            target="_blank"
            rel="noreferrer"
          >
            対応する証券会社・保険会社
          </a>
        </div>
        <p className="small muted">
          ここからの自動取得や常時接続は未対応です。公式サービスで取得した結果は申告書側に反映し、準備状況と保管先はこの画面に記録できます。
        </p>
      </Card>
      <FilingDocuments key={year} />
      <div className="metrics three-metrics">
        <div className="metric">
          <div className="metric-title">総収入</div>
          <div className="metric-value">{yen(r.revenue)}</div>
        </div>
        <div className="metric">
          <div className="metric-title">必要経費</div>
          <div className="metric-value">{yen(r.expense)}</div>
        </div>
        <div className="metric metric-profit">
          <div className="metric-title">
            {isMisc ? '差引金額（所得区分等の確認前）' : '青色申告特別控除前の差引金額'}
          </div>
          <div className="metric-value">{yen(r.profit)}</div>
        </div>
      </div>
      <Card
        title="帳簿の自動チェック"
        subtitle="このチェックだけで申告完了にはなりません。未入力の資料や適用要件は下の確認リストで点検します。"
      >
        {warnings.length ? (
          warnings.map((c) => (
            <div className="closing-check" key={c.label}>
              <AlertCircle size={18} />
              <span>{c.label}</span>
              <strong>{c.count}件</strong>
              <small>{c.fatal ? '要修正' : '要確認'}</small>
            </div>
          ))
        ) : (
          <p>
            <CheckCircle2 size={18} /> 現在登録された帳簿のチェックに問題は見つかりませんでした。
          </p>
        )}
        {syncStatus.phase !== 'synced' && (
          <p className="notice">
            Driveへの最新の同期を確認してください。
            <button className="text-button" onClick={() => navigate('drive')}>
              同期画面へ
            </button>
          </p>
        )}
        <div className="actions">
          <button className="button secondary" onClick={() => navigate('ledger')}>
            仕訳を点検
          </button>
          <button className="button secondary" onClick={() => navigate('assets')}>
            減価償却を確認
          </button>
          <button className="button secondary" onClick={() => navigate('reports')}>
            P/L・B/S・元帳を確認
          </button>
        </div>
      </Card>
      <Card
        title={`資料・処理の確認リスト · 残り${unresolved}項目`}
        subtitle="「確認済み」または「該当なし」と根拠を記録できます。年度・所得区分ごとにDriveへ同期します。"
      >
        {['資料・記帳', '決算整理', '申告書の入力', '送信・保存'].map((group) => (
          <section className="filing-group" key={group}>
            <h3>{group}</h3>
            {filingItems
              .filter((i) => i.group === group)
              .map((i) => {
                const c = state.checks.find((c) => c.item === i.id);
                return (
                  <div className="filing-item" key={i.id}>
                    <div>
                      <strong>{i.title}</strong>
                      <p>{i.detail}</p>
                      {c?.note && <small className="preserve-lines">記録：{c.note}</small>}
                    </div>
                    <div className="actions">
                      <button
                        className={`button ${c?.status === 'ready' ? '' : 'secondary'} compact`}
                        onClick={() => setEditing(i)}
                      >
                        {c?.status === 'ready'
                          ? '確認済み'
                          : c?.status === 'na'
                            ? '該当なし'
                            : '未確認・記録する'}
                      </button>
                      {i.page !== 'filing' && (
                        <button className="text-button" onClick={() => navigate(i.page as Page)}>
                          開く
                          <ArrowRight size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
          </section>
        ))}
      </Card>
      <Card
        title="申告補足明細"
        subtitle="支払者別の源泉徴収、家賃・給与等の内訳、控除や繰越額を記録。帳簿の収入・経費へは加算せず、申告準備ZIPに含めます。"
      >
        <button
          className="button secondary"
          onClick={() =>
            setDetail({
              id: newId(),
              year,
              kind: detailKinds[0],
              name: '',
              amount: 0,
              withheld: 0,
              note: '',
            })
          }
        >
          <Plus size={16} />
          補足明細を追加
        </button>
        {state.details.length > 0 && (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>種類・相手先</th>
                  <th>金額</th>
                  <th>源泉徴収税額</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {state.details.map((d) => (
                  <tr key={d.id}>
                    <td>
                      {d.kind}
                      <small className="table-sub">{d.name}</small>
                    </td>
                    <td>{yen(d.amount)}</td>
                    <td>{yen(d.withheld)}</td>
                    <td>
                      <button className="text-button" onClick={() => setDetail(d)}>
                        編集
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Card title="準備ができたら、国税庁の作成コーナーへ">
        <ol>
          <li>
            対象年を選び、事業所得は青色申告決算書を作成。科目別金額、月別売上・仕入、減価償却、期首・期末B/Sを照合します。
          </li>
          <li>所得税申告へ進み、雑所得・他の所得、源泉徴収、各種控除、繰越損失等を入力します。</li>
          <li>
            提出する申告書・決算書・添付資料を確認してe-Taxで送信し、受信通知と納付方法を確認します。
          </li>
          <li>
            申告書PDF・保存データ・受信通知・納付記録をDriveへ保管してから、年度をロックして翌期へ繰り越します。
          </li>
        </ol>
        <p className="notice">
          ZIP内のCSVは転記・照合用です。e-Taxへそのまま取り込む形式ではありません。正式な決算書・申告書と税額計算は作成コーナーで完成させます。帳簿の年度ロックと、申告書の送信は別の操作です。
        </p>
        <div className="actions">
          <a className="button" href={filingSources.start} target="_blank" rel="noreferrer">
            国税庁の作成コーナーを開く
            <ExternalLink size={16} />
          </a>
          <button className="button secondary" onClick={() => navigate('closing')}>
            年度締め・繰越
          </button>
        </div>
        <p className="small muted">
          <a href={filingSources.flow} target="_blank" rel="noreferrer">
            国税庁：決算書から所得税申告への流れ
          </a>{' '}
          /{' '}
          <a href={filingSources.blue} target="_blank" rel="noreferrer">
            青色申告の要件
          </a>{' '}
          /{' '}
          <a href={filingSources.records} target="_blank" rel="noreferrer">
            帳簿・書類の保存
          </a>
        </p>
      </Card>
      {editing && (
        <CheckForm key={year + '_' + editing.id} item={editing} onClose={() => setEditing(null)} />
      )}
      {detail && <DetailForm key={detail.id} initial={detail} onClose={() => setDetail(null)} />}
    </>
  );
}

function CheckForm({ item, onClose }: { item: (typeof filingItems)[number]; onClose: () => void }) {
  const { s, year, engine, run, busy } = useApp();
  const key = 'filing_check_' + year + '_' + item.id,
    before = s.settings[key] || '';
  const old = filingState(s, year).checks.find((c) => c.item === item.id);
  const [status, setStatus] = useState<'todo' | 'ready' | 'na'>(old?.status ?? 'todo'),
    [note, setNote] = useState(old?.note ?? '');
  // Capture the version when the dialog opens, including changes from other tabs/devices.
  const [base] = useState(before);
  return (
    <Modal title={item.title} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            const value = filingStatusSchema.parse({
              year,
              item: item.id,
              status,
              note,
              updated: now(),
            });
            await engine.write((st) => {
              if ((st.setting(key) || '') !== base)
                throw new Error('他の端末で更新されています。開き直して確認してください');
              st.setSetting(key, JSON.stringify(value));
            });
            onClose();
          }, '申告準備の確認を記録しました');
        }}
      >
        <div className="modal-body">
          <p>{item.detail}</p>
          <Field label="準備状況">
            <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
              <option value="todo">未確認・準備中</option>
              <option value="ready">確認済み</option>
              <option value="na">該当なし</option>
            </select>
          </Field>
          <Field label="確認した資料・根拠・保管場所">
            <textarea
              maxLength={3000}
              required={status !== 'todo'}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="資料名・DriveのURL・確認結果、該当しない理由など。"
            />
          </Field>
        </div>
        <div className="modal-footer">
          <button className="button" disabled={busy}>
            記録を保存
          </button>
        </div>
      </form>
    </Modal>
  );
}
function DetailForm({
  initial,
  onClose,
}: {
  initial: z.infer<typeof filingDetailSchema>;
  onClose: () => void;
}) {
  const { engine, run, busy } = useApp();
  const [d, setD] = useState(initial);
  const key = 'filing_detail_' + initial.year + '_' + initial.id;
  const [base] = useState(engine.store.setting(key) || '');
  return (
    <Modal title="申告補足明細" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            const value = filingDetailSchema.parse(d);
            await engine.write((st) => {
              if ((st.setting(key) || '') !== base)
                throw new Error('別の端末で更新されています。開き直してください');
              st.setSetting(key, JSON.stringify(value));
            });
            onClose();
          }, '補足明細を保存しました（帳簿の金額は変わりません）');
        }}
      >
        <div className="modal-body">
          <Field label="明細の種類">
            <select
              value={d.kind}
              onChange={(e) => setD({ ...d, kind: e.target.value as typeof d.kind })}
            >
              {detailKinds.map((k) => (
                <option key={k}>{k}</option>
              ))}
            </select>
          </Field>
          <Field label="支払者・受取人・項目名">
            <input
              required
              maxLength={200}
              value={d.name}
              onChange={(e) => setD({ ...d, name: e.target.value })}
            />
          </Field>
          <div className="form-grid">
            <Field label="金額（円・収入なら源泉徴収前）">
              <input
                type="number"
                required
                min="-1000000000000"
                max="1000000000000"
                step="1"
                value={d.amount}
                onChange={(e) => setD({ ...d, amount: Number(e.target.value) })}
              />
            </Field>
            <Field label="源泉徴収税額（円・なければ0）">
              <input
                type="number"
                required
                min="0"
                max="1000000000000"
                step="1"
                value={d.withheld}
                onChange={(e) => setD({ ...d, withheld: Number(e.target.value) })}
              />
            </Field>
          </div>
          <Field label="期間・内訳・根拠資料の場所">
            <textarea
              maxLength={2000}
              value={d.note}
              onChange={(e) => setD({ ...d, note: e.target.value })}
            />
          </Field>
          <p className="small muted">
            控除額の適用判定や源泉徴収税額の自動集計は行いません。作成コーナーで入力・照合するための補足資料です。
          </p>
        </div>
        <div className="modal-footer">
          <button className="button" disabled={busy}>
            補足明細を保存
          </button>
        </div>
      </form>
    </Modal>
  );
}
