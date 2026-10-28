import { randomBytes, scrypt, timingSafeEqual, createHash, createHmac } from 'node:crypto';
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export const token = () => randomBytes(32).toString('base64url');
export const hash = (v: string) => createHash('sha256').update(v).digest('hex');
export const equal = (a: string, b: string) => {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};
// scrypt uses ~128 MiB per operation. Bound concurrency so a burst of logins cannot exhaust a small server.
let activeHashes = 0;
const hashWaiters: Array<() => void> = [];
async function derive(password: string, salt: string): Promise<Buffer> {
  if (activeHashes >= 2) {
    if (hashWaiters.length >= 8) throw new HttpError(503, '登录请求较多，请稍后重试');
    await new Promise<void>((resolve) => hashWaiters.push(resolve));
  } else activeHashes++;
  try {
    return await new Promise<Buffer>((resolve, reject) =>
      scrypt(password, salt, 64, { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 }, (e, key) =>
        e ? reject(e) : resolve(key),
      ),
    );
  } finally {
    const next = hashWaiters.shift();
    if (next) next();
    else activeHashes--;
  }
}
export async function passwordHash(password: string) {
  const salt = randomBytes(16).toString('hex');
  return `scrypt$${salt}$${(await derive(password, salt)).toString('hex')}`;
}
export async function passwordMatches(password: string, encoded: string) {
  const [algorithm, salt, key] = encoded.split('$');
  if (algorithm !== 'scrypt' || !salt || !key) return false;
  return equal((await derive(password, salt)).toString('hex'), key);
}
export const csrf = (sessionToken: string, secret: string) =>
  createHmac('sha256', secret).update(`csrf:${sessionToken}`).digest('base64url');
export const sign = (value: unknown, secret: string) =>
  createHmac('sha256', secret).update(JSON.stringify(value)).digest('base64url');
/** Per-process limiter complements transactional per-account AI quotas. No raw IPs or credentials in logs. */
export class Limiter {
  private entries = new Map<string, { count: number; until: number }>();
  take(key: string, limit: number, windowMs: number) {
    const now = Date.now();
    if (this.entries.size >= 10000)
      for (const [k, v] of this.entries) if (v.until <= now) this.entries.delete(k);
    let e = this.entries.get(key);
    if (!e || e.until <= now) {
      if (this.entries.size >= 10000) throw new HttpError(429, '服务请求较多，请稍后重试');
      e = { count: 0, until: now + windowMs };
      this.entries.set(key, e);
    }
    if (++e.count > limit) throw new HttpError(429, '操作过于频繁，请稍后重试');
  }
}
