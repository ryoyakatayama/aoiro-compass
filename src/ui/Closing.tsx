import { useState } from 'react';
import { LockKeyhole, Unlock, Download, CheckCircle2, AlertCircle, ArrowRight } from 'lucide-react';
import { useApp } from './context';
import { PageHeading, Card, Badge, Field, Modal } from './shared';
import { closingChecks } from '../domain/accounting';
import { yearArchive } from '../lib/packs';
import { download, demoMode } from '../lib/persistence';
import { OwnerSettlement } from './ReceiptReview';
import { filingCompletion } from '../domain/filing-documents';
export default function Closing() {
  const { s, year, engine, drive, run, busy, navigate } = useApp();
  const fiscal = s.years.find((y) => y.year === year)!;
  const checks = closingChecks(s, year);
  const fatal = checks.filter((c) => c.fatal).reduce((n, c) => n + c.count, 0),
    warn = checks.filter((c) => !c.fatal).reduce((n, c) => n + c.count, 0);
  const [confirm, setConfirm] = useState(false),
    [word, setWord] = useState(''),
    [reason, setReason] = useState('');
  const cloud = !demoMode;
  const archive = async (close: boolean) => {
    let folder = '';
    if (cloud) {
      if (!drive.connected) throw new Error('先に設定画面でDriveへ接続してください');
      folder = s.settings[`drive_backup_${year}`] || (await drive.ensureFolders(year)).backup;
    }
    const backup = await engine.backup(close ? '年度ロック前' : '年度帳簿書出し');
    const pack = await yearArchive(backup.snapshot, year, backup.bytes);
    let driveId = '';
    if (cloud)
      driveId = (await drive.upload(`${year}_aoiro_archive_${backup.id}.zip`, pack, folder)).id;
    download(`${year}_aoiro_archive.zip`, pack);
    if (close) {
      await engine.write((st) => {
        if ((st.setting('revision') || '0') !== (backup.snapshot.settings.revision || '0'))
          throw new Error('出力中に帳簿が更新されました。もう一度確認して締めてください');
        st.closeYear(year, driveId || `local:${backup.id}`);
      });
      setConfirm(false);
      setWord('');
    }
  };
  return (
    <>
      <PageHeading
        eyebrow="YEAR END"
        title="一年を、確かに締めくくる。"
        description="未処理を確認し、帳簿とバックアップを保存してから年度をロックします。"
        actions={<Badge value={fiscal.status} />}
      />
      <div className="closing-overview">
        <div className={`closing-icon ${fatal ? 'has-errors' : ''}`}>
          {fatal ? <AlertCircle size={34} /> : <CheckCircle2 size={34} />}
        </div>
        <div>
          <h2>
            {fiscal.status === 'active'
              ? fatal
                ? `締める前に、${fatal}件の対応が必要です。`
                : '帳簿の必須チェックを通過しました。'
              : `${year}年は${fiscal.status === 'closed' ? '締め済み' : '過年度の閲覧専用'}です。`}
          </h2>
          <p>
            {warn
              ? `ほかに${warn}件の確認候補があります。内容を確認して判断できます。`
              : '確認項目をチェックし、保存方法を選んでください。'}
          </p>
        </div>
      </div>
      <Card
        title="帳簿・証憑の最終チェック"
        subtitle="AI監査は任意です。未実施でも年度を締められます。"
      >
        <p>
          申告書・控除資料・他の所得・e-Taxの送信状況は「確定申告の準備」で別途確認します。年度のロックだけでは申告は完了しません。
        </p>
        <p className="notice">
          申告後の保存資料：{filingCompletion(s, year).filter((r) => r.complete).length}/
          {filingCompletion(s, year).length}
          項目を確認。未確認の資料は年度ロック後も「確定申告の準備」から追加できます。
        </p>
        <button className="button secondary" onClick={() => navigate('filing')}>
          確定申告の準備を確認
        </button>
        <div className="closing-checks">
          {checks.map((c) => (
            <div className="closing-check" key={c.label}>
              <span className={c.count ? (c.fatal ? 'check-error' : 'check-warning') : 'check-ok'}>
                {c.count ? <AlertCircle size={19} /> : <CheckCircle2 size={19} />}
              </span>
              <span>{c.label}</span>
              <span className="small muted">{c.fatal ? '締め前に解消' : '確認候補'}</span>
              <strong>{c.count}件</strong>
            </div>
          ))}
        </div>
        <div className="actions">
          <button className="text-button" onClick={() => navigate('ledger')}>
            仕訳を確認
            <ArrowRight size={15} />
          </button>
          <button className="text-button" onClick={() => navigate('evidence')}>
            原本を確認
            <ArrowRight size={15} />
          </button>
          <button className="text-button" onClick={() => navigate('consult')}>
            AIに相談する
            <ArrowRight size={15} />
          </button>
        </div>
      </Card>
      <OwnerSettlement />
      <Card title="帳簿とバックアップの保存">
        <p>
          仕訳帳・試算表CSV、P/L・B/S
          JSON、固定資産・償却、証憑索引、相談履歴、全年度のSQLite、SHA-256チェックサムをZIPにまとめます。PDFは帳簿画面の印刷から保存できます。
        </p>
        <p>Google Driveの年度バックアップフォルダに保存し、手元にもコピーを書き出します。</p>
        <div className="actions spaced">
          <button
            className="button secondary"
            disabled={busy}
            onClick={() => void run(() => archive(false), '年度パッケージを保存しました')}
          >
            <Download size={16} />
            年度パッケージを書き出す
          </button>
          {fiscal.status === 'active' && (
            <button
              className="button"
              disabled={busy || fatal > 0}
              onClick={() => setConfirm(true)}
            >
              <LockKeyhole size={17} />
              保存して年度を締める
            </button>
          )}
        </div>
        <p className="small muted">
          年度締めにはGoogle
          Driveへの接続と保存完了が必要です。原本そのものはDriveの保存場所に残ります。デモのみ端末への書き出しで動作を試せます。
        </p>
      </Card>
      {fiscal.status === 'closed' && (
        <Card title="明示的なロック解除">
          <Field label="解除理由">
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="修正する内容・理由を記録します"
            />
          </Field>
          <button
            className="button secondary"
            disabled={busy || !reason.trim()}
            onClick={() =>
              void run(
                () => engine.write((st) => st.unlockYear(year, reason), '年度ロック解除前'),
                '年度ロックを解除しました',
              )
            }
          >
            <Unlock size={16} />
            理由を記録してロック解除
          </button>
        </Card>
      )}
      <Card title="翌年度の期首残高">
        <p>
          前年度の確定残高を、翌年度の期首仕訳の下書きに引き継ぎます。事業利益・事業主貸・事業主借を元入金に反映します。資産台帳は同じ資産IDのまま翌年度でも参照できます。
        </p>
        <button
          className="button secondary"
          disabled={busy || fiscal.status === 'active'}
          onClick={() =>
            void run(async () => {
              await engine.write((st) => {
                if (!st.snapshot().years.some((y) => y.year === year + 1)) st.addYear(year + 1);
                st.carryForward(year, year + 1);
              }, '期首繰越前');
            }, '翌年度の期首残高を下書きに作成しました。仕訳画面で確認・確定してください')
          }
        >
          {year + 1}年へ繰り越す
          <ArrowRight size={16} />
        </button>
      </Card>
      {confirm && (
        <Modal title={`${year}年を締める`} onClose={() => setConfirm(false)}>
          <div className="modal-body">
            <p>
              帳簿のバックアップとZIPを保存し、{year}年の通常編集をロックします。
              {warn > 0 ? `確認候補${warn}件は内容を確認したうえで進めてください。` : ''}
            </p>
            <Field label={`確認のため「${year}」と入力`}>
              <input value={word} onChange={(e) => setWord(e.target.value)} />
            </Field>
          </div>
          <div className="modal-footer">
            <button
              className="button"
              disabled={busy || word !== String(year)}
              onClick={() => void run(() => archive(true), '年度を締めました')}
            >
              <LockKeyhole size={17} />
              保存して年度ロック
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
