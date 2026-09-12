import type { BrowserContext, Page } from '@playwright/test';
import { expect } from '@playwright/test';
export const clientId = 'test-client.apps.googleusercontent.com';
export function fakeDrive() {
  const files = new Map<string, any>();
  const state = { failBackups: false };
  const attach = async (context: BrowserContext) => {
    await context.addInitScript(() => {
      (window as any).google = {
        accounts: {
          oauth2: {
            initTokenClient: (options: any) => ({
              requestAccessToken: () =>
                options.callback({
                  access_token: 'test-only',
                  expires_in: 3600,
                  scope: options.scope,
                }),
            }),
          },
        },
      };
    });
    await context.route('https://www.googleapis.com/**', async (route) => {
      const request = route.request(),
        url = new URL(request.url()),
        method = request.method();
      const json = (value: unknown, status = 200) =>
        route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) });
      const publicFile = (file: any) => {
        const { bytes, ...meta } = file;
        return meta;
      };
      if (url.pathname.endsWith('/about')) return json({ user: { permissionId: 'test-account' } });
      if (url.pathname.endsWith('/changes/startPageToken')) return json({ startPageToken: '0' });
      if (url.pathname.endsWith('/changes')) return json({ changes: [], newStartPageToken: '0' });
      const id = url.pathname.match(/\/files\/([^/]+)$/)?.[1];
      if (id) {
        const file = files.get(id);
        if (!file) return json({ error: 'missing' }, 404);
        return url.searchParams.get('alt') === 'media'
          ? route.fulfill({
              contentType: file.mimeType || 'application/octet-stream',
              body: file.bytes,
            })
          : json(publicFile(file));
      }
      if (method === 'GET' && url.pathname.endsWith('/files')) {
        const q = url.searchParams.get('q') || '',
          appData = url.searchParams.get('spaces') === 'appDataFolder';
        const properties = [...q.matchAll(/key\s*=\s*'([^']+)'\s+and\s+value\s*=\s*'([^']+)'/g)];
        const parent = q.match(/'([^']+)' in parents/)?.[1],
          name = q.match(/name='([^']+)'/)?.[1];
        return json({
          files: [...files.values()]
            .filter(
              (f) =>
                f.parents.includes('appDataFolder') === appData &&
                (!parent || f.parents.includes(parent)) &&
                (!name || f.name === name) &&
                properties.every((m) => f.appProperties?.[m[1]] === m[2]),
            )
            .map(publicFile),
        });
      }
      if (method === 'POST' && url.pathname.endsWith('/files')) {
        const body = request.postDataBuffer()!;
        let meta: any,
          bytes = Buffer.alloc(0);
        if (url.searchParams.get('uploadType') === 'multipart') {
          const boundary = request.headers()['content-type'].split('boundary=')[1];
          const metaStart = body.indexOf('\r\n\r\n') + 4;
          const metaEnd = body.indexOf(`\r\n--${boundary}`, metaStart);
          meta = JSON.parse(body.subarray(metaStart, metaEnd).toString());
          const fileStart = body.indexOf('\r\n\r\n', metaEnd + 4) + 4;
          const fileEnd = body.lastIndexOf(`\r\n--${boundary}--`);
          bytes = body.subarray(fileStart, fileEnd);
        } else meta = JSON.parse(body.toString());
        if (state.failBackups && meta.appProperties?.aoiroBackup)
          return json({ error: 'backup temporarily unavailable' }, 503);
        const file = {
          ...meta,
          id: `file-${files.size + 1}`,
          parents: meta.parents || ['root'],
          size: String(bytes.length),
          modifiedTime: new Date().toISOString(),
          bytes,
        };
        files.set(file.id, file);
        return json(publicFile(file));
      }
      return json({ error: `unhandled ${method} ${url.pathname}` }, 400);
    });
  };
  return { files, state, attach };
}
export async function connectDrive(page: Page) {
  await page.getByRole('button', { name: '事業情報・設定', exact: true }).click();
  await page.getByLabel('Google OAuth Client ID', { exact: true }).fill(clientId);
  await page.getByRole('button', { name: '設定を保存して接続', exact: true }).click();
  await expect(
    page.getByText('Google Driveに帳簿とバックアップを保存済みです', { exact: true }),
  ).toBeVisible();
}
