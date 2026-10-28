import { z } from 'zod';
const configSchema = z.object({
  ai: z.object({ configured: z.boolean(), model: z.string().nullable() }),
  cloud: z.object({ configured: z.boolean(), url: z.string(), publicKey: z.string() }),
});
export type IntegrationConfig = z.infer<typeof configSchema>;
export const emptyConfig: IntegrationConfig = {
  ai: { configured: false, model: null },
  cloud: { configured: false, url: '', publicKey: '' },
};
export async function integrationStatus(): Promise<IntegrationConfig> {
  try {
    const r = await fetch('/api/integrations', { cache: 'no-store' });
    if (r.ok) return configSchema.parse(await r.json());
  } catch {}
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
  return { ...emptyConfig, cloud: { configured: !!(url && key), url, publicKey: key } };
}
export async function requestAi(kind: 'plan' | 'mistake', context: unknown, accessToken: string) {
  if (!accessToken.trim()) throw new Error('请填写服务端AI网关的访问口令，不是OpenAI密钥');
  const r = await fetch('/api/ai', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ kind, context }),
    signal: AbortSignal.timeout(50000),
  });
  const body = await r.json().catch(() => ({ error: 'AI网关不可用，请检查服务端配置' }));
  if (!r.ok) throw new Error(body.error ?? `请求失败 ${r.status}`);
  return z.object({ text: z.string(), model: z.string() }).parse(body);
}
