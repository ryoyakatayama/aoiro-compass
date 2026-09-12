import { Engine, getBlob, putBlob, sha256, demoMode } from './persistence';
import { isMisc } from './book';
import { newId, now, type Evidence } from '../domain/model';
export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  modifiedTime?: string;
  trashed?: boolean;
  parents?: string[];
  appProperties?: Record<string, string>;
}
const FIELDS = 'id,name,mimeType,size,modifiedTime,trashed,parents,appProperties';
const folderMime = 'application/vnd.google-apps.folder';
export const acceptedMimes = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
];
function supported(f: DriveFile) {
  return acceptedMimes.includes(f.mimeType);
}
function quote(s: string) {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}
export class DriveAdapter {
  private token = '';
  private expires = 0;
  private loading: Promise<void> | undefined;
  constructor(private engine: Engine) {}
  get connected() {
    return !!this.token && Date.now() < this.expires;
  }
  async connect(clientId: string) {
    if (demoMode) throw new Error('デモではDriveへの接続を行いません');
    if (!clientId.endsWith('.apps.googleusercontent.com'))
      throw new Error('Google OAuthのClient IDを設定してください');
    if (!(window as any).google?.accounts?.oauth2) {
      this.loading ??= new Promise<void>((resolve, reject) => {
        const el = document.createElement('script');
        el.src = 'https://accounts.google.com/gsi/client';
        el.onload = () => resolve();
        el.onerror = () => {
          this.loading = undefined;
          reject(new Error('Googleログインを読み込めません。接続を確認してください'));
        };
        document.head.append(el);
      });
      await this.loading;
    }
    await new Promise<void>((resolve, reject) => {
      const client = (window as any).google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope:
          'https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/drive.file',
        callback: (response: { error?: string; access_token: string; expires_in: number }) => {
          if (response.error) {
            reject(new Error(response.error));
            return;
          }
          this.token = response.access_token;
          this.expires = Date.now() + (Number(response.expires_in) - 60) * 1000;
          resolve();
        },
        error_callback: () => reject(new Error('Googleログインが完了しませんでした')),
      });
      client.requestAccessToken({ prompt: '' });
    });
  }
  disconnect() {
    this.token = '';
    this.expires = 0;
  }
  private async request(path: string, init: RequestInit = {}, upload = false): Promise<Response> {
    if (!this.connected) throw new Error('Google Driveに再接続してください');
    const url =
      (upload
        ? 'https://www.googleapis.com/upload/drive/v3/'
        : 'https://www.googleapis.com/drive/v3/') + path;
    const r = await fetch(url, {
      ...init,
      headers: { ...init.headers, Authorization: `Bearer ${this.token}` },
    });
    if (!r.ok) {
      const error = new Error(
        `Drive ${r.status}: ${r.status === 403 ? '権限または利用上限を確認してください' : r.status === 401 ? '再接続してください' : '処理に失敗しました'}`,
      ) as Error & { status: number };
      error.status = r.status;
      throw error;
    }
    return r;
  }
  async list(q: string) {
    const files: DriveFile[] = [];
    let page = '';
    do {
      const p = new URLSearchParams({
        q,
        fields: `nextPageToken,files(${FIELDS})`,
        pageSize: '1000',
        spaces: 'drive',
        ...(page ? { pageToken: page } : {}),
      });
      const result = await (await this.request('files?' + p)).json();
      files.push(...result.files);
      page = result.nextPageToken || '';
    } while (page);
    return files;
  }
  async metadata(id: string) {
    return (
      await this.request(`files/${encodeURIComponent(id)}?fields=${encodeURIComponent(FIELDS)}`)
    ).json() as Promise<DriveFile>;
  }
  async download(id: string) {
    const r = await this.request(`files/${encodeURIComponent(id)}?alt=media`);
    return r.blob();
  }
  private async folder(name: string, parent?: string) {
    const existing = await this.list(
      `trashed=false and mimeType='${folderMime}' and name='${quote(name)}' and '${quote(parent || 'root')}' in parents`,
    );
    if (existing[0]) return existing[0].id;
    const result = await (
      await this.request('files?fields=id', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          mimeType: folderMime,
          ...(parent ? { parents: [parent] } : {}),
        }),
      })
    ).json();
    return result.id as string;
  }
  async ensureFolders(year: number) {
    let root = this.engine.snapshot.settings.drive_root;
    if (root) {
      const meta = await this.metadata(root);
      if (meta.mimeType !== folderMime || meta.trashed)
        throw new Error('保存先にはDriveフォルダIDを指定してください');
    } else {
      root = await this.folder(isMisc ? '雑所得_青色コンパス' : '確定申告_青色コンパス');
      await this.engine.write((s) => s.setSetting('drive_root', root));
    }
    const scopeRoot = isMisc ? await this.folder('雑所得', root) : root;
    const y = await this.folder(String(year), scopeRoot);
    const inbox = await this.folder('00_未処理', y);
    for (const name of ['領収書', '請求書', 'その他']) await this.folder(name, inbox);
    const evidence = await this.folder('01_証憑', y);
    for (const name of ['01_経費', '02_売上', '03_銀行・カード', '04_その他'])
      await this.folder(name, evidence);
    const books = await this.folder('02_帳簿', y);
    await this.folder('03_申告書類', y);
    await this.folder('04_固定資産', y);
    const backup = await this.folder('99_バックアップ', y);
    await this.engine.write((s) => {
      s.setSetting(`drive_year_${year}`, y);
      s.setSetting(`drive_inbox_${year}`, inbox);
      s.setSetting(`drive_books_${year}`, books);
      s.setSetting(`drive_backup_${year}`, backup);
    });
    return { year: y, inbox, backup, books };
  }
  async upload(name: string, blob: Blob, parent: string, evidenceId?: string) {
    if (blob.size > 25 * 1024 * 1024) throw new Error('1ファイル25MB以下にしてください');
    if (evidenceId) {
      const exists = await this.list(
        `trashed=false and appProperties has { key='aoiroEvidenceId' and value='${quote(evidenceId)}' }`,
      );
      if (exists.length) {
        const actual = await this.download(exists[0].id);
        if ((await sha256(actual)) !== (await sha256(blob)))
          throw new Error('同じ証憑IDのDrive原本が変更されています');
        return exists[0];
      }
    }
    const boundary = `aoiro_${newId()}`;
    const meta = {
      name,
      parents: [parent],
      ...(evidenceId ? { appProperties: { aoiroEvidenceId: evidenceId } } : {}),
    };
    const body = new Blob([
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: ${blob.type || 'application/octet-stream'}\r\n\r\n`,
      blob,
      `\r\n--${boundary}--`,
    ]);
    return (
      await this.request(
        `files?uploadType=multipart&fields=${encodeURIComponent(FIELDS)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
          body,
        },
        true,
      )
    ).json() as Promise<DriveFile>;
  }
  async flushQueue(year: number) {
    return navigator.locks.request('aoiro-drive-upload', async () => {
      await this.engine.refresh();
      const pending = this.engine.snapshot.evidences.filter(
        (e) => e.year === year && !e.drive_file_id && e.status !== 'ignored',
      );
      if (!pending.length) return 0;
      let inbox = this.engine.snapshot.settings[`drive_inbox_${year}`];
      if (!inbox) inbox = (await this.ensureFolders(year)).inbox;
      let count = 0;
      for (const e of pending) {
        try {
          const blob = await getBlob(e.id);
          if (!blob) throw new Error('ローカル原本がありません。元ファイルを確認してください');
          const f = await this.upload(e.filename, blob, inbox, e.id);
          await this.engine.write((s) => {
            s.run(
              "UPDATE evidences SET drive_file_id=?,modified_time=?,status=CASE WHEN status='queued' THEN 'indexed' ELSE status END WHERE id=?",
              [f.id, f.modifiedTime || null, e.id],
            );
            s.run("UPDATE upload_queue SET status='uploaded',last_error=NULL WHERE id=?", [e.id]);
            s.event('evidence_uploaded', e.id, { drive_file_id: f.id });
          });
          count++;
        } catch (error) {
          await this.engine.write((s) =>
            s.run(
              "UPDATE upload_queue SET status='failed',retry_count=retry_count+1,last_error=? WHERE id=?",
              [(error as Error).message, e.id],
            ),
          );
          throw error;
        }
      }
      return count;
    });
  }
  async sync(year: number, onProgress?: (text: string) => void) {
    return navigator.locks.request('aoiro-drive-sync', async () => {
      const folder =
        this.engine.snapshot.settings[`drive_year_${year}`] ||
        (await this.ensureFolders(year)).year;
      const start = await (await this.request('changes/startPageToken')).json();
      onProgress?.('原本をアップロードしています');
      await this.flushQueue(year);
      const seen = new Map<string, DriveFile>();
      const visited = new Set<string>();
      const walk = async (id: string) => {
        if (visited.has(id)) return;
        visited.add(id);
        for (const f of await this.list(`'${quote(id)}' in parents and trashed=false`)) {
          if (f.mimeType === folderMime) {
            if (!['99_バックアップ', '02_帳簿', '03_申告書類'].includes(f.name)) await walk(f.id);
          } else if (supported(f)) seen.set(f.id, f);
        }
      };
      onProgress?.('年度フォルダを確認しています');
      await walk(folder);
      const current = this.engine.snapshot.evidences.filter(
        (e) => e.year === year && e.drive_file_id,
      );
      const previous = this.engine.snapshot.settings[`drive_token_${year}`];
      let token = previous;
      const missing = new Set<string>();
      if (token) {
        try {
          do {
            const p = new URLSearchParams({
              pageToken: token,
              fields: `nextPageToken,newStartPageToken,changes(fileId,removed,file(${FIELDS}))`,
              pageSize: '1000',
            });
            const page = await (await this.request('changes?' + p)).json();
            for (const c of page.changes || []) {
              if (current.some((e) => e.drive_file_id === c.fileId)) {
                if (c.removed || c.file?.trashed) missing.add(c.fileId);
                else if (c.file) seen.set(c.fileId, c.file);
              }
            }
            token = page.nextPageToken || '';
          } while (token);
        } catch (e) {
          if ((e as Error & { status: number }).status !== 410) throw e;
        }
      }
      // A move out of the watched folder is not deletion: resolve the stable ID.
      for (const e of current) {
        if (!seen.has(e.drive_file_id!) && !missing.has(e.drive_file_id!)) {
          try {
            const f = await this.metadata(e.drive_file_id!);
            if (f.trashed) missing.add(f.id);
            else seen.set(f.id, f);
          } catch (error) {
            if ((error as Error & { status: number }).status === 404) missing.add(e.drive_file_id!);
            else throw error;
          }
        }
      }
      const changes: Evidence[] = [];
      let i = 0;
      for (const f of seen.values()) {
        onProgress?.(`証憑を確認しています ${++i} / ${seen.size}`);
        const old = current.find((e) => e.drive_file_id === f.id);
        if (Number(f.size || 0) > 25 * 1024 * 1024)
          throw new Error(`${f.name}: 25MBを超えるため索引化できません`);
        let hash = old?.sha256;
        if (!old || old.modified_time !== f.modifiedTime || old.status === 'missing') {
          const blob = await this.download(f.id);
          hash = await sha256(blob);
        }
        changes.push({
          id: old?.id || newId(),
          year,
          drive_file_id: f.id,
          filename: f.name,
          mime_type: f.mimeType,
          size_bytes: Number(f.size || 0),
          sha256: hash!,
          original_sha256: old?.original_sha256 || hash!,
          modified_time: f.modifiedTime || null,
          status: 'indexed',
          capture_source: 'drive_upload',
          hint: old?.hint || '',
          payment_account: old?.payment_account || '3100',
          note: old?.note || '',
          indexed_at: old?.indexed_at || now(),
        });
      }
      await this.engine.write((s) => {
        for (const e of changes) s.upsertEvidence(e);
        for (const id of missing) s.markMissing(id);
        s.setSetting(`drive_token_${year}`, start.startPageToken);
        s.setSetting(`drive_last_${year}`, now());
        s.run(
          'INSERT INTO drive_sync_state VALUES(?,?,?,?) ON CONFLICT(year) DO UPDATE SET root_folder_id=excluded.root_folder_id,page_token=excluded.page_token,last_sync_at=excluded.last_sync_at',
          [year, folder, start.startPageToken, now()],
        );
        s.event('drive_synced', String(year), { indexed: changes.length, missing: missing.size });
      });
      return changes.length;
    });
  }
}
export async function captureFiles(
  engine: Engine,
  files: File[],
  year: number,
  hint: string,
  payment: string,
  source = 'local_import',
) {
  engine.store.assertEditable(year);
  let count = 0;
  for (const file of files) {
    const mime = file.type || (/\.pdf$/i.test(file.name) ? 'application/pdf' : '');
    if (!acceptedMimes.includes(mime))
      throw new Error(`${file.name}: PDF・画像ファイルを選択してください`);
    if (file.size > 25 * 1024 * 1024) throw new Error(`${file.name}: 25MB以下にしてください`);
    const id = newId();
    const hash = await sha256(file);
    await putBlob(id, file);
    await engine.write((s) => {
      s.assertEditable(year);
      s.upsertEvidence({
        id,
        year,
        drive_file_id: null,
        filename: file.name,
        mime_type: mime,
        size_bytes: file.size,
        sha256: hash,
        original_sha256: hash,
        modified_time: null,
        status: 'queued',
        capture_source: source,
        hint,
        payment_account: payment,
        note: '',
        indexed_at: now(),
      });
    });
    count++;
  }
  return count;
}
