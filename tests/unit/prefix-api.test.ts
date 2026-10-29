import { it, expect } from 'vitest';
import { createServer } from 'node:http';
import { embeddedDatabase } from '../../server/database';
import { platformApi } from '../../server/api';
import { stripBasePath } from '../../scripts/base-path.mjs';

it('路径前缀账号Cookie保持隔离，Origin按含端口的origin验证，注销清除同一Path', async () => {
  const database = await embeddedDatabase();
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('missing address');
  const origin = `http://127.0.0.1:${address.port}`,
    prefix = '/test-prefix';
  const handler = platformApi(database, {
    PUBLIC_URL: origin + prefix,
    APP_BASE_PATH: prefix,
    ALLOW_INSECURE_LOCAL: '1',
    SESSION_SECRET: 'prefix-test-only-secret-'.repeat(3),
    SETUP_TOKEN: 'prefix-test-only-setup',
  });
  server.on('request', (request, response) => {
    const url = new URL(request.url!, origin),
      pathname = stripBasePath(url.pathname, prefix);
    if (pathname === null) {
      response.writeHead(404);
      response.end('Not found');
      return;
    }
    url.pathname = pathname;
    void handler(request, response, url);
  });
  try {
    const headers = { Origin: origin, 'Content-Type': 'application/json' };
    const setup = await fetch(origin + prefix + '/api/platform/setup', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        email: 'prefix-test@example.test',
        password: 'synthetic-only-password',
        setupToken: 'prefix-test-only-setup',
      }),
    });
    expect(setup.status).toBe(200);
    const auth = await setup.json(),
      cookie = setup.headers.get('set-cookie')!;
    expect(cookie).toContain('Path=/test-prefix/; HttpOnly; SameSite=Lax');
    expect((await fetch(origin + '/api/platform/status')).status).toBe(404);
    const session = await fetch(origin + prefix + '/api/platform/session', {
      headers: { Cookie: cookie.split(';')[0] },
    });
    expect(session.status).toBe(200);
    const wrong = await fetch(origin + prefix + '/api/platform/logout', {
      method: 'POST',
      headers: {
        ...headers,
        Origin: origin + prefix,
        Cookie: cookie.split(';')[0],
        'X-CSRF-Token': auth.csrf,
      },
      body: '{}',
    });
    expect(wrong.status).toBe(403);
    const logout = await fetch(origin + prefix + '/api/platform/logout', {
      method: 'POST',
      headers: { ...headers, Cookie: cookie.split(';')[0], 'X-CSRF-Token': auth.csrf },
      body: '{}',
    });
    expect(logout.status).toBe(200);
    expect(logout.headers.get('set-cookie')).toContain(
      'Path=/test-prefix/; HttpOnly; SameSite=Lax; Max-Age=0',
    );
    expect(() =>
      platformApi(database, {
        PUBLIC_URL: origin,
        APP_BASE_PATH: prefix,
        SESSION_SECRET: 'x'.repeat(40),
        ALLOW_INSECURE_LOCAL: '1',
      }),
    ).toThrow('一致');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await database.close();
  }
}, 30000);
