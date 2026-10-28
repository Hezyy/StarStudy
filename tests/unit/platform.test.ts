import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { embeddedDatabase, postgresDatabase, type Database } from '../../server/database';
import { platformApi } from '../../server/api';
import { initialBackup } from '../../server/store';
import { previewStudyPlan, parsePlanText } from '@/services/study-plan';
import { callProvider } from '../../server/ai';
import type { StudyPlan } from '@/schemas/study-plan';
import type { Backup } from '@/services/backup';
let db: Database, server: http.Server, base: string;
type Client = { cookie: string; csrf: string; id: string };
const empty: Client = { cookie: '', csrf: '', id: '' };
let admin: Client, a: Client, b: Client;
let usedInvite = '';
async function request(
  client: Client,
  route: string,
  method = 'GET',
  data?: unknown,
  extra: Record<string, string> = {},
) {
  const res = await fetch(`${base}/api/platform${route}`, {
    method,
    headers: {
      Origin: base,
      'Content-Type': 'application/json',
      Cookie: client.cookie,
      'X-CSRF-Token': client.csrf,
      ...(client.id ? { 'X-Star-Study-Account': client.id } : {}),
      ...extra,
    },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  });
  const body = await res.json();
  return { status: res.status, body, cookie: res.headers.get('set-cookie')?.split(';')[0] ?? '' };
}
async function streamedRequest(client: Client, route: string, payload: Buffer) {
  return new Promise<{ status: number; body: { error?: string } }>((resolve, reject) => {
    const outgoing = http.request(
      `${base}/api/platform${route}`,
      {
        method: 'POST',
        headers: {
          Origin: base,
          'Content-Type': 'application/json',
          'Transfer-Encoding': 'chunked',
          Cookie: client.cookie,
          'X-CSRF-Token': client.csrf,
          ...(client.id ? { 'X-Star-Study-Account': client.id } : {}),
        },
      },
      (response) => {
        const parts: Buffer[] = [];
        response.on('data', (chunk: Buffer) => parts.push(chunk));
        response.on('end', () => {
          try {
            resolve({
              status: response.statusCode ?? 0,
              body: JSON.parse(Buffer.concat(parts).toString('utf8')),
            });
          } catch (error) {
            reject(error);
          }
        });
        response.on('error', reject);
      },
    );
    outgoing.on('error', reject);
    outgoing.write(payload.subarray(0, 4096));
    outgoing.end(payload.subarray(4096));
  });
}
async function register(email: string, invite: string) {
  const r = await request(empty, '/register', 'POST', {
    email,
    password: 'test-password-12345',
    name: email,
    invite,
  });
  expect(r.status).toBe(200);
  return { cookie: r.cookie, csrf: r.body.csrf, id: r.body.user.id };
}
function sample(days = 1, offset = 0): StudyPlan {
  return {
    schemaVersion: '1.0.0',
    planId: 'test-long-plan',
    planName: '合成测试计划',
    generatedAt: '2026-10-28T00:00:00.000Z',
    startDate: '2027-01-01',
    endDate: '2028-02-10',
    timezone: 'Asia/Shanghai',
    examTarget: { university: '测试院校', major: '测试专业', examDate: '2028-12-25' },
    subjects: [{ externalId: 'math', name: '数学一', category: 'math', priority: 1 }],
    resources: [],
    knowledgePoints: [],
    tasks: Array.from({ length: days }, (_, i) => ({
      externalId: `task-${i + offset}`,
      date: new Date(Date.UTC(2027, 0, i + offset + 1)).toISOString().slice(0, 10),
      subjectId: 'math',
      title: `基础任务${i + offset}`,
      description: '',
      estimatedMinutes: 30,
      taskType: 'review',
      priority: 1,
      knowledgePointIds: [],
      resourceIds: [],
      exerciseDescription: '',
      notes: '',
    })),
    metadata: { source: '合成测试', notes: '' },
  };
}
beforeAll(async () => {
  const postgresUrl = process.env.TEST_POSTGRES_URL;
  if (postgresUrl) {
    if (new URL(postgresUrl).pathname !== '/star_study_test')
      throw new Error(
        '网络PostgreSQL测试仅允许明确命名的独立数据库star_study_test，禁止访问其他数据库',
      );
    db = await postgresDatabase(postgresUrl);
    await db.query(sql`truncate table users,platform_settings cascade`);
  } else db = await embeddedDatabase();
  server = http.createServer();
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const handler = platformApi(db, {
    PUBLIC_URL: base,
    ALLOW_INSECURE_LOCAL: '1',
    SESSION_SECRET: 'test-only-session-secret-'.repeat(3),
    SETUP_TOKEN: 'test-only-setup-token',
  });
  server.on('request', (req, res) => {
    void handler(req, res, new URL(req.url!, base));
  });
  const setup = await request(empty, '/setup', 'POST', {
    email: 'admin@example.test',
    name: 'Admin',
    password: 'test-password-12345',
    setupToken: 'test-only-setup-token',
  });
  expect(setup.status, JSON.stringify(setup.body)).toBe(200);
  admin = { cookie: setup.cookie, csrf: setup.body.csrf, id: setup.body.user.id };
  const first = await request(admin, '/admin/invite', 'POST', {}),
    second = await request(admin, '/admin/invite', 'POST', {});
  usedInvite = first.body.code;
  a = await register('a@example.test', first.body.code);
  b = await register('b@example.test', second.body.code);
}, 60000);
afterAll(async () => {
  if (server) await new Promise<void>((r) => server.close(() => r()));
  await db?.close();
});
describe('PostgreSQL engine platform API', () => {
  it('未认证凭据请求限8KiB，声明长度和真实chunked超限均友好返回413且不建号', async () => {
    const [{ count: before }] = await db.query(sql`select count(*)::int count from users`);
    for (const route of ['/setup', '/register', '/login']) {
      const response = await request(empty, route, 'POST', {
        email: 'oversized@example.test',
        password: 'test-password-12345',
        padding: 'x'.repeat(8192),
      });
      expect(response.status).toBe(413);
      expect(response.body.error).toContain('过大');
    }
    const chunked = await streamedRequest(
      empty,
      '/login',
      Buffer.from(
        JSON.stringify({
          email: 'chunked@example.test',
          password: 'test-password-12345',
          padding: 'x'.repeat(8192),
        }),
      ),
    );
    expect(chunked.status).toBe(413);
    expect(chunked.body.error).toContain('过大');
    expect((await db.query(sql`select count(*)::int count from users`))[0].count).toBe(before);
  });
  it('排空有限超限上传后保持同一HTTP连接可用，连续413与正常读取都不重置', async () => {
    const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
    const rawRequest = (route: string, method: string, payload?: string) =>
      new Promise<{ status: number; localPort?: number }>((resolve, reject) => {
        const req = http.request(
          `${base}/api/platform${route}`,
          {
            method,
            agent,
            headers: {
              Origin: base,
              'Content-Type': 'application/json',
              Cookie: a.cookie,
              'X-CSRF-Token': a.csrf,
              'X-Star-Study-Account': a.id,
              ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
            },
          },
          (response) => {
            const localPort = response.socket.localPort;
            response.resume();
            response.on('end', () => resolve({ status: response.statusCode ?? 0, localPort }));
            response.on('error', reject);
          },
        );
        req.on('error', reject);
        req.end(payload);
      });
    try {
      const oversized = JSON.stringify({ kind: 'explain', prompt: 'x'.repeat(512 * 1024) });
      for (let attempt = 0; attempt < 4; attempt++) {
        const rejected = await rawRequest('/ai/call', 'POST', oversized);
        expect(rejected.status).toBe(413);
        const next = await rawRequest('/session', 'GET');
        expect(next.status).toBe(200);
        expect(next.localPort).toBe(rejected.localPort);
      }
    } finally {
      agent.destroy();
    }
  });
  it('元数据请求保持小限额，AI和计划允许各自合法长度，完整同步/恢复仍支持大备份', async () => {
    const originalName = (await request(a, '/session')).body.user.name;
    expect(
      (await request(a, '/account', 'PATCH', { name: '不应保存', padding: 'x'.repeat(20000) }))
        .status,
    ).toBe(413);
    expect((await request(a, '/session')).body.user.name).toBe(originalName);
    expect(
      (await request(a, '/ai/call', 'POST', { kind: 'explain', prompt: 'x'.repeat(60000) })).status,
    ).toBe(503);
    expect(
      (await request(a, '/ai/call', 'POST', { kind: 'explain', prompt: 'x'.repeat(512 * 1024) }))
        .status,
    ).toBe(413);
    const state = (await request(admin, '/data')).body,
      stamp = new Date().toISOString();
    state.backup.data.settings.push({
      id: randomUUID(),
      createdAt: stamp,
      updatedAt: stamp,
      key: 'synthetic-body-limit-check',
      value: 'x'.repeat(32768),
    });
    expect(
      (await request(admin, '/data', 'PUT', { baseVersion: state.version, backup: state.backup }))
        .status,
    ).toBe(200);
    const remote = (await request(admin, '/data')).body;
    expect(
      remote.backup.data.settings.find(
        (s: { key: string }) => s.key === 'synthetic-body-limit-check',
      ).value.length,
    ).toBe(32768);
    const restore = await request(admin, '/data/restore/preview', 'POST', {
      backup: remote.backup,
    });
    expect(restore.status).toBe(200);
    expect((await request(admin, '/data')).body.version).toBe(remote.version);
    const plan = sample();
    plan.tasks[0].notes = 'x'.repeat(20000);
    expect((await request(admin, '/plans/preview', 'POST', { plan, mode: 'merge' })).status).toBe(
      200,
    );
  });
  it('拒绝伪JSON媒体类型与非法UTF8，不把替换字符存入用户资料', async () => {
    expect(
      (
        await request(
          empty,
          '/login',
          'POST',
          { email: 'media@example.test', password: 'test-password-12345' },
          { 'Content-Type': 'application/json-fake' },
        )
      ).status,
    ).toBe(415);
    const before = (await request(a, '/session')).body.user.name;
    const malformed = Buffer.concat([
      Buffer.from('{"name":"'),
      Buffer.from([0xff]),
      Buffer.from('"}'),
    ]);
    // This endpoint normally expects a small JSON object; malformed bytes must fail before field processing.
    const response = await new Promise<{ status: number; error?: string }>((resolve, reject) => {
      const req = http.request(
        `${base}/api/platform/account`,
        {
          method: 'PATCH',
          headers: {
            Origin: base,
            'Content-Type': 'application/json',
            'Content-Length': malformed.byteLength,
            Cookie: a.cookie,
            'X-CSRF-Token': a.csrf,
            'X-Star-Study-Account': a.id,
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () =>
            resolve({
              status: res.statusCode ?? 0,
              ...JSON.parse(Buffer.concat(chunks).toString()),
            }),
          );
        },
      );
      req.on('error', reject);
      req.end(malformed);
    });
    expect(response.status).toBe(400);
    expect(response.error).toContain('JSON格式错误');
    expect((await request(a, '/session')).body.user.name).toBe(before);
  });
  it('邀请默认、一次性消费、管理员初始化不可重放', async () => {
    expect((await request(empty, '/status')).body.registration).toBe('invite');
    expect(
      (
        await request(empty, '/setup', 'POST', {
          email: 'again@example.test',
          password: 'test-password-12345',
          setupToken: 'test-only-setup-token',
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await request(empty, '/register', 'POST', {
          email: 'no@example.test',
          password: 'test-password-12345',
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await request(empty, '/register', 'POST', {
          email: 'reused@example.test',
          password: 'test-password-12345',
          invite: usedInvite,
        })
      ).status,
    ).toBe(403);
  });
  it('A和B拥有独立数据，无法请求他人数据或管理员接口，CSRF被拒绝', async () => {
    const da = await request(a, '/data'),
      db = await request(b, '/data');
    expect(da.status).toBe(200);
    expect(da.body.backup.data.userProfiles[0].id).not.toBe(db.body.backup.data.userProfiles[0].id);
    expect(
      (await request(a, '/data', 'GET', undefined, { 'X-Star-Study-Account': b.id })).status,
    ).toBe(409);
    expect((await request(a, `/data?ownerId=${b.id}`)).body.backup.data.userProfiles[0].id).toBe(
      da.body.backup.data.userProfiles[0].id,
    );
    expect((await request(a, '/admin')).status).toBe(403);
    expect((await request({ ...a, csrf: '' }, '/data', 'PUT', {})).status).toBe(403);
    const session = await request(a, '/session');
    expect(session.body.user.password_hash).toBeUndefined();
    expect(a.cookie).not.toContain('test-password');
  });
  it('预览无写入、确认后导入、两个账户独立打卡、重复与过期版本保护', async () => {
    const before = (await request(a, '/data')).body;
    const preview = await request(a, '/plans/preview', 'POST', { plan: sample(), mode: 'merge' });
    expect(preview.status).toBe(200);
    expect(preview.body.errors).toEqual([]);
    expect((await request(a, '/data')).body.backup.data.tasks).toHaveLength(0);
    expect(
      (
        await request(a, '/plans/apply', 'POST', {
          previewId: preview.body.previewId,
          confirmed: false,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await request(b, '/plans/apply', 'POST', {
          previewId: preview.body.previewId,
          confirmed: true,
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await request(a, '/plans/apply', 'POST', {
          previewId: preview.body.previewId,
          confirmed: true,
        })
      ).status,
    ).toBe(200);
    const after = (await request(a, '/data')).body;
    expect(after.backup.data.tasks).toHaveLength(1);
    expect(after.backup.data.tasks[0].id).toMatch(/^[a-f0-9-]{36}$/);
    const duplicate = await request(a, '/plans/preview', 'POST', { plan: sample(), mode: 'merge' });
    expect(duplicate.body.duplicates).toHaveLength(1);
    const backup = after.backup as Backup;
    backup.data.tasks[0].status = 'completed';
    expect((await request(a, '/data', 'PUT', { baseVersion: after.version, backup })).status).toBe(
      200,
    );
    expect(
      (await request(a, '/data', 'PUT', { baseVersion: before.version, backup: before.backup }))
        .status,
    ).toBe(409);
    expect((await request(b, '/data')).body.backup.data.tasks).toHaveLength(0);
    const bp = await request(b, '/plans/preview', 'POST', { plan: sample(), mode: 'merge' });
    expect(
      (await request(b, '/plans/apply', 'POST', { previewId: bp.body.previewId, confirmed: true }))
        .status,
    ).toBe(200);
    const bd = (await request(b, '/data')).body;
    expect(bd.backup.data.tasks[0].id).not.toBe(backup.data.tasks[0].id);
    bd.backup.data.tasks[0].status = 'completed';
    expect(
      (await request(b, '/data', 'PUT', { baseVersion: bd.version, backup: bd.backup })).status,
    ).toBe(200);
    expect((await request(a, '/data')).body.backup.data.tasks[0].id).toBe(backup.data.tasks[0].id);
  });
  it('400天分片可合并、严格校验日期/字段/预算/依赖/不安全URL，失败不污染数据', () => {
    const current = initialBackup(),
      first = previewStudyPlan(sample(200), current, 'merge', randomUUID);
    expect(first.errors).toEqual([]);
    const second = previewStudyPlan(sample(201, 200), first.after, 'merge', randomUUID);
    expect(second.after.data.tasks).toHaveLength(401);
    expect(second.errors).toEqual([]);
    expect(previewStudyPlan(sample(201, 200), second.after, 'merge', randomUUID).added).toBe(0);
    expect(parsePlanText('```json\n' + JSON.stringify(sample()) + '\n```').tasks).toHaveLength(1);
    expect(() => parsePlanText(JSON.stringify({ ...sample(), unexpected: 'no' }))).toThrow();
    expect(() => parsePlanText(JSON.stringify({ ...sample(), startDate: '2027-02-30' }))).toThrow();
    const over = sample();
    over.tasks[0].estimatedMinutes = 700;
    expect(
      previewStudyPlan(over, current, 'merge', randomUUID).errors.some((s) => s.includes('超过')),
    ).toBe(true);
    const bad = sample();
    bad.tasks[0].resourceIds = ['missing'];
    expect(
      previewStudyPlan(bad, current, 'merge', randomUUID).errors.some((s) => s.includes('不存在')),
    ).toBe(true);
    expect(current.data.tasks).toHaveLength(0);
  });
  it('服务端事务回滚及真实计时保护', async () => {
    const before = await request(a, '/data');
    const bad = structuredClone(before.body.backup);
    bad.data.tasks[0].subjectId = randomUUID();
    expect(
      (await request(a, '/data', 'PUT', { baseVersion: before.body.version, backup: bad })).status,
    ).toBeGreaterThanOrEqual(400);
    expect((await request(a, '/data')).body.version).toBe(before.body.version);
    try {
      await db.transaction(async (tx) => {
        await tx.query(sql`update users set name='should-rollback' where id=${a.id}`);
        throw new Error('test');
      });
    } catch {}
    expect((await request(a, '/session')).body.user.name).not.toBe('should-rollback');
  });
  it('没有密钥可正常用其他功能；AI开关、BYOK脱敏、超时/无效密钥、非法输出拦截', async () => {
    expect((await request(a, '/ai/call', 'POST', { kind: 'plan', prompt: 'test' })).status).toBe(
      503,
    );
    expect((await request(a, '/ai/key', 'POST', { key: 'synthetic-test-only-key' })).status).toBe(
      200,
    );
    const status = await request(a, '/ai/status');
    expect(JSON.stringify(status.body)).not.toContain('synthetic-test-only-key');
    expect(status.body.byok.configured).toBe(true);
    await request(a, '/ai/key', 'DELETE', {});
    await expect(
      callProvider(
        'deepseek',
        'synthetic',
        'test',
        {},
        async () => new Response('{}', { status: 401 }),
      ),
    ).rejects.toThrow('密钥无效');
    await expect(
      callProvider('deepseek', 'synthetic', 'test', {}, async () => {
        throw new Error('timeout');
      }),
    ).rejects.toThrow('超时');
  });
  it('既有计时不能删除、缩短、重新归属或篡改，失败版本不变化', async () => {
    const initial = (await request(a, '/data')).body,
      stamp = new Date().toISOString(),
      id = randomUUID();
    initial.backup.data.sessions.push({
      id,
      createdAt: stamp,
      updatedAt: stamp,
      taskId: initial.backup.data.tasks[0].id,
      state: 'ended',
      segments: [{ startedAt: 1000, endedAt: 61000 }],
    });
    expect(
      (await request(a, '/data', 'PUT', { baseVersion: initial.version, backup: initial.backup }))
        .status,
    ).toBe(200);
    const stored = (await request(a, '/data')).body;
    for (const change of [
      (backup: Backup) => {
        backup.data.sessions = [];
      },
      (backup: Backup) => {
        backup.data.sessions[0].segments[0].endedAt = 60000;
      },
      (backup: Backup) => {
        backup.data.sessions[0].segments.push({ startedAt: 62000, endedAt: 63000 });
      },
    ]) {
      const backup = structuredClone(stored.backup);
      change(backup);
      expect(
        (await request(a, '/data', 'PUT', { baseVersion: stored.version, backup })).status,
      ).toBe(409);
    }
    expect((await request(a, '/data')).body.version).toBe(stored.version);
  });
  it('最后管理员不能停用或降级；禁用立即撤销会话，不能借普通接口提权', async () => {
    expect(
      (
        await request(admin, '/admin/user', 'PATCH', {
          id: admin.id,
          role: 'user',
          disabled: false,
        })
      ).status,
    ).toBe(409);
    expect((await request(a, '/account', 'PATCH', { name: 'A', role: 'admin' })).status).toBe(400);
    expect(
      (await request(admin, '/admin/user', 'PATCH', { id: b.id, role: 'user', disabled: true }))
        .status,
    ).toBe(200);
    expect((await request(b, '/data')).status).toBe(401);
    expect(
      (await request(admin, '/admin/user', 'PATCH', { id: b.id, role: 'user', disabled: false }))
        .status,
    ).toBe(200);
    expect((await request(b, '/data')).status).toBe(401);
  });
  it('服务端恢复只有所属用户明确确认后才可替换学习历史，冲突/未确认/跨账号均不写入', async () => {
    const before = (await request(a, '/data')).body,
      backup = initialBackup();
    expect(before.backup.data.sessions.length).toBeGreaterThan(0);
    const preview = await request(a, '/data/restore/preview', 'POST', { backup });
    expect(preview.status).toBe(200);
    expect(preview.body.baseVersion).toBe(before.version);
    expect(preview.body.counts.find((c: { name: string }) => c.name === 'sessions').current).toBe(
      before.backup.data.sessions.length,
    );
    expect((await request(a, '/data')).body.version).toBe(before.version);
    expect(
      (
        await request(a, '/data/restore/apply', 'POST', {
          previewId: preview.body.previewId,
          confirmed: false,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await request(admin, '/data/restore/apply', 'POST', {
          previewId: preview.body.previewId,
          confirmed: true,
        })
      ).status,
    ).toBe(409);
    const save = await request(a, '/data', 'PUT', {
      baseVersion: before.version,
      backup: before.backup,
    });
    expect(save.status).toBe(200);
    expect(
      (
        await request(a, '/data/restore/apply', 'POST', {
          previewId: preview.body.previewId,
          confirmed: true,
        })
      ).status,
    ).toBe(409);
    expect((await request(a, '/data')).body.version).toBe(save.body.version);
    const fresh = await request(a, '/data/restore/preview', 'POST', { backup });
    const applied = await request(a, '/data/restore/apply', 'POST', {
      previewId: fresh.body.previewId,
      confirmed: true,
    });
    expect(applied.status).toBe(200);
    const restored = (await request(a, '/data')).body;
    expect(restored.backup.data.tasks).toHaveLength(0);
    expect(restored.backup.data.sessions).toHaveLength(0);
    const copies = await db.query(sql`select payload from recovery_copies where owner_id=${a.id}`);
    expect(
      copies.some(
        (c) => (c.payload as Backup).data.sessions.length === before.backup.data.sessions.length,
      ),
    ).toBe(true);
    expect(
      (
        await request(a, '/data/restore/apply', 'POST', {
          previewId: fresh.body.previewId,
          confirmed: true,
        })
      ).status,
    ).toBe(409);
  });
  it('其他设备有未结束计时时，恢复预览被阻止且不会改动真实记录', async () => {
    const before = (await request(a, '/data')).body,
      planPreview = await request(a, '/plans/preview', 'POST', { plan: sample(), mode: 'merge' });
    expect(
      (
        await request(a, '/plans/apply', 'POST', {
          previewId: planPreview.body.previewId,
          confirmed: true,
        })
      ).status,
    ).toBe(200);
    const current = (await request(a, '/data')).body,
      stamp = new Date().toISOString();
    current.backup.data.sessions.push({
      id: randomUUID(),
      createdAt: stamp,
      updatedAt: stamp,
      taskId: current.backup.data.tasks[0].id,
      state: 'paused',
      segments: [{ startedAt: 1000, endedAt: 2000 }],
    });
    expect(
      (await request(a, '/data', 'PUT', { baseVersion: current.version, backup: current.backup }))
        .status,
    ).toBe(200);
    expect(
      (await request(a, '/data/restore/preview', 'POST', { backup: before.backup })).status,
    ).toBe(409);
    expect((await request(a, '/data')).body.backup.data.sessions).toHaveLength(1);
  });
  it('账号删除只级联删除本人的数据；源站校验和安全Cookie真实生效', async () => {
    const invite = await request(admin, '/admin/invite', 'POST', {}),
      c = await register('disposable@example.test', invite.body.code);
    expect(c.cookie).toContain('star_session=');
    const login = await request(empty, '/login', 'POST', {
      email: 'disposable@example.test',
      password: 'test-password-12345',
    });
    expect(login.status).toBe(200);
    const wrongOrigin = await request(
      c,
      '/logout',
      'POST',
      {},
      { Origin: 'https://other.example.test' },
    );
    expect(wrongOrigin.status).toBe(403);
    expect(
      (
        await request(c, '/account', 'DELETE', {
          password: 'test-password-12345',
          confirmation: 'DELETE',
        })
      ).status,
    ).toBe(200);
    expect(await db.query(sql`select id from users where id=${c.id}`)).toHaveLength(0);
    expect(await db.query(sql`select id from study_records where owner_id=${c.id}`)).toHaveLength(
      0,
    );
    expect(
      (
        await request(empty, '/register', 'POST', {
          email: 'revived@example.test',
          name: 'Synthetic',
          password: 'test-password-12345',
          invite: invite.body.code,
        })
      ).status,
    ).toBe(403);
    expect((await request(a, '/data')).status).toBe(200);
  });
});
