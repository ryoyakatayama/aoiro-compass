import { randomBytes, scrypt, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
const derive = promisify(scrypt);
const options = { N: 131072, r: 8, p: 1, maxmem: 160 * 1024 * 1024 };
export async function hashPassword(password) {
  if (password.length < 12 || password.length > 256)
    throw new Error('パスワードは12〜256文字にしてください');
  const salt = randomBytes(32).toString('hex');
  const key = await derive(password, salt, 64, options);
  return `scrypt1:${salt}:${key.toString('hex')}`;
}
export function validHash(hash) {
  return /^scrypt1:[a-f0-9]{64}:[a-f0-9]{128}$/.test(hash || '');
}
export async function verifyPassword(password, hash) {
  if (!validHash(hash) || typeof password !== 'string' || password.length > 256) return false;
  const [, salt, expected] = hash.split(':');
  const actual = await derive(password, salt, 64, options);
  return timingSafeEqual(actual, Buffer.from(expected, 'hex'));
}
const digest = (value) => createHash('sha256').update(value).digest('hex');
export class Sessions {
  #values = new Map();
  constructor(ttl = 8 * 60 * 60 * 1000, clock = Date.now) {
    this.ttl = ttl;
    this.clock = clock;
  }
  create() {
    this.clean();
    if (this.#values.size >= 100) throw new Error('ログイン数が上限に達しました');
    const token = randomBytes(32).toString('hex');
    this.#values.set(digest(token), this.clock() + this.ttl);
    return token;
  }
  valid(token) {
    return (
      /^[a-f0-9]{64}$/.test(token || '') && (this.#values.get(digest(token)) || 0) > this.clock()
    );
  }
  revoke(token) {
    if (token) this.#values.delete(digest(token));
  }
  clean() {
    for (const [id, expires] of this.#values) if (expires <= this.clock()) this.#values.delete(id);
  }
}
