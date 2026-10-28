import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { embeddedDatabase, type Database } from '../../server/database';
import { AiService, callProvider } from '../../server/ai';
import { seedData, readData } from '../../server/store';
import { platformApi } from '../../server/api';
import { parsePlanText } from '@/services/study-plan';
let db: Database;
async function owner() {
  const id = randomUUID();
  await db.transaction(async (tx) => {
    await tx.query(
      sql`insert into users(id,email,name,password_hash) values(${id},${`${id}@example.test`},'合成测试用户','not-a-real-password')`,
    );
    await seedData(tx, id);
  });
  return id;
}
async function aiConfig(calls = 10, tokens = 100000, minute = 10) {
  await db.query(
    sql`insert into platform_settings(key,value) values('ai',${JSON.stringify({ enabled: true, callsPerDay: calls, tokensPerDay: tokens, callsPerMinute: minute })}::jsonb) on conflict(key) do update set value=excluded.value`,
  );
}
const completion = (text: string) =>
  new Response(
    JSON.stringify({
      choices: [{ message: { content: text } }],
      usage: { prompt_tokens: 20, completion_tokens: 40 },
    }),
    { status: 200 },
  );
beforeAll(async () => {
  db = await embeddedDatabase();
});
afterAll(async () => {
  await db.close();
});
describe('AI安全与额度（隔离假传输，未调用真实服务商）', () => {
  it('可选OpenAI Provider需明确配置模型，使用官方完成Token参数且不储存响应', async () => {
    let sent: Record<string, unknown> = {};
    await expect(
      callProvider('openai', 'synthetic-test-key', 'test', {}, async () => completion('ok')),
    ).rejects.toThrow('OPENAI_CHAT_MODEL');
    const result = await callProvider(
      'openai',
      'synthetic-test-key',
      'test',
      { OPENAI_CHAT_MODEL: 'synthetic-model' },
      async (_url, init) => {
        sent = JSON.parse(String(init?.body));
        return completion('ok');
      },
    );
    expect(result.text).toBe('ok');
    expect(sent.max_completion_tokens).toBe(8000);
    expect(sent.max_tokens).toBeUndefined();
    expect(sent.store).toBe(false);
  });
  it('严格请求字段、无密钥与管理员开关都在发送前拒绝', async () => {
    const id = await owner();
    let calls = 0;
    const ai = new AiService(db, {}, async () => {
      calls++;
      return completion('建议');
    });
    await expect(
      ai.call(id, 's', { kind: 'explain', prompt: 'test', unexpected: 'secret' }),
    ).rejects.toThrow();
    await expect(ai.call(id, 's', { kind: 'explain', prompt: 'test' })).rejects.toThrow('尚未开启');
    await aiConfig();
    await expect(ai.call(id, 's', { kind: 'explain', prompt: 'test' })).rejects.toThrow('尚未配置');
    expect(calls).toBe(0);
  });
  it('非法模型JSON和超预算结果不进入学习表；有效结果也必须单独预览确认才能写库', async () => {
    await aiConfig();
    const id = await owner(),
      plan = parsePlanText(readFileSync('public/templates/study-plan.minimal.json', 'utf8'));
    let text = '这不是JSON';
    const ai = new AiService(db, { DEEPSEEK_API_KEY: 'synthetic-provider-key' }, async () =>
      completion(text),
    );
    await expect(ai.call(id, 's', { kind: 'plan', prompt: 'test' })).rejects.toThrow(
      '不符合星研格式',
    );
    plan.tasks[0].estimatedMinutes = 700;
    text = JSON.stringify(plan);
    await expect(ai.call(id, 's', { kind: 'plan', prompt: 'test' })).rejects.toThrow('超过');
    plan.tasks[0].estimatedMinutes = 30;
    text = JSON.stringify(plan);
    const response = await ai.call(id, 's', { kind: 'plan', prompt: 'test' });
    expect(JSON.parse(response.text).schemaVersion).toBe('1.0.0');
    expect((await readData(db, id)).backup.data.tasks).toHaveLength(0);
    const rows = await db.query(sql`select status from ai_usage where owner_id=${id}`);
    expect(rows.filter((r) => r.status === 'failed')).toHaveLength(2);
    expect(rows.filter((r) => r.status === 'success')).toHaveLength(1);
  });
  it('同一用户并发请求不能绕过每日额度，其他用户独立计量', async () => {
    await aiConfig(1);
    const id = await owner(),
      other = await owner();
    let calls = 0;
    const ai = new AiService(db, { DEEPSEEK_API_KEY: 'synthetic-provider-key' }, async () => {
      calls++;
      return completion('建议');
    });
    const results = await Promise.allSettled([
      ai.call(id, 's', { kind: 'explain', prompt: 'test' }),
      ai.call(id, 's', { kind: 'explain', prompt: 'test' }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    expect(calls).toBe(1);
    await ai.call(other, 's2', { kind: 'explain', prompt: 'test' });
    expect(calls).toBe(2);
  });
  it('中文输入按保守预算预留，失败请求保留额度并限制后续请求', async () => {
    await aiConfig(10, 1000);
    const id = await owner();
    let sent = 0;
    const ai = new AiService(db, { DEEPSEEK_API_KEY: 'synthetic-provider-key' }, async () => {
      sent++;
      return completion('建议');
    });
    await expect(ai.call(id, 's', { kind: 'explain', prompt: '学习计划' })).rejects.toThrow('额度');
    expect(sent).toBe(0);
    await aiConfig(1);
    const failed = new AiService(
      db,
      { DEEPSEEK_API_KEY: 'synthetic-provider-key' },
      async () => new Response('{}', { status: 401 }),
    );
    await expect(failed.call(id, 's', { kind: 'explain', prompt: '学习计划' })).rejects.toThrow(
      '密钥无效',
    );
    await expect(failed.call(id, 's', { kind: 'explain', prompt: '学习计划' })).rejects.toThrow(
      '额度',
    );
  });
  it('BYOK跨会话不可用、删除和15分钟到期生效；密钥不会出现在结果或错误里', async () => {
    await aiConfig();
    const id = await owner(),
      secret = 'synthetic-short-lived-secret';
    let sent = 0;
    const ai = new AiService(db, {}, async () => {
      sent++;
      return completion(`建议 ${secret}`);
    });
    ai.setKey('a', secret);
    expect(ai.keyStatus('a').configured).toBe(true);
    expect(ai.keyStatus('b').configured).toBe(false);
    await expect(ai.call(id, 'b', { kind: 'explain', prompt: 'test' })).rejects.toThrow('尚未配置');
    const response = await ai.call(id, 'a', { kind: 'explain', prompt: 'test' });
    expect(response.text).not.toContain(secret);
    expect(response.text).toContain('[REDACTED]');
    ai.deleteKey('a');
    expect(ai.keyStatus('a').configured).toBe(false);
    expect(sent).toBe(1);
    ai.setKey('expiry', secret);
    const original = Date.now;
    try {
      Date.now = () => original() + 16 * 60000;
      expect(ai.keyStatus('expiry').configured).toBe(false);
    } finally {
      Date.now = original;
    }
  });
  it('服务商异常JSON、非文本结果、大响应以及网络超时返回可处理错误', async () => {
    await expect(
      callProvider('deepseek', 'synthetic', 'test', {}, async () => new Response('not json')),
    ).rejects.toThrow('格式无效');
    await expect(
      callProvider(
        'deepseek',
        'synthetic',
        'test',
        {},
        async () =>
          new Response(JSON.stringify({ choices: [{ message: { content: { not: 'text' } } }] })),
      ),
    ).rejects.toThrow('格式无效');
    await expect(
      callProvider(
        'deepseek',
        'synthetic',
        'test',
        {},
        async () => new Response('x'.repeat(2_000_001)),
      ),
    ).rejects.toThrow('过大');
    await expect(
      callProvider('deepseek', 'synthetic', 'test', {}, async () => {
        throw new Error('synthetic upstream secret');
      }),
    ).rejects.toThrow('超时');
    const start = Date.now();
    await expect(
      callProvider(
        'deepseek',
        'synthetic',
        'test',
        { AI_TIMEOUT_MS: '20' },
        async (_url, options) =>
          new Promise<Response>((_resolve, reject) => {
            options?.signal?.addEventListener('abort', () => reject(new Error('aborted')), {
              once: true,
            });
          }),
      ),
    ).rejects.toThrow('超时');
    expect(Date.now() - start).toBeLessThan(1000);
  });
  it('服务商未报告token数时保留预留额度，不能借缺失usage绕过预算', async () => {
    await aiConfig(10, 20000, 10);
    const id = await owner();
    const service = new AiService(
      db,
      { DEEPSEEK_API_KEY: 'synthetic-provider-key' },
      async () => new Response(JSON.stringify({ choices: [{ message: { content: '建议' } }] })),
    );
    const input = { kind: 'explain', prompt: 'test' };
    expect((await service.call(id, 's', input)).usageKnown).toBe(false);
    await service.call(id, 's', input);
    await expect(service.call(id, 's', input)).rejects.toThrow('额度');
  });
  it('公网HTTP被禁止，HTTPS及明确回环测试可初始化API', () => {
    const secret = 'synthetic-session-secret-'.repeat(3);
    expect(() =>
      platformApi(db, {
        SESSION_SECRET: secret,
        PUBLIC_URL: 'http://example.com',
        ALLOW_INSECURE_LOCAL: '1',
      }),
    ).toThrow('HTTPS');
    expect(() =>
      platformApi(db, { SESSION_SECRET: secret, PUBLIC_URL: 'https://example.com' }),
    ).not.toThrow();
    expect(() =>
      platformApi(db, {
        SESSION_SECRET: secret,
        PUBLIC_URL: 'http://127.0.0.1:9999',
        ALLOW_INSECURE_LOCAL: '1',
      }),
    ).not.toThrow();
  });
});
