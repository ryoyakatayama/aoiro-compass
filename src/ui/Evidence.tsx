import { useEffect, useRef, useState } from 'react';
import {
  Camera,
  Upload,
  FileText,
  RefreshCw,
  ExternalLink,
  Sparkles,
  Download,
  Check,
} from 'lucide-react';
import { useApp } from './context';
import { PageHeading, Card, Empty, Badge, FileButton, Modal, Field } from './shared';
import { bookKind, switchBook, bookLabel } from '../lib/book';
import { captureFiles } from '../lib/drive';
import { getBlob, download } from '../lib/persistence';
import { buildEvidencePack } from '../lib/packs';
import type { Evidence as EvidenceRecord } from '../domain/model';
import ReceiptReviewButton from './ReceiptReview';
export default function Evidence() {
  const { s, year, engine, drive, run, busy, openJournal, sync } = useApp();
  const [selected, setSelected] = useState<string[]>([]),
    [detail, setDetail] = useState<EvidenceRecord | null>(null),
    [pack, setPack] = useState(false),
    [filter, setFilter] = useState('all'),
    [hint, setHint] = useState(''),
    [payment, setPayment] = useState('3100');
  const camera = useRef<HTMLInputElement>(null);
  const ev = s.evidences.filter(
    (e) => e.year === year && (filter === 'all' || e.status === filter),
  );
  const locked = s.years.find((y) => y.year === year)?.status !== 'active';
  const intake = (files: File[], source = 'local_import') =>
    void run(async () => {
      const n = await captureFiles(engine, files, year, hint, payment, source);
      return n;
    }, '原本をこの端末に保存しました。Drive同期でアップロードできます');
  return (
    <>
      <PageHeading
        eyebrow="EVIDENCE LIBRARY"
        title="原本から、記帳へ。"
        description="撮影前に取込先の所得区分を選択できます。事業所得・雑所得は別々の台帳に保存します。"
        actions={
          <>
            <button className="button secondary" disabled={busy} onClick={() => void sync()}>
              <RefreshCw size={16} />
              Drive同期
            </button>
            <button className="button" disabled={locked} onClick={() => camera.current?.click()}>
              <Camera size={17} />
              撮影する
            </button>
          </>
        }
      />
      <input
        hidden
        ref={camera}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={(e) => {
          if (e.target.files?.length) intake(Array.from(e.target.files), 'app_camera');
          e.target.value = '';
        }}
      />
      <div className="intake-book">
        <strong>現在の取込先：{bookLabel}</strong>
        <span>原本・仕訳・経費をこの帳簿に保存します</span>
      </div>
      <div className="upload-zone">
        <div className="upload-symbol">
          <Upload size={29} />
        </div>
        <div>
          <h3>領収書や請求書を、まとめて追加</h3>
          <p>PDF / JPEG / PNG / WebP / HEIC · 1ファイル25MBまで · オフラインでも保存できます</p>
        </div>
        <FileButton
          accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.heif"
          multiple
          disabled={locked || busy}
          onFile={(files) => intake(files)}
        >
          ファイルを選ぶ
        </FileButton>
      </div>
      <div className="capture-hints">
        <Field label="取込先（所得区分）">
          <select
            aria-label="領収書の取込先"
            value={bookKind}
            onChange={(e) => switchBook(e.target.value as 'business' | 'misc')}
          >
            <option value="business">事業所得・青色申告</option>
            <option value="misc">雑所得</option>
          </select>
        </Field>
        <Field label="科目のヒント">
          <select value={hint} onChange={(e) => setHint(e.target.value)}>
            <option value="">未指定</option>
            {s.accounts
              .filter((a) => ['expense', 'revenue', 'asset'].includes(a.type))
              .map((a) => (
                <option key={a.id} value={a.name}>
                  {a.name}
                </option>
              ))}
          </select>
        </Field>
        <Field label="支払元・入金先のヒント">
          <select value={payment} onChange={(e) => setPayment(e.target.value)}>
            {s.accounts
              .filter((a) => ['1000', '1010', '3100', '2100', '1100'].includes(a.id))
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
          </select>
        </Field>
        <p className="small muted">
          追加時に添えるメモです。正式な科目は仕訳の確認時に決められます。
        </p>
      </div>
      <Card>
        <div className="filterbar">
          <select
            aria-label="証憑の状態"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            <option value="all">すべての証憑</option>
            <option value="indexed">未処理</option>
            <option value="queued">アップロード待ち</option>
            <option value="ai_imported">AI確認待ち</option>
            <option value="duplicate">重複候補</option>
            <option value="modified">原本変更あり</option>
            <option value="missing">原本欠落</option>
          </select>
          <span className="small muted">
            {ev.length}件 / {selected.length}件選択
          </span>
          <div className="push-right actions">
            <ReceiptReviewButton />
            <button
              className="button secondary"
              disabled={!selected.length || busy}
              onClick={() => setPack(true)}
            >
              <Sparkles size={16} />
              AI読取パック
            </button>
            <FileButton
              disabled={locked || busy}
              accept=".jsonl,.json,.txt"
              onFile={(files) =>
                void run(async () => {
                  const text = await files[0].text();
                  return engine.write((st) => st.importExtractions(text), 'AI読取取込前');
                }, 'AIの読取候補を取り込みました')
              }
            >
              AI読取結果を取り込む
            </FileButton>
          </div>
        </div>
        {ev.length ? (
          <div className="evidence-grid">
            {ev.map((e) => {
              const linked = s.transactions.filter((t) => t.evidence_ids.includes(e.id));
              const x = s.extractions.find((x) => x.evidence_id === e.id);
              return (
                <article
                  className={`evidence-card ${selected.includes(e.id) ? 'is-selected' : ''}`}
                  key={e.id}
                >
                  <div className="evidence-preview">
                    <input
                      aria-label={`${e.filename}を選択`}
                      type="checkbox"
                      checked={selected.includes(e.id)}
                      onChange={(event) =>
                        setSelected(
                          event.target.checked
                            ? [...selected, e.id]
                            : selected.filter((id) => id !== e.id),
                        )
                      }
                    />
                    <FileText size={42} />
                    <span>{e.mime_type.split('/')[1]?.toUpperCase()}</span>
                    <button
                      className="evidence-open"
                      onClick={() => setDetail(e)}
                      aria-label={`${e.filename}の詳細`}
                    />
                  </div>
                  <div className="evidence-content">
                    <button className="plain-link evidence-name" onClick={() => setDetail(e)}>
                      {e.filename}
                    </button>
                    <p className="small muted">
                      {Math.round(e.size_bytes / 1024)} KB ·{' '}
                      {e.drive_file_id ? 'Drive保存済み' : 'この端末に保存'}
                    </p>
                    <Badge value={e.status} />
                    <p className="small">
                      {linked.length
                        ? `関連する仕訳 ${linked.length}件`
                        : x
                          ? `AI候補：${x.vendor} / ${x.gross_amount.toLocaleString()}円`
                          : '仕訳はまだありません'}
                    </p>
                    {x && x.status === 'pending' && !locked && (
                      <button
                        className="text-button"
                        onClick={() =>
                          void run(async () => {
                            const id = await engine.write((st) => st.draftFromExtraction(x.id));
                            openJournal(engine.snapshot.transactions.find((t) => t.id === id));
                          })
                        }
                      >
                        候補を確認して下書きへ
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <Empty title="証憑を集めるところから、はじめましょう。">
            領収書を撮影するか、保存済みのファイルを追加できます。
          </Empty>
        )}
      </Card>
      {pack && (
        <Modal title="AIへ渡す原本を確認" onClose={() => setPack(false)}>
          <div className="modal-body">
            <p>
              選択した原本と読取用の指示・スキーマをZIPにまとめます。内容を確認してからChatGPTへ添付してください。
            </p>
            <ul className="file-list">
              {s.evidences
                .filter((e) => selected.includes(e.id))
                .map((e) => (
                  <li key={e.id}>
                    <FileText size={16} />
                    {e.filename}
                  </li>
                ))}
            </ul>
            <p className="small muted">この操作ではChatGPTへ自動送信しません。</p>
          </div>
          <div className="modal-footer">
            <button
              className="button"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const zip = await buildEvidencePack(
                    s.evidences.filter((e) => selected.includes(e.id)),
                    drive,
                  );
                  download(`aoiro_read_${year}.zip`, zip);
                  setPack(false);
                }, '読取パックを保存しました')
              }
            >
              <Download size={17} />
              選択した原本を書き出す
            </button>
          </div>
        </Modal>
      )}
      {detail && (
        <EvidenceDetail
          evidence={s.evidences.find((e) => e.id === detail.id) || detail}
          onClose={() => setDetail(null)}
        />
      )}
    </>
  );
}
function EvidenceDetail({
  evidence: e,
  onClose,
}: {
  evidence: EvidenceRecord;
  onClose: () => void;
}) {
  const { s, engine, drive, run, openJournal, busy } = useApp();
  const [url, setUrl] = useState(''),
    [note, setNote] = useState(e.note);
  useEffect(() => {
    let active = true,
      objectUrl = '';
    void getBlob(e.id).then((blob) => {
      if (blob && active) {
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      }
    });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [e.id]);
  const extraction = s.extractions.filter((x) => x.evidence_id === e.id);
  return (
    <Modal title="証憑の詳細" wide onClose={onClose}>
      <div className="modal-body">
        <h3>{e.filename}</h3>
        <Badge value={e.status} />
        {url &&
          (e.mime_type.startsWith('image/') &&
          !['image/heic', 'image/heif'].includes(e.mime_type) ? (
            <img className="original-preview" src={url} alt={e.filename} />
          ) : e.mime_type === 'application/pdf' ? (
            <iframe className="pdf-preview" title="PDF原本" src={url} />
          ) : (
            <p>この形式はブラウザ内プレビューに対応していません。</p>
          ))}
        <dl className="metadata">
          <dt>証憑ID</dt>
          <dd className="mono">{e.id}</dd>
          <dt>Drive ID</dt>
          <dd>{e.drive_file_id || 'アップロード待ち'}</dd>
          <dt>原本SHA-256</dt>
          <dd className="mono break-all">{e.original_sha256}</dd>
          <dt>現在のSHA-256</dt>
          <dd className="mono break-all">{e.sha256}</dd>
          <dt>取込時のヒント</dt>
          <dd>{e.hint || 'なし'}</dd>
        </dl>
        <div className="actions">
          {e.drive_file_id && (
            <a
              className="button secondary"
              href={`https://drive.google.com/file/d/${e.drive_file_id}/view`}
              target="_blank"
              rel="noreferrer"
            >
              <ExternalLink size={16} />
              Driveで原本を開く
            </a>
          )}
          <button
            className="button secondary"
            onClick={() =>
              void run(async () => {
                const blob =
                  (await getBlob(e.id)) ||
                  (e.drive_file_id ? await drive.download(e.drive_file_id) : null);
                if (!blob) throw new Error('原本を取得できません');
                download(e.filename, blob);
              })
            }
          >
            <Download size={16} />
            原本を保存
          </button>
        </div>
        {extraction.map((x) => (
          <div className="notice-block" key={x.id}>
            <h4>AI読取候補（人による確認前）</h4>
            <p>
              {x.transaction_date} · {x.vendor} · {x.gross_amount.toLocaleString()}円 ·{' '}
              {x.suggested_account}
            </p>
            <p className="small">
              信頼度 {Math.round(x.confidence * 100)}% {x.warnings.join(' / ')}
            </p>
            {x.transaction_id ? (
              <button
                className="text-button"
                onClick={() => {
                  onClose();
                  openJournal(s.transactions.find((t) => t.id === x.transaction_id));
                }}
              >
                関連する下書きを開く
              </button>
            ) : (
              <button
                className="button secondary"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const id = await engine.write((st) => st.draftFromExtraction(x.id));
                    onClose();
                    openJournal(engine.snapshot.transactions.find((t) => t.id === id));
                  })
                }
              >
                下書きを作って確認する
              </button>
            )}
          </div>
        ))}
        {s.transactions
          .filter((t) => t.evidence_ids.includes(e.id))
          .map((t) => (
            <button
              key={t.id}
              className="text-button"
              onClick={() => {
                onClose();
                openJournal(t);
              }}
            >
              関連仕訳：{t.description}
            </button>
          ))}
        <Field label="確認メモ">
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="変更・重複・対象外にした理由など"
          />
        </Field>
        <div className="actions">
          <button
            className="button secondary"
            disabled={busy || !note.trim()}
            onClick={() =>
              void run(
                () => engine.write((st) => st.acknowledgeEvidence(e.id, 'ignored', note)),
                '対象外として記録しました',
              )
            }
          >
            対象外にする
          </button>
          <button
            className="button secondary"
            disabled={busy || !note.trim() || e.status === 'missing'}
            onClick={() =>
              void run(
                () => engine.write((st) => st.acknowledgeEvidence(e.id, 'accept', note)),
                '確認を記録しました',
              )
            }
          >
            <Check size={16} />
            {e.status === 'modified' ? '変更後の原本を承認する' : 'メモを残して確認済みにする'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
