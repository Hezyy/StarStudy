import { z } from 'zod';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { Database } from './database';
import { HttpError } from './security';
import { parsePlanText, previewStudyPlan } from '../src/services/study-plan';
import { readData } from './store';
import { validateBackup } from '../src/services/backup';
export const aiRequestSchema = z.strictObject({
  provider: z.enum(['deepseek', 'openai']).default('deepseek'),
  kind: z.enum(['plan', 'adjust', 'review', 'convert', 'explain', 'weakness', 'test']),
  prompt: z.string().min(1).max(60000),
});
export interface AiConfig {
  enabled: boolean;
  callsPerDay: number;
  tokensPerDay: number;
  callsPerMinute: number;
}
export const defaultAi: AiConfig = {
  enabled: false,
  callsPerDay: 10,
  tokensPerDay: 100000,
  callsPerMinute: 3,
};
export interface ProviderResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  model: string;
  usageKnown: boolean;
}
const providerResponse = z.object({
  choices: z
    .array(z.object({ message: z.object({ content: z.string().min(1).max(500000) }) }))
    .min(1),
  usage: z
    .object({
      prompt_tokens: z.number().int().nonnegative().max(10_000_000).optional(),
      completion_tokens: z.number().int().nonnegative().max(10_000_000).optional(),
    })
    .optional(),
});
async function providerBody(response: Response): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new HttpError(502, 'AI未返回可用结果');
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 2_000_000) {
        await reader.cancel();
        throw new HttpError(502, 'AI返回内容过大，请缩短计划范围');
      }
      parts.push(chunk.value);
    }
    const merged = new Uint8Array(size);
    let offset = 0;
    for (const part of parts) {
      merged.set(part, offset);
      offset += part.byteLength;
    }
    return JSON.parse(new TextDecoder().decode(merged));
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(502, 'AI返回格式无效或响应中断，请重试');
  }
}
/** Fixed vendor endpoints prevent user-controlled URL fetching. Secrets never enter results or errors. */
export async function callProvider(
  provider: 'deepseek' | 'openai',
  key: string,
  prompt: string,
  env: Record<string, string | undefined> = process.env,
  fetcher: typeof fetch = fetch,
): Promise<ProviderResult> {
  const model =
    provider === 'deepseek' ? env.DEEPSEEK_MODEL || 'deepseek-flash' : env.OPENAI_CHAT_MODEL;
  if (!model) throw new HttpError(503, '请在服务端配置OPENAI_CHAT_MODEL后使用OpenAI Provider');
  let response: Response;
  try {
    response = await fetcher(
      provider === 'deepseek'
        ? 'https://api.deepseek.com/chat/completions'
        : 'https://api.openai.com/v1/chat/completions',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model,
          messages: [
            {
              role: 'system',
              content:
                '你是星研学习规划助手。只提供建议，不执行代码或修改数据。严格遵守用户给定的时间预算、知识依赖和JSON协议。不编造来源或掌握程度。',
            },
            { role: 'user', content: prompt },
          ],
          ...(provider === 'openai'
            ? { max_completion_tokens: 8000, store: false }
            : { max_tokens: 8000 }),
          stream: false,
        }),
        signal: AbortSignal.timeout(Number(env.AI_TIMEOUT_MS) || 45000),
      },
    );
  } catch {
    throw new HttpError(504, 'AI请求超时或网络不可用，请稍后重试；原学习数据未修改');
  }
  if (!response.ok)
    throw new HttpError(
      response.status === 429 ? 429 : 502,
      response.status === 401
        ? 'AI密钥无效或已失效，请检查配置'
        : 'AI服务暂时不可用，请检查额度后重试',
    );
  const parsed = providerResponse.safeParse(await providerBody(response));
  if (!parsed.success) throw new HttpError(502, 'AI返回格式无效，请稍后重试');
  const body = parsed.data,
    text = body.choices[0].message.content.replaceAll(key, '[REDACTED]');
  return {
    text,
    inputTokens: Math.max(0, Number(body.usage?.prompt_tokens) || 0),
    outputTokens: Math.max(0, Number(body.usage?.completion_tokens) || 0),
    model,
    usageKnown:
      body.usage?.prompt_tokens !== undefined && body.usage?.completion_tokens !== undefined,
  };
}
export class AiService {
  private keys = new Map<
    string,
    { key: string; expires: number; timer: ReturnType<typeof setTimeout> }
  >();
  constructor(
    private db: Database,
    private env: Record<string, string | undefined> = process.env,
    private fetcher: typeof fetch = fetch,
  ) {}
  setKey(session: string, key: string) {
    if (key.length < 10 || key.length > 500 || /[\r\n]/.test(key))
      throw new HttpError(400, '密钥格式无效');
    for (const [id, value] of this.keys) if (value.expires <= Date.now()) this.deleteKey(id);
    if (this.keys.size >= 1000 && !this.keys.has(session))
      throw new HttpError(429, '会话密钥数量已达上限，请稍后重试');
    this.deleteKey(session);
    const expires = Date.now() + 15 * 60000;
    const timer = setTimeout(() => {
      if (this.keys.get(session)?.expires === expires) this.deleteKey(session);
    }, 15 * 60000);
    timer.unref();
    this.keys.set(session, { key, expires, timer });
  }
  deleteKey(session: string) {
    const previous = this.keys.get(session);
    if (previous) clearTimeout(previous.timer);
    this.keys.delete(session);
  }
  keyStatus(session: string) {
    const k = this.keys.get(session);
    if (k && k.expires <= Date.now()) this.deleteKey(session);
    return {
      configured: this.keys.has(session),
      expiresAt: this.keys.get(session)?.expires ?? null,
    };
  }
  async config(): Promise<AiConfig> {
    const row = (await this.db.query(sql`select value from platform_settings where key='ai'`))[0];
    return { ...defaultAi, ...((row?.value as Partial<AiConfig>) ?? {}) };
  }
  async call(owner: string, session: string, input: unknown) {
    const request = aiRequestSchema.parse(input),
      config = await this.config();
    if (!config.enabled)
      throw new HttpError(503, '管理员尚未开启AI。仍可复制提示词到外部AI，再导入计划。');
    this.keyStatus(session);
    const key =
      (request.provider === 'deepseek' ? this.keys.get(session)?.key : undefined) ||
      (request.provider === 'deepseek' ? this.env.DEEPSEEK_API_KEY : this.env.OPENAI_API_KEY);
    if (!key)
      throw new HttpError(503, 'AI密钥尚未配置。可使用15分钟会话密钥，或继续使用外部AI导入。');
    // UTF-8 bytes are a conservative token upper bound, unlike length/2 for Chinese text.
    const id = randomUUID(),
      reservation = 8000 + 512 + new TextEncoder().encode(request.prompt).length;
    await this.db.transaction(async (tx) => {
      await tx.query(sql`select id from users where id=${owner} for update`);
      const [usage] = await tx.query(
        sql`select count(*)::int calls,coalesce(sum(greatest(reserved_tokens,input_tokens+output_tokens)),0)::int tokens,count(*) filter (where created_at>now()-interval '1 minute')::int recent from ai_usage where owner_id=${owner} and created_at>=date_trunc('day',now() at time zone 'Asia/Shanghai') at time zone 'Asia/Shanghai'`,
      );
      if (
        Number(usage.calls) >= config.callsPerDay ||
        Number(usage.tokens) + reservation > config.tokensPerDay ||
        Number(usage.recent) >= config.callsPerMinute
      )
        throw new HttpError(429, '已达到AI调用频率或每日额度限制');
      await tx.query(
        sql`insert into ai_usage(id,owner_id,provider,kind,status,reserved_tokens) values(${id},${owner},${request.provider},${request.kind},'pending',${reservation})`,
      );
    });
    try {
      const result = await callProvider(
        request.provider,
        key,
        request.kind === 'test' ? '请仅回答连接成功。' : request.prompt,
        this.env,
        this.fetcher,
      );
      // Plan generation/conversion is rejected unless it passes exactly the same deterministic parser.
      if (request.kind === 'plan' || request.kind === 'convert') {
        const plan = parsePlanText(result.text),
          current = await readData(this.db, owner);
        const preview = previewStudyPlan(plan, current.backup, 'merge', randomUUID);
        if (preview.errors.length)
          throw new HttpError(
            422,
            `AI计划未通过业务校验：${preview.errors.slice(0, 3).join('；')}。没有导入任何任务。`,
          );
        validateBackup(preview.after);
      }
      const inputPrice = Number(this.env.AI_INPUT_PRICE_PER_MILLION) || 0,
        outputPrice = Number(this.env.AI_OUTPUT_PRICE_PER_MILLION) || 0;
      const microCost = Math.round(
        result.inputTokens * inputPrice + result.outputTokens * outputPrice,
      );
      await this.db.query(
        sql`update ai_usage set status='success',input_tokens=${result.inputTokens},output_tokens=${result.outputTokens},reserved_tokens=${result.usageKnown ? 0 : reservation},estimated_micro_cost=${microCost} where id=${id} and owner_id=${owner}`,
      );
      return {
        ...result,
        costEstimateConfigured: result.usageKnown && (inputPrice > 0 || outputPrice > 0),
        estimatedCost: microCost / 1000000,
      };
    } catch (e) {
      await this.db.query(
        sql`update ai_usage set status='failed' where id=${id} and owner_id=${owner}`,
      );
      if (e instanceof HttpError) throw e;
      throw new HttpError(
        502,
        'AI返回的计划不符合星研格式，请缩短范围后重新生成；没有导入任何任务',
      );
    }
  }
}
