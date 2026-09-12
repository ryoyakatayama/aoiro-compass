import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Sessions, validHash, verifyPassword } from './auth.mjs';

const loginPage = (error = '') =>
  `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow,noarchive"><title>青色コンパスにログイン</title><style>body{font:16px system-ui;background:#f5f6f3;color:#163f48;margin:0;display:grid;min-height:100dvh;place-items:center}main{max-width:360px;margin:24px;padding:32px;background:white;border-radius:18px;border:1px solid #dce4e1}label,input,button{display:block;width:100%;box-sizing:border-box}input,button{font:inherit;padding:14px;border-radius:8px;margin:12px 0;border:1px solid #8da6a5}button{background:#163f48;color:white}p{line-height:1.7}small{color:#526767}</style></head><body><main><h1>青色コンパス</h1><p>このアプリを利用するためのパスワードを入力してください。</p>${error ? '<p role="alert">' + error + '</p>' : ''}<form method="post" action="/_auth/login"><label>パスワード<input name="password" type="password" autocomplete="current-password" maxlength="256" required autofocus></label><button>ログイン</button></form><small>帳簿と領収書は、ご自身のGoogle Driveと端末に保存されます。</small></main></body></html>`;
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
};
export async function createAppServer(config) {
  if (!validHash(config.passwordHash))
    throw new Error('AOIRO_PASSWORD_HASHを設定してください。平文のパスワードは設定しません');
  const origin = new URL(config.origin);
  if (
    origin.origin !== config.origin ||
    (origin.protocol !== 'https:' &&
      !(config.allowHttp && ['127.0.0.1', 'localhost'].includes(origin.hostname)))
  )
    throw new Error('AOIRO_ORIGINには実際のHTTPS生成元を設定してください');
  const root = await fs.realpath(config.dist);
  const policy = JSON.parse(await fs.readFile(path.join(root, 'deployment-policy.json'), 'utf8'));
  if (policy.authentication !== 'server' || policy.offline !== false)
    throw new Error('build:privateで作成した認証用ビルドが必要です');
  const secure = origin.protocol === 'https:',
    cookieName = secure ? '__Host-aoiro_session' : 'aoiro_local_session';
  const sessions = new Sessions(),
    attempts = new Map();
  let globalWindow = Date.now(),
    globalAttempts = 0,
    verifying = 0;
  const cookie = (token = '', maxAge = 28800) =>
    `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
  return http.createServer(
    { maxHeaderSize: 16384, requestTimeout: 15000, headersTimeout: 15000 },
    async (req, res) => {
      const headers = {
        'Cache-Control': 'no-store',
        'X-Robots-Tag': 'noindex, nofollow, noarchive',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'Referrer-Policy': 'same-origin',
        'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
        'Permissions-Policy': 'camera=(self), microphone=(), geolocation=()',
        'Content-Security-Policy':
          "default-src 'self'; script-src 'self' 'wasm-unsafe-eval' https://accounts.google.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' https://www.googleapis.com https://accounts.google.com; frame-src 'self' blob: https://accounts.google.com; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; worker-src 'self'",
        ...(secure ? { 'Strict-Transport-Security': 'max-age=31536000' } : {}),
      };
      const send = (status, body = '', extra = {}) => {
        res.writeHead(status, { ...headers, ...extra });
        res.end(req.method === 'HEAD' ? '' : body);
      };
      try {
        const url = new URL(req.url, origin);
        const token = (req.headers.cookie || '')
          .split(';')
          .map((p) => p.trim())
          .find((p) => p.startsWith(cookieName + '='))
          ?.slice(cookieName.length + 1);
        const authenticated = sessions.valid(token);
        const route = url.pathname;
        if (route === '/robots.txt' && req.method === 'GET')
          return send(200, 'User-agent: *\nAllow: /\n', { 'Content-Type': 'text/plain' });
        if (route === '/_auth/session')
          return send(authenticated ? 200 : 401, JSON.stringify({ authenticated }), {
            'Content-Type': 'application/json',
          });
        if (route === '/_auth/login' && req.method === 'GET')
          return send(200, loginPage(), { 'Content-Type': 'text/html; charset=utf-8' });
        if (route === '/_auth/login' && req.method === 'POST') {
          if (
            req.headers.origin !== origin.origin ||
            (req.headers['sec-fetch-site'] && req.headers['sec-fetch-site'] !== 'same-origin')
          )
            return send(403, '許可されていない送信元です');
          if (!(req.headers['content-type'] || '').startsWith('application/x-www-form-urlencoded'))
            return send(415, '対応していない形式です');
          const ip = req.socket.remoteAddress || 'unknown',
            now = Date.now();
          for (const [key, value] of attempts) if (value.until <= now) attempts.delete(key);
          if (now - globalWindow > 60000) {
            globalWindow = now;
            globalAttempts = 0;
          }
          const limit = attempts.get(ip) || { count: 0, until: now + 15 * 60000 };
          if (limit.count >= 5 || globalAttempts >= 100 || verifying >= 2 || attempts.size >= 4096)
            return send(429, '試行回数が多いため、時間を置いて再試行してください', {
              'Retry-After': '900',
            });
          limit.count++;
          attempts.set(ip, limit);
          globalAttempts++;
          let size = 0,
            parts = [];
          for await (const chunk of req) {
            size += chunk.length;
            if (size > 4096) {
              send(413, '入力が大きすぎます');
              return;
            }
            parts.push(chunk);
          }
          const form = new URLSearchParams(Buffer.concat(parts).toString('utf8'));
          if (form.getAll('password').length !== 1) return send(400, '入力が不正です');
          verifying++;
          let valid = false;
          try {
            valid = await verifyPassword(form.get('password'), config.passwordHash);
          } finally {
            verifying--;
          }
          if (!valid)
            return send(401, loginPage('パスワードを確認してください。'), {
              'Content-Type': 'text/html; charset=utf-8',
            });
          attempts.delete(ip);
          sessions.revoke(token);
          return send(303, '', { Location: '/', 'Set-Cookie': cookie(sessions.create()) });
        }
        if (route === '/_auth/logout' && req.method === 'POST') {
          if (req.headers.origin !== origin.origin) return send(403, '許可されていない送信元です');
          sessions.revoke(token);
          return send(303, '', {
            Location: '/_auth/login',
            'Set-Cookie': cookie('', 0),
            'Clear-Site-Data': '"cache"',
          });
        }
        if (!authenticated)
          return route === '/'
            ? send(303, '', { Location: '/_auth/login' })
            : send(401, 'ログインが必要です');
        if (!['GET', 'HEAD'].includes(req.method)) return send(405, '許可されていない操作です');
        let name = decodeURIComponent(route);
        if (
          name.includes('\\') ||
          name.includes('\0') ||
          name.split('/').some((p) => p.startsWith('.'))
        )
          return send(404, '見つかりません');
        if (name === '/') name = '/index.html';
        const target = path.resolve(root, '.' + name);
        if (
          !target.startsWith(root + path.sep) ||
          !types[path.extname(target)] ||
          name === '/sw.js'
        )
          return send(404, '見つかりません');
        const real = await fs.realpath(target);
        if (!real.startsWith(root + path.sep)) return send(404, '見つかりません');
        const bytes = await fs.readFile(real);
        return send(200, bytes, { 'Content-Type': types[path.extname(real)] });
      } catch (error) {
        if (!res.headersSent)
          send(
            error.code === 'ENOENT' ? 404 : 500,
            error.code === 'ENOENT' ? '見つかりません' : '処理に失敗しました',
          );
        else res.end();
      }
    },
  );
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist-private');
  const server = await createAppServer({
    dist,
    passwordHash: process.env.AOIRO_PASSWORD_HASH,
    origin: process.env.AOIRO_ORIGIN,
    allowHttp: process.env.AOIRO_LOCAL_HTTP === '1',
  });
  server.listen(Number(process.env.PORT || 8080), process.env.HOST || '127.0.0.1', () =>
    console.log('青色コンパスの認証付きサーバーを起動しました'),
  );
}
