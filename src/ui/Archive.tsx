import { useState } from 'react';
import { ExternalLink, Download } from 'lucide-react';
import { useApp } from './context';
import { Card, PageHeading, FileButton, Field, Empty } from './shared';
import {
  archiveSchema,
  archiveSetting,
  archiveResponsePrefix,
  archiveResponseSchema,
  type Archive,
} from '../domain/archive';
import { bookKind } from '../lib/book';
import { download } from '../lib/persistence';

export default function ArchivePage() {
  const { s, engine, run, busy } = useApp();
  const parsed = archiveSchema.safeParse(JSON.parse(s.settings[archiveSetting] || 'null'));
  const archive = parsed.success ? parsed.data : null;
  const [preview, setPreview] = useState<Archive | null>(null);
  const [query, setQuery] = useState('');
  const [year, setYear] = useState('all');
  const [tab, setTab] = useState('documents');
  const [limit, setLimit] = useState(50);
  const years = [...new Set(archive?.documents.map((d) => d.year))].sort();
  const matches = (x: { year: number; book: string }) =>
    (year === 'all' || String(x.year) === year) && (x.book === bookKind || x.book === 'common');
  const docs =
    archive?.documents.filter(
      (d) =>
        matches(d) &&
        `${d.name} ${d.original_path} ${d.category} ${d.text} ${d.note}`
          .toLocaleLowerCase()
          .replace(/\s/g, '')
          .includes(query.toLocaleLowerCase().replace(/\s/g, '')),
    ) || [];
  const issues = archive?.issues.filter(matches) || [];
  return (
    <>
      <PageHeading
        eyebrow="SOURCE ARCHIVE"
        title="過年度資料と、確認の記録。"
        description="原本・集計・申告書をたどり、差額や未確定の日付を一つずつ確認できます。"
      />
      <Card title="資料台帳">
        <div className="form-actions">
          <FileButton
            accept=".json"
            disabled={busy}
            onFile={(files) =>
              void run(async () => {
                if (files[0].size > 20 * 1024 * 1024)
                  throw new Error('台帳は20MB以下にしてください');
                setPreview(archiveSchema.parse(JSON.parse(await files[0].text())));
              })
            }
          >
            資料台帳JSONを選ぶ
          </FileButton>
          {archive && (
            <a
              className="button secondary"
              href={archive.folder_url}
              target="_blank"
              rel="noreferrer"
            >
              <ExternalLink size={16} />
              Driveで原本を開く
            </a>
          )}
          {archive && (
            <button
              className="button secondary"
              onClick={() =>
                download(
                  '資料の確認記録.json',
                  JSON.stringify(
                    {
                      archive,
                      responses: Object.fromEntries(
                        Object.entries(s.settings).filter(([key]) =>
                          key.startsWith(archiveResponsePrefix),
                        ),
                      ),
                    },
                    null,
                    2,
                  ),
                  'application/json',
                )
              }
            >
              <Download size={16} />
              確認記録を書き出す
            </button>
          )}
        </div>
        <p className="small muted">
          台帳と回答は端末に保存され、帳簿のGoogle
          Drive同期に含まれます。原本の閲覧にはGoogleのログインが必要です。資料の取り込みでは仕訳を作成しません。
        </p>
        {preview && (
          <div className="notice">
            <strong>{preview.title}</strong>
            <p>
              資料 {preview.documents.length}件 / 確認事項 {preview.issues.length}件。
              {archive
                ? '現在の資料台帳を置き換えます。同じIDへの回答は保持します。'
                : '現在の帳簿に台帳を登録します。'}
            </p>
            <button
              className="button"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await engine.write((st) => {
                    st.setSetting(archiveSetting, JSON.stringify(preview));
                    st.event('source_archive_imported', '', {
                      documents: preview.documents.length,
                    });
                  });
                  setPreview(null);
                }, '資料台帳を登録しました')
              }
            >
              この台帳を登録
            </button>{' '}
            <button className="button secondary" onClick={() => setPreview(null)}>
              キャンセル
            </button>
          </div>
        )}
      </Card>
      {!archive ? (
        <Empty title="資料台帳を登録してください">
          整理した過年度資料のJSONを選ぶと、スマホからも原本の検索や確認事項への回答ができます。
        </Empty>
      ) : (
        <>
          <div className="tabs">
            <button
              className={tab === 'documents' ? 'active' : ''}
              onClick={() => setTab('documents')}
            >
              資料を探す
            </button>
            <button className={tab === 'issues' ? 'active' : ''} onClick={() => setTab('issues')}>
              確認事項（{issues.length}）
            </button>
          </div>
          <Card title={archive.title}>
            <Field label="資料の年度">
              <select
                value={year}
                onChange={(e) => {
                  setYear(e.target.value);
                  setLimit(50);
                }}
              >
                <option value="all">すべての年度</option>
                {years.map((y) => (
                  <option key={y}>{y}</option>
                ))}
              </select>
            </Field>
            {tab === 'documents' ? (
              <>
                <Field label="資料名・元の場所・読み取り文字で検索">
                  <input
                    value={query}
                    onChange={(e) => {
                      setQuery(e.target.value);
                      setLimit(50);
                    }}
                    placeholder="領収書、交通費、店名など"
                  />
                </Field>
                <p className="small muted">
                  {docs.length}件。読み取り文字は検索用です。金額や日付は原本で確認してください。
                </p>
                {docs.slice(0, limit).map((d) => (
                  <details key={d.id} className="archive-document">
                    <summary>
                      {d.year}年 · {d.name}
                    </summary>
                    <p className="small muted">
                      {d.category} / 元の場所：{d.original_path}
                    </p>
                    <p>{d.note}</p>
                    <a href={d.drive_url} target="_blank" rel="noreferrer">
                      Google Driveで原本を見る ↗
                    </a>
                    {d.text && (
                      <details>
                        <summary>読み取り文字（未確認）</summary>
                        <pre className="archive-text">{d.text}</pre>
                      </details>
                    )}
                  </details>
                ))}
                {docs.length > limit && (
                  <button className="button secondary" onClick={() => setLimit(limit + 50)}>
                    続きを表示
                  </button>
                )}
              </>
            ) : issues.length ? (
              issues.map((issue) => <Issue key={issue.id} issue={issue} archive={archive} />)
            ) : (
              <Empty title="この条件の確認事項はありません" />
            )}
          </Card>
        </>
      )}
    </>
  );
}
function Issue({ issue, archive }: { issue: Archive['issues'][number]; archive: Archive }) {
  const { s, engine, run, busy } = useApp();
  const key = archiveResponsePrefix + issue.id;
  const saved = archiveResponseSchema.parse(
    JSON.parse(s.settings[key] || '{"status":"open","note":""}'),
  );
  const [draft, setDraft] = useState<typeof saved | null>(null);
  const value = draft || saved;
  return (
    <section className="archive-document">
      <h3>
        {issue.year}年 · {issue.title}
      </h3>
      <p className="archive-text">{issue.detail}</p>
      <p>
        {issue.source_ids.map((id) => {
          const d = archive.documents.find((x) => x.id === id)!;
          return (
            <a key={id} href={d.drive_url} target="_blank" rel="noreferrer">
              {d.name} ↗　
            </a>
          );
        })}
      </p>
      <Field label="確認状況">
        <select
          value={value.status}
          onChange={(e) => setDraft({ ...value, status: e.target.value as typeof value.status })}
        >
          <option value="open">未確認</option>
          <option value="reviewing">確認中</option>
          <option value="resolved">確認済み</option>
        </select>
      </Field>
      <Field label="回答・判断の根拠">
        <textarea
          rows={3}
          maxLength={10000}
          value={value.note}
          onChange={(e) => setDraft({ ...value, note: e.target.value })}
          placeholder="確認した内容や、税務相談で聞きたいことを記録"
        />
      </Field>
      <button
        className="button secondary"
        disabled={busy || !draft}
        onClick={() =>
          void run(async () => {
            await engine.write((st) =>
              st.setSetting(key, JSON.stringify(archiveResponseSchema.parse(value))),
            );
            setDraft(null);
          }, '確認記録を保存しました')
        }
      >
        回答を保存
      </button>
    </section>
  );
}
