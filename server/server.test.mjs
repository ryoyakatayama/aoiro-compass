import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createAppServer } from './index.mjs';
import { hashPassword, Sessions } from './auth.mjs';
const password = 'test-only-password-9h3f';
const passwordHash = await hashPassword(password);
test('sessions reject forged tokens and expire and revoke', () => {
  let clock = 100;
  const sessions = new Sessions(100, () => clock),
    token = sessions.create();
  assert.equal(sessions.valid(token), true);
  assert.equal(sessions.valid('0'.repeat(64)), false);
  clock = 201;
  assert.equal(sessions.valid(token), false);
  const next = sessions.create();
  sessions.revoke(next);
  assert.equal(sessions.valid(next), false);
});
test('server gates all assets, checks CSRF and password, and invalidates logout sessions', async () => {
  const dist = await fs.mkdtemp(path.join(os.tmpdir(), 'aoiro-auth-test-'));
  await fs.writeFile(
    path.join(dist, 'deployment-policy.json'),
    '{"authentication":"server","offline":false}',
  );
  await fs.writeFile(path.join(dist, 'index.html'), '<h1>PRIVATE APP</h1>');
  await fs.writeFile(path.join(dist, 'app.js'), 'PRIVATE JAVASCRIPT');
  const origin = 'https://accounting.example.test';
  const server = await createAppServer({ dist, passwordHash, origin });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (route, opts = {}) => fetch(base + route, { redirect: 'manual', ...opts });
  const login = (body, from = origin) =>
    request('/_auth/login', {
      method: 'POST',
      headers: { Origin: from, 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
  try {
    assert.equal((await request('/')).status, 303);
    assert.equal((await request('/app.js')).status, 401);
    const page = await request('/_auth/login');
    assert.match(await page.text(), /noindex/);
    assert.match(page.headers.get('X-Robots-Tag'), /noindex/);
    assert.equal(page.headers.get('Referrer-Policy'), 'same-origin');
    assert.equal(
      (await login(new URLSearchParams({ password }), 'https://evil.example')).status,
      403,
    );
    assert.equal((await login('password=wrong')).status, 401);
    const success = await login(new URLSearchParams({ password }));
    assert.equal(success.status, 303);
    const cookie = success.headers.get('set-cookie');
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /Secure/);
    assert.match(cookie, /SameSite=Strict/);
    const auth = { headers: { Cookie: cookie.split(';')[0] } };
    const app = await request('/', auth);
    assert.equal(app.status, 200);
    assert.equal(app.headers.get('cache-control'), 'no-store');
    assert.match(await app.text(), /PRIVATE APP/);
    assert.equal((await request('/app.js', auth)).status, 200);
    assert.equal((await request('/.env', auth)).status, 404);
    assert.equal((await request('/sw.js', auth)).status, 404);
    assert.equal((await request('/_auth/session', auth)).status, 200);
    assert.equal(
      (
        await request('/_auth/logout', {
          method: 'POST',
          headers: { ...auth.headers, Origin: origin },
        })
      ).status,
      303,
    );
    assert.equal((await request('/app.js', auth)).status, 401);
    for (let i = 0; i < 5; i++) await login('password=wrong');
    assert.equal((await login(new URLSearchParams({ password }))).status, 429);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(dist, { recursive: true, force: true });
  }
});
test('missing password and non-protected builds fail closed', async () => {
  await assert.rejects(
    createAppServer({ passwordHash: '', origin: 'https://example.test', dist: '.' }),
    /AOIRO_PASSWORD_HASH/,
  );
  const dist = await fs.mkdtemp(path.join(os.tmpdir(), 'aoiro-policy-test-'));
  await fs.writeFile(
    path.join(dist, 'deployment-policy.json'),
    '{"authentication":"none","offline":true}',
  );
  try {
    await assert.rejects(
      createAppServer({ passwordHash, origin: 'https://example.test', dist }),
      /build:private/,
    );
  } finally {
    await fs.rm(dist, { recursive: true, force: true });
  }
});
