import { it, expect, vi } from 'vitest';
import { createServer } from 'node:http';
import { createApiHandler, integrationConfig } from '../../scripts/api.mjs';
it('未配置网关返回503，拒绝跨站请求，不暴露私钥', async () => {
  const handler = createApiHandler({});
  const server = createServer(async (req, res) => {
    await handler(req, res, new URL(req.url!, `http://${req.headers.host}`));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('no address');
    const base = `http://127.0.0.1:${address.port}`;
    const status = await fetch(base + '/api/integrations');
    expect(await status.json()).toMatchObject({
      ai: { configured: false },
      cloud: { configured: false, publicKey: '' },
    });
    expect(
      (
        await fetch(base + '/api/ai', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        })
      ).status,
    ).toBe(503);
    expect(
      (
        await fetch(base + '/api/integrations', {
          headers: { Origin: 'https://unrelated.example' },
        })
      ).status,
    ).toBe(403);
    expect(
      integrationConfig({
        SUPABASE_URL: 'https://project.example',
        SUPABASE_ANON_KEY: 'sb_secret_do_not_expose',
      }).cloud.publicKey,
    ).toBe('');
  } finally {
    await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  }
});
it('已配置网关校验口令、固定上游协议和限流，模型密钥不进入返回值', async () => {
  const upstream = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    expect(_url).toBe('https://api.openai.com/v1/responses');
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer private-test-key');
    const body = JSON.parse(String(init?.body));
    expect(body).toMatchObject({ model: 'configured-model', store: false });
    expect(body.input[1].content).toContain('真实上下文');
    return new Response(
      JSON.stringify({
        output: [{ content: [{ type: 'output_text', text: '这是协议测试结果' }] }],
      }),
      { status: 200 },
    );
  });
  const handler = createApiHandler(
    {
      OPENAI_API_KEY: 'private-test-key',
      OPENAI_MODEL: 'configured-model',
      STAR_STUDY_AI_TOKEN: 'gateway-test-token',
    },
    upstream as typeof fetch,
  );
  const server = createServer(async (req, res) => {
    await handler(req, res, new URL(req.url!, `http://${req.headers.host}`));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  try {
    const a = server.address();
    if (!a || typeof a === 'string') throw new Error('no address');
    const base = `http://127.0.0.1:${a.port}`;
    const send = (token: string, body: unknown) =>
      fetch(base + '/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
    expect((await send('wrong', {})).status).toBe(401);
    expect(upstream).not.toHaveBeenCalled();
    const input = { kind: 'plan', context: { request: '真实上下文' } };
    const response = await send('gateway-test-token', input);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ text: '这是协议测试结果', model: 'configured-model' });
    for (let i = 0; i < 4; i++) expect((await send('gateway-test-token', input)).status).toBe(200);
    expect((await send('gateway-test-token', input)).status).toBe(429);
    expect(upstream).toHaveBeenCalledTimes(5);
  } finally {
    await new Promise<void>((r, j) => server.close((e) => (e ? j(e) : r())));
  }
});
