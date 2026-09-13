import { useState } from 'react';
import { Card, Field, Modal, FileButton } from './shared';
import { useApp } from './context';
import { newId, now } from '../domain/model';
import {
  archiveContext,
  filingCompletion,
  filingDocumentKey,
  filingDocumentSchema,
  filingDocumentKinds,
  type FilingDocument,
} from '../domain/filing-documents';
import { sha256 } from '../lib/persistence';
export default function FilingDocuments() {
  const { s, year, engine, drive, run, busy, navigate } = useApp();
  const rows = filingCompletion(s, year),
    sources = archiveContext(s, [year]).documents;
  const [edit, setEdit] = useState<FilingDocument | null>(null),
    [base, setBase] = useState<string>(),
    [url, setUrl] = useState(''),
    [file, setFile] = useState<File | null>(null),
    [checked, setChecked] = useState(false);
  const open = (kind: FilingDocument['kind'], value?: FilingDocument) => {
    setBase(value ? s.settings[filingDocumentKey(value)] : undefined);
    setEdit(
      value || {
        id: newId(),
        year,
        kind,
        status: 'pending',
        name: '',
        drive_id: '',
        sha256: '',
        size: 0,
        note: '',
        checked_at: '',
        updated: now(),
      },
    );
    setUrl(value?.drive_id ? `https://drive.google.com/file/d/${value.drive_id}/view` : '');
    setFile(null);
    setChecked(false);
  };
  const save = () =>
    void run(async () => {
      if (!edit) return;
      let value = { ...edit, updated: now() };
      if (value.status !== 'na') {
        if (!checked) throw new Error('ファイルの対象年・内容を確認してください');
        if (!drive.connected)
          throw new Error('Google Driveに接続してから保存・読み出し確認を行ってください');
        let id = '';
        if (file) {
          const folder = (await drive.ensureFolders(value.year)).filings;
          id = (await drive.upload(file.name, file, folder, `filing-${value.id}`)).id;
        } else {
          const parsed = new URL(url);
          if (parsed.protocol !== 'https:' || parsed.hostname !== 'drive.google.com')
            throw new Error('Google DriveのファイルURLを指定してください');
          id =
            parsed.pathname.match(/\/file\/d\/([a-zA-Z0-9_-]+)/)?.[1] ||
            parsed.searchParams.get('id') ||
            '';
          if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error('ファイルのURLを指定してください');
        }
        const meta = await drive.metadata(id);
        if (
          meta.trashed ||
          meta.mimeType === 'application/vnd.google-apps.folder' ||
          Number(meta.size) > 25 * 1024 * 1024 ||
          !Number.isFinite(Number(meta.size))
        )
          throw new Error('25MB以下の保存ファイルを指定してください');
        const downloaded = await drive.download(id);
        if (downloaded.size !== Number(meta.size))
          throw new Error('保存先ファイルのサイズが一致しません');
        const hash = await sha256(downloaded);
        if (file && hash !== (await sha256(file)))
          throw new Error('保存前後のファイルが一致しません');
        value = {
          ...value,
          status: 'verified',
          drive_id: id,
          name: meta.name,
          sha256: hash,
          size: downloaded.size,
          checked_at: now(),
        };
      } else value = { ...value, name: '', drive_id: '', sha256: '', size: 0, checked_at: '' };
      const valid = filingDocumentSchema.parse(value),
        key = filingDocumentKey(valid);
      await engine.write((st) => {
        if ((st.setting(key) || undefined) !== base)
          throw new Error('保存記録が変更されています。開き直してください');
        st.setSetting(key, JSON.stringify(valid));
        st.event('filing_document_checked', valid.id);
      });
      setEdit(null);
    }, '申告後の保存記録を更新しました');
  return (
    <Card
      title="申告後のファイルを揃える"
      subtitle={`${year}年 · ${rows.filter((r) => r.complete).length}/${rows.length}項目を確認。送信した版・受付結果・納付をそれぞれ確認します。`}
    >
      <ol>
        <li>作成コーナーで送信した申告書・決算書PDF、保存データ、送信票をダウンロード。</li>
        <li>e-Taxの受信通知で受付結果を確認し、控えを保存。別途提出と納付・還付も確認。</li>
        <li>下の項目へファイルを保存、または既存Driveファイルを登録して読み出し確認。</li>
        <li>両所得の帳簿をDrive同期し、年度パッケージを保存。原本・電子取引データも継続保存。</li>
      </ol>
      <p className="small muted">
        申告書は本人全体で1件です。同じ控えを事業・雑所得で参照できます。「該当なし」は任意項目に理由を記録した場合だけ使えます。保存状況は法定の保存要件をすべて判定するものではありません。
      </p>
      {rows.map((r) => (
        <section className="filing-item" key={r.id}>
          <div>
            <strong>
              {r.label} · {r.complete ? '保存確認済み' : '未確認'}
            </strong>
            <p>{r.description}</p>
            {r.documents.map((d) => (
              <div key={d.id} className="filing-document-link">
                {d.drive_id && (
                  <a
                    href={`https://drive.google.com/file/d/${d.drive_id}/view`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {d.name}
                  </a>
                )}
                <span>
                  {d.status === 'na'
                    ? '該当なし'
                    : d.checked_at
                      ? `読み出し確認 ${d.checked_at.slice(0, 10)}`
                      : '未確認'}{' '}
                  / {d.note}
                </span>
                <button className="text-button" onClick={() => open(r.id, d)}>
                  記録を開く・再確認
                </button>
              </div>
            ))}
          </div>
          <button className="button secondary compact" onClick={() => open(r.id)}>
            ファイルを登録
          </button>
        </section>
      ))}
      <p className="notice">
        {rows.every((r) => r.complete)
          ? '申告後の保存項目が揃いました。両帳簿の最新のDrive同期・原本・バックアップも確認してください。'
          : '未確認の保存項目が残っています。年度をロックしても、この不足は解消されません。'}
      </p>
      <button className="text-button" onClick={() => navigate('closing')}>
        年度パッケージの保存へ
      </button>
      {edit && (
        <Modal
          title={`${edit.year}年・${filingDocumentKinds.find((k) => k.id === edit.kind)!.label}`}
          wide
          onClose={() => setEdit(null)}
        >
          <div className="modal-body">
            {filingDocumentKinds.find((k) => k.id === edit.kind)!.optional && (
              <label>
                <input
                  type="checkbox"
                  checked={edit.status === 'na'}
                  onChange={(e) =>
                    setEdit({ ...edit, status: e.target.checked ? 'na' : 'pending' })
                  }
                />
                該当なし（理由を記録）
              </label>
            )}
            {edit.status !== 'na' && (
              <>
                <FileButton
                  accept=".pdf,.data,.xtx,.xml,.zip,.csv,.txt,.xlsx"
                  onFile={(f) => {
                    setFile(f[0]);
                    setChecked(false);
                  }}
                  disabled={busy}
                >
                  ファイルを選んでDriveへ保存
                </FileButton>
                {file ? (
                  <p>
                    {file.name}
                    <button className="text-button" onClick={() => setFile(null)}>
                      選択を解除
                    </button>
                  </p>
                ) : (
                  <>
                    <Field label="既存のGoogle DriveファイルURL">
                      <input
                        value={url}
                        onChange={(e) => {
                          setUrl(e.target.value);
                          setChecked(false);
                        }}
                      />
                    </Field>
                    <Field label="過年度資料台帳から選択">
                      <select
                        value=""
                        onChange={(e) => {
                          setUrl(e.target.value);
                          setChecked(false);
                        }}
                      >
                        <option value="">資料を選ぶ（内容は未確認）</option>
                        {sources.map((d) => (
                          <option key={d.id} value={d.drive_url}>
                            {d.name}
                          </option>
                        ))}
                      </select>
                    </Field>
                  </>
                )}
                <label>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => setChecked(e.target.checked)}
                  />
                  対象年度・本人・送信した版と内容を確認しました
                </label>
              </>
            )}
            <Field label="確認内容・該当なしの理由">
              <textarea
                rows={3}
                value={edit.note}
                onChange={(e) => setEdit({ ...edit, note: e.target.value })}
                placeholder="受付結果、追加提出の有無、納付日、資料一覧など"
              />
            </Field>
            <p className="small muted">
              ファイルの読み出しとハッシュを確認してから記録します。内容の正しさは上のチェックとメモで残してください。
            </p>
          </div>
          <div className="modal-footer">
            <button
              className="button"
              disabled={busy || !edit.note.trim() || (edit.status !== 'na' && !checked)}
              onClick={save}
            >
              保存・読み出しを確認して登録
            </button>
          </div>
        </Modal>
      )}
    </Card>
  );
}
