import { useState } from 'react';
import {
  Plus,
  MessageCircle,
  Download,
  Sparkles,
  FileCheck2,
  ArrowUpRight,
  Send,
  Check,
  FileText,
  Settings2,
} from 'lucide-react';
import { useApp } from './context';
import { PageHeading, Card, Empty, Badge, Modal, Field, FileButton } from './shared';
import {
  newId,
  now,
  labels,
  reviewTypes,
  findingStatuses,
  type Audit,
  type Finding,
} from '../domain/model';
import {
  buildAuditFiles,
  defaultPackOptions,
  zipFiles,
  buildEvidencePack,
  type PackOptions,
  type PackFiles,
} from '../lib/packs';
import { download } from '../lib/persistence';
import { incomeActivities } from '../domain/activities';
import { isMisc } from '../lib/book';

export default function Consult() {
  const { s, year, engine, run, busy, navigate } = useApp();
  const [creating, setCreating] = useState(false),
    [selected, setSelected] = useState(''),
    [thread, setThread] = useState<{ audit: Audit; finding: Finding | null } | null>(null);
  const audits = s.audits.filter((a) => a.target_years.includes(year));
  const active = audits.find((a) => a.id === selected) || audits[0];
  const findings = s.findings.filter((f) => f.audit_id === active?.id);
  const importResult = (files: File[]) =>
    void run(async () => {
      const value = JSON.parse(await files[0].text());
      await engine.write(
        (st) => (Array.isArray(value.messages) ? st.importReplies(value) : st.importAudit(value)),
        'AI相談結果取込前',
      );
      setSelected(value.audit_id);
    }, 'AIの回答を相談履歴に取り込みました');
  return (
    <>
      <PageHeading
        eyebrow="YOUR THINKING PARTNER"
        title={isMisc ? '雑所得の実態から、相談しよう。' : '事業のことから、相談しよう。'}
        description="AIと壁打ちし、疑問を深めて、専門家への相談をもっと具体的に。"
        actions={
          <>
            <FileButton onFile={importResult} disabled={busy}>
              AIの回答を取り込む
            </FileButton>
            <button className="button" onClick={() => setCreating(true)}>
              <Plus size={17} />
              新しい相談
            </button>
          </>
        }
      />
      <div className="consult-intro">
        <div className="consult-intro-copy">
          <span className="eyebrow">CONTEXT MAKES THE DIFFERENCE</span>
          <h2>
            あなたのビジネスを知っている、
            <br />
            相談の準備ができていますか。
          </h2>
          <p>
            業種・売上の成り立ち・普段の働き方。数字だけでは伝わらない背景を、帳簿と一緒に相談相手へ。
          </p>
          <button className="text-button" onClick={() => navigate('settings')}>
            事業プロフィールを{s.profile.industry ? '編集' : '入力'}する
            <ArrowUpRight size={17} />
          </button>
        </div>
        <div className="business-context">
          <div className="context-icon">
            <MessageCircle size={28} />
          </div>
          <span className="small muted">
            {isMisc ? '雑所得' : '事業'}の共通情報・{year}年に該当する活動
          </span>
          <strong>{s.profile.industry || '業種を設定しましょう'}</strong>
          <p>
            {s.profile.description ||
              '仕事内容、顧客、収益モデルを入力すると、実態に即した相談ができます。'}
          </p>
          <div className="context-tags">
            <span>{incomeActivities(s, [year]).length}件の活動プロフィール</span>
            <span>{s.profile.work_style ? '働き方 登録済み' : '働き方 未設定'}</span>
            <span>{s.profile.revenue_model ? '収益モデル 登録済み' : '収益モデル 未設定'}</span>
          </div>
        </div>
      </div>
      <div className="workflow">
        <div>
          <b>01</b>
          <span>
            <strong>相談パックをつくる</strong>
            <small>事業情報・帳簿・質問を選ぶ</small>
          </span>
        </div>
        <i>→</i>
        <div>
          <b>02</b>
          <span>
            <strong>ChatGPTに渡す</strong>
            <small>ZIPを添付し、JSONで回答をもらう</small>
          </span>
        </div>
        <i>→</i>
        <div>
          <b>03</b>
          <span>
            <strong>回答して、深める</strong>
            <small>指摘への返答を添えて対話を続ける</small>
          </span>
        </div>
      </div>
      {!audits.length ? (
        <Card>
          <Empty
            title="最初の相談を、ここから。"
            action={
              <button className="button" onClick={() => setCreating(true)}>
                <Sparkles size={17} />
                相談を準備する
              </button>
            }
          >
            「この支出は経費になる？」「申告前に漏れがないか確認したい」
            <br />
            事業の背景を添えて、具体的に相談できます。
          </Empty>
        </Card>
      ) : (
        <div className="consult-workspace">
          <aside className="consult-history">
            <h3>
              相談の履歴 <span>{audits.length}</span>
            </h3>
            {audits.map((a) => (
              <button
                className={`history-item ${a.id === active?.id ? 'active' : ''}`}
                key={a.id}
                onClick={() => setSelected(a.id)}
              >
                <span>{labels[a.review_type]}</span>
                <strong>{a.question || '帳簿の総合チェック'}</strong>
                <small>
                  {a.created_at.slice(0, 10)} ·{' '}
                  {a.status === 'prepared' ? 'AI回答の取込待ち' : '回答あり'}
                </small>
              </button>
            ))}
          </aside>
          <div>
            {active && (
              <Card
                title={labels[active.review_type]}
                subtitle={`${active.target_years.join('・')}年 / 法令の基準年度 ${active.law_basis_years.join('・')}年`}
                action={
                  <button
                    className="button secondary"
                    onClick={() => setThread({ audit: active, finding: null })}
                  >
                    <MessageCircle size={16} />
                    相談全体で対話
                  </button>
                }
              >
                <div className="consult-summary">
                  <span className="small muted">相談したこと</span>
                  <h3>{active.question || '帳簿の整合性と税務上の論点の確認'}</h3>
                  {active.summary && <p className="preserve-lines">{active.summary}</p>}
                  {active.status === 'prepared' && (
                    <div className="notice-block">
                      <strong>相談パックをChatGPTに添付してください。</strong>
                      <p>
                        パック内のREADMEの手順に沿って回答JSONを作成してもらい、「AIの回答を取り込む」で戻します。
                      </p>
                      <button
                        className="text-button"
                        onClick={() => setThread({ audit: active, finding: null })}
                      >
                        パックを再出力する
                        <Download size={16} />
                      </button>
                    </div>
                  )}
                </div>
                {findings.length > 0 && (
                  <div className="findings-list">
                    {findings.map((f) => (
                      <button
                        key={f.id}
                        className="finding-item"
                        onClick={() => setThread({ audit: active, finding: f })}
                      >
                        <div className="finding-item-top">
                          <Badge value={f.severity} />
                          <Badge value={f.status} />
                          <small className="muted">確信度 {Math.round(f.confidence * 100)}%</small>
                        </div>
                        <h3>{f.title}</h3>
                        <p>{f.description}</p>
                        <span className="finding-reply">
                          <MessageCircle size={15} />
                          {s.messages.filter((m) => m.finding_id === f.id).length
                            ? `${s.messages.filter((m) => m.finding_id === f.id).length}件の対話`
                            : '回答・追加質問をする'}
                          <ArrowUpRight size={15} />
                        </span>
                      </button>
                    ))}
                  </div>
                )}
                {active.status === 'imported' && !findings.length && (
                  <p className="notice">
                    <Check size={18} />
                    このレビューでは個別指摘はありませんでした。全体の相談から追加質問できます。
                  </p>
                )}
              </Card>
            )}
          </div>
        </div>
      )}
      <p className="page-footnote">
        AIの回答は専門家への相談前の検討材料です。法令の解釈や暫定的な判断案も相談でき、申告・帳簿への反映は自分で確認して行えます。
      </p>
      {creating && (
        <NewConsult
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setSelected(id);
            setCreating(false);
          }}
        />
      )}
      {thread && (
        <ThreadModal
          audit={s.audits.find((a) => a.id === thread.audit.id)!}
          finding={s.findings.find((f) => f.id === thread.finding?.id) || null}
          onClose={() => setThread(null)}
        />
      )}
    </>
  );
}
function NewConsult({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const { s, year, engine, run, busy } = useApp();
  const [type, setType] = useState<Audit['review_type']>('individual'),
    [years, setYears] = useState<number[]>([year]),
    [question, setQuestion] = useState(''),
    [options, setOptions] = useState<PackOptions>(defaultPackOptions(year)),
    [preview, setPreview] = useState<{ audit: Audit; files: PackFiles } | null>(null);
  const multi = ['multi_year', 'continuity'].includes(type);
  const prepare = () => {
    if (!years.length) return;
    const a: Audit = {
      id: newId(),
      review_type: type,
      target_years: years,
      law_basis_years: years,
      created_at: now(),
      status: 'prepared',
      question,
      summary: '',
      requested_evidence_ids: [],
    };
    const opts = multi
      ? { ...options, from: `${Math.min(...years)}-01-01`, to: `${Math.max(...years)}-12-31` }
      : options;
    setPreview({ audit: a, files: buildAuditFiles(s, a, opts) });
  };
  return (
    <Modal title={preview ? '相談パックの内容を確認' : '新しい相談を準備'} wide onClose={onClose}>
      <div className="modal-body">
        {preview ? (
          <>
            <p>
              このデータをZIPにまとめます。<strong>原本の画像やPDFは含みません。</strong>
            </p>
            <div className="pack-files">
              {Object.entries(preview.files).map(([name, content]) => (
                <details key={name}>
                  <summary>
                    <FileText size={15} />
                    {name}
                  </summary>
                  <pre>{typeof content === 'string' ? content : 'バイナリデータ'}</pre>
                </details>
              ))}
            </div>
            <p className="notice">
              自由記述に住所や個人情報が含まれていないか、上のプレビューで確認してください。番号・メール等は簡易マスクしています。
            </p>
          </>
        ) : (
          <>
            <div className="form-grid">
              <Field label="相談のテーマ">
                <select
                  value={type}
                  onChange={(e) => {
                    setType(e.target.value as Audit['review_type']);
                    setYears([year]);
                    setOptions(defaultPackOptions(year));
                  }}
                >
                  {reviewTypes.map((t) => (
                    <option key={t} value={t}>
                      {labels[t]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={multi ? '対象年度（複数選択）' : '対象年度'}>
                {multi ? (
                  <div className="year-checkboxes">
                    {s.years.map((y) => (
                      <label key={y.year}>
                        <input
                          type="checkbox"
                          checked={years.includes(y.year)}
                          onChange={(e) =>
                            setYears(
                              e.target.checked
                                ? [...years, y.year]
                                : years.filter((x) => x !== y.year),
                            )
                          }
                        />
                        {y.year}年
                      </label>
                    ))}
                  </div>
                ) : (
                  <select
                    value={years[0] || year}
                    onChange={(e) => {
                      const y = Number(e.target.value);
                      setYears([y]);
                      setOptions({ ...options, from: `${y}-01-01`, to: `${y}-12-31` });
                    }}
                  >
                    {s.years.map((y) => (
                      <option key={y.year} value={y.year}>
                        {y.year}年
                      </option>
                    ))}
                  </select>
                )}
              </Field>
              <Field label="相談したいこと・確認したい疑問" className="span-2">
                <textarea
                  rows={4}
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  maxLength={10000}
                  placeholder="例：自宅の一室を仕事場として使っています。仕事内容と働き方を踏まえて、家賃の按分根拠をどう整理するとよいか検討してください。"
                />
              </Field>
            </div>
            <div className="suggested-questions">
              {[
                '事業の実態に照らして、経費処理で確認すべき点を教えてください。',
                '確定申告前に、帳簿の漏れや不整合を確認してください。',
                '売上・利益の変化を読み解き、税務上の論点も整理してください。',
              ].map((q) => (
                <button key={q} onClick={() => setQuestion(q)}>
                  {q}
                </button>
              ))}
            </div>
            <h3 className="form-section-title">相談に添える情報</h3>
            <div className="checkbox-list">
              {(
                [
                  ['includeProfile', '業種・仕事内容・働き方などの事業プロフィール'],
                  ['includeLedger', '仕訳・試算表・損益・月次推移'],
                  ['includeAssets', '固定資産と償却明細'],
                  ['includeEvidenceIndex', '証憑の索引（原本は含めない）'],
                  ['includeSourceText', '過年度資料の抽出テキスト（OCR誤り・個人情報に注意）'],
                  ['includeNames', '屋号・証憑ファイル名も含める'],
                ] as const
              ).map(([key, label]) => (
                <label key={key}>
                  <input
                    type="checkbox"
                    checked={options[key]}
                    onChange={(e) => setOptions({ ...options, [key]: e.target.checked })}
                  />
                  {label}
                </label>
              ))}
            </div>
            <details className="details">
              <summary>対象を期間・科目・個別仕訳で絞る</summary>
              <div className="form-grid">
                {!multi && (
                  <>
                    <Field label="開始日">
                      <input
                        type="date"
                        value={options.from}
                        onChange={(e) => setOptions({ ...options, from: e.target.value })}
                      />
                    </Field>
                    <Field label="終了日">
                      <input
                        type="date"
                        value={options.to}
                        onChange={(e) => setOptions({ ...options, to: e.target.value })}
                      />
                    </Field>
                  </>
                )}
                <Field label="対象科目">
                  <select
                    value={options.account}
                    onChange={(e) => setOptions({ ...options, account: e.target.value })}
                  >
                    <option value="">すべて</option>
                    {s.accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <div className="checkbox-list bounded">
                {s.transactions
                  .filter((t) => years.includes(t.year))
                  .map((t) => (
                    <label key={t.id}>
                      <input
                        type="checkbox"
                        checked={options.transactionIds.includes(t.id)}
                        onChange={(e) =>
                          setOptions({
                            ...options,
                            transactionIds: e.target.checked
                              ? [...options.transactionIds, t.id]
                              : options.transactionIds.filter((id) => id !== t.id),
                          })
                        }
                      />
                      {t.transaction_date} {t.description}
                    </label>
                  ))}
              </div>
              <p className="small muted">仕訳を選択しなければ対象期間のすべてを含みます。</p>
            </details>
          </>
        )}
      </div>
      <div className="modal-footer">
        {preview ? (
          <>
            <button className="button secondary" onClick={() => setPreview(null)}>
              内容を変更
            </button>
            <button
              className="button"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const zip = await zipFiles(preview.files);
                  await engine.write((st) => {
                    st.createAudit(preview.audit);
                    st.setSetting(
                      `audit_options_${preview.audit.id}`,
                      JSON.stringify(
                        multi
                          ? {
                              ...options,
                              from: `${Math.min(...years)}-01-01`,
                              to: `${Math.max(...years)}-12-31`,
                            }
                          : options,
                      ),
                    );
                  });
                  download(`aoiro_consult_${preview.audit.id.slice(0, 8)}.zip`, zip);
                  onCreated(preview.audit.id);
                }, '相談パックを保存しました')
              }
            >
              <Download size={17} />
              ZIPを保存して相談を始める
            </button>
          </>
        ) : (
          <button
            className="button"
            disabled={
              !years.length ||
              !question.trim() ||
              options.from > options.to ||
              (type === 'continuity' && (years.length !== 2 || Math.abs(years[0] - years[1]) !== 1))
            }
            onClick={prepare}
          >
            含まれるデータを確認
            <FileCheck2 size={17} />
          </button>
        )}
      </div>
    </Modal>
  );
}
function ThreadModal({
  audit: a,
  finding: f,
  onClose,
}: {
  audit: Audit;
  finding: Finding | null;
  onClose: () => void;
}) {
  const { s, engine, drive, run, busy, openJournal } = useApp();
  const [reply, setReply] = useState(''),
    [note, setNote] = useState(f?.resolution_note || ''),
    [originals, setOriginals] = useState(false),
    [selectedEvidence, setSelectedEvidence] = useState<string[]>([]),
    [packPreview, setPackPreview] = useState<PackFiles | null>(null);
  const messages = s.messages.filter(
    (m) => m.audit_id === a.id && m.finding_id === (f?.id || null),
  );
  const requested = [...new Set(f?.requested_evidence_ids || a.requested_evidence_ids)];
  const exportDialogue = () => {
    const options: PackOptions = JSON.parse(
      s.settings[`audit_options_${a.id}`] || JSON.stringify(defaultPackOptions(a.target_years[0])),
    );
    setPackPreview(buildAuditFiles(s, a, options));
  };
  return (
    <Modal title={f ? f.title : '相談全体の対話'} wide onClose={onClose}>
      <div className="modal-body">
        {f ? (
          <>
            <div className="actions">
              <Badge value={f.severity} />
              <Badge value={f.status} />
              <span className="small muted">確信度 {Math.round(f.confidence * 100)}%</span>
            </div>
            <p className="preserve-lines">{f.description}</p>
            <details className="details">
              <summary>判断の根拠と、提案された対応</summary>
              <h4>AIの説明</h4>
              <p className="preserve-lines">{f.reasoning_summary}</p>
              <h4>確認・対応案</h4>
              <p className="preserve-lines">{f.suggested_action}</p>
              {f.current_law_verification_required && (
                <p className="small muted">対象年度の一次資料を確認する必要があります。</p>
              )}
            </details>
            <div className="actions">
              {f.affected_transaction_ids.map((id) => (
                <button
                  className="text-button"
                  key={id}
                  onClick={() => {
                    onClose();
                    openJournal(s.transactions.find((t) => t.id === id));
                  }}
                >
                  関連仕訳を開く
                  <ArrowUpRight size={15} />
                </button>
              ))}
              {f.suggested_draft_change && (
                <button
                  className="button secondary"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      const year = Number(f.suggested_draft_change!.transaction_date.slice(0, 4));
                      const id = await engine.write((st) => st.draftCorrection(f.id, year));
                      onClose();
                      openJournal(engine.snapshot.transactions.find((t) => t.id === id));
                    }, '修正案を下書きに保存しました')
                  }
                >
                  修正案から下書き作成
                </button>
              )}
            </div>
          </>
        ) : (
          <>
            <p className="small muted">元の相談</p>
            <p>{a.question}</p>
            {a.summary && <div className="ai-message preserve-lines">{a.summary}</div>}
          </>
        )}
        <div className="thread-divider">
          <MessageCircle size={17} />
          <span>回答と追加の相談</span>
        </div>
        <div className="conversation" aria-live="polite">
          {messages.length ? (
            messages.map((m) => (
              <div className={`message message-${m.role}`} key={m.id}>
                <span className="message-role">
                  {m.role === 'user' ? 'あなたの回答' : 'AIからの回答（取込済み）'}
                  <small>{m.created_at.slice(0, 16).replace('T', ' ')}</small>
                </span>
                <p className="preserve-lines">{m.content}</p>
                {m.role === 'user' && !s.messages.some((x) => x.reply_to === m.id) && (
                  <span className="small muted">次の対話パックに含まれます</span>
                )}
              </div>
            ))
          ) : (
            <div className="thread-empty">
              事実の補足、指摘への回答、別の見方や追加の疑問を残せます。
            </div>
          )}
        </div>
        <Field label="AIへの回答・追加質問">
          <textarea
            value={reply}
            maxLength={20000}
            rows={4}
            onChange={(e) => setReply(e.target.value)}
            placeholder="例：実際には週5日この部屋で仕事をしており、利用時間の記録もあります。この事実で判断は変わりますか？"
          />
        </Field>
        <div className="actions">
          <button
            className="button"
            disabled={!reply.trim() || busy}
            onClick={() =>
              void run(async () => {
                await engine.write((st) => st.addMessage(a.id, f?.id || null, reply));
                setReply('');
              }, '回答を保存しました。対話パックを書き出してChatGPTに渡せます')
            }
          >
            <Send size={16} />
            回答を保存
          </button>
          <button className="button secondary" disabled={busy} onClick={exportDialogue}>
            <Download size={16} />
            対話パックを確認
          </button>
          <FileButton
            disabled={busy}
            onFile={(files) =>
              void run(async () => {
                const value = JSON.parse(await files[0].text());
                if (value.audit_id !== a.id) throw new Error('この相談への回答ではありません');
                await engine.write((st) => st.importReplies(value), '追加回答取込前');
              }, '追加回答を取り込みました')
            }
          >
            追加回答を取り込む
          </FileButton>
        </div>
        {packPreview && (
          <div className="notice-block">
            <h4>今回書き出す内容</h4>
            <p className="small">事業情報、対象の帳簿、前回の指摘、保存済みの対話を含みます。</p>
            <details className="details">
              <summary>会話履歴とデータを確認</summary>
              {Object.entries(packPreview).map(([name, value]) => (
                <details key={name}>
                  <summary>{name}</summary>
                  <pre className="json-preview">
                    {typeof value === 'string' ? value : 'バイナリ'}
                  </pre>
                </details>
              ))}
            </details>
            <button
              className="button secondary"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  download(`aoiro_dialogue_${a.id.slice(0, 8)}.zip`, await zipFiles(packPreview));
                  setPackPreview(null);
                }, '対話パックを保存しました')
              }
            >
              確認してZIPを保存
            </button>
          </div>
        )}
        {requested.length > 0 && (
          <div className="notice-block">
            <h4>AIが追加確認を求めている原本 {requested.length}件</h4>
            <button className="text-button" onClick={() => setOriginals(!originals)}>
              原本を選んで追加提示する
            </button>
            {originals && (
              <>
                <div className="checkbox-list">
                  {s.evidences
                    .filter((e) => requested.includes(e.id))
                    .map((e) => (
                      <label key={e.id}>
                        <input
                          type="checkbox"
                          checked={selectedEvidence.includes(e.id)}
                          onChange={(event) =>
                            setSelectedEvidence(
                              event.target.checked
                                ? [...selectedEvidence, e.id]
                                : selectedEvidence.filter((id) => id !== e.id),
                            )
                          }
                        />
                        {e.filename}
                        <Badge value={e.status} />
                      </label>
                    ))}
                </div>
                <button
                  className="button secondary"
                  disabled={busy || !selectedEvidence.length}
                  onClick={() =>
                    void run(
                      async () =>
                        download(
                          `aoiro_evidence_followup_${a.id.slice(0, 8)}.zip`,
                          await buildEvidencePack(
                            s.evidences.filter((e) => selectedEvidence.includes(e.id)),
                            drive,
                            a,
                          ),
                        ),
                      '追加原本のパックを保存しました',
                    )
                  }
                >
                  選択した原本だけを書き出す
                </button>
              </>
            )}
          </div>
        )}
        {f && (
          <details className="details">
            <summary>指摘の状態・解決メモ</summary>
            <div className="form-grid">
              <Field label="対応状況">
                <select
                  value={f.status}
                  onChange={(e) =>
                    void run(() =>
                      engine.write((st) => st.updateFinding(f.id, e.target.value, note)),
                    )
                  }
                >
                  {findingStatuses.map((status) => (
                    <option value={status} key={status}>
                      {labels[status]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="確認・解決メモ">
                <textarea value={note} onChange={(e) => setNote(e.target.value)} />
              </Field>
            </div>
            <button
              className="button secondary"
              onClick={() =>
                void run(
                  () => engine.write((st) => st.updateFinding(f.id, f.status, note)),
                  'メモを保存しました',
                )
              }
            >
              メモを保存
            </button>
          </details>
        )}
      </div>
    </Modal>
  );
}
