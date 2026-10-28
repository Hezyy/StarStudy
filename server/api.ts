import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { z, ZodError } from 'zod';
import type { Database, Row } from './database';
import {
  HttpError,
  token,
  hash,
  equal,
  csrf,
  passwordHash,
  passwordMatches,
  Limiter,
} from './security';
import { readData, writeData, seedData } from './store';
import { AiService } from './ai';
import { previewStudyPlan } from '../src/services/study-plan';
import { importModeSchema } from '../src/schemas/study-plan';
import type { PlanPreview } from '../src/services/study-plan';
import { validateBackup, type Backup } from '../src/services/backup';
import { TABLE_NAMES } from '../src/types';
const credentials = z.strictObject({
  email: z
    .string()
    .trim()
    .email()
    .max(254)
    .transform((s) => s.toLowerCase()),
  password: z.string().min(12, '密码至少12位').max(128),
  name: z.string().trim().min(1).max(80).optional(),
  invite: z.string().max(100).optional(),
  setupToken: z.string().max(200).optional(),
});
const json = (res: ServerResponse, status: number, value: unknown) => {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(value));
};
const bodyLimits = {
  credentials: 8 * 1024,
  metadata: 16 * 1024,
  ai: 512 * 1024,
  plan: 12 * 1024 * 1024,
  backup: 40_000_000,
};
async function body(req: IncomingMessage, limit = bodyLimits.metadata) {
  if (Number(req.headers['content-length']) > limit)
    throw new HttpError(413, '请求内容过大，请缩小内容或分批导入');
  let length = 0;
  const parts: Buffer[] = [];
  // Do not destroy the HTTP request on an early iterator exit: the caller must still receive a useful 413 response.
  for await (const part of req.iterator({ destroyOnReturn: false })) {
    const chunk = Buffer.isBuffer(part) ? part : Buffer.from(part);
    length += chunk.byteLength;
    if (length > limit) throw new HttpError(413, '请求内容过大，请缩小内容或分批导入');
    parts.push(chunk);
  }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(parts)));
  } catch {
    throw new HttpError(400, '请求JSON格式错误');
  }
}
async function drainRejectedBody(req: IncomingMessage): Promise<boolean> {
  if (req.readableEnded) return true;
  if (req.destroyed) return false;
  return new Promise((resolve) => {
    const finish = (complete: boolean) => {
      clearTimeout(deadline);
      req.off('end', ended);
      req.off('aborted', interrupted);
      req.off('error', interrupted);
      req.off('close', interrupted);
      resolve(complete);
    };
    const ended = () => finish(true);
    const interrupted = () => finish(false);
    // Discard without collecting bytes. A slow or unbounded rejected upload gets a closed connection instead.
    const deadline = setTimeout(interrupted, 2000);
    deadline.unref();
    req.once('end', ended);
    req.once('aborted', interrupted);
    req.once('error', interrupted);
    req.once('close', interrupted);
    req.resume();
  });
}
const publicUser = (u: Row) => ({
  id: String(u.id),
  email: String(u.email),
  name: String(u.name),
  role: String(u.role),
  onboarded: Boolean(u.onboarded),
});
export function platformApi(
  db: Database,
  env: Record<string, string | undefined> = process.env,
  fetcher: typeof fetch = fetch,
) {
  const secret = env.SESSION_SECRET ?? '',
    origin = env.PUBLIC_URL ?? 'http://127.0.0.1:3000';
  if (secret.length < 32) throw new Error('SESSION_SECRET必须至少32字符');
  const publicUrl = new URL(origin),
    secure = publicUrl.protocol === 'https:';
  if (
    !secure &&
    !(
      env.ALLOW_INSECURE_LOCAL === '1' &&
      ['localhost', '127.0.0.1', '[::1]'].includes(publicUrl.hostname)
    )
  )
    throw new Error('账号服务需要HTTPS；测试HTTP仅允许明确启用的回环地址');
  const limiter = new Limiter(),
    ai = new AiService(db, env, fetcher),
    previews = new Map<
      string,
      {
        owner: string;
        base: number;
        preview: PlanPreview;
        expires: number;
        createdRevisions: string[];
      }
    >();
  const restorePreviews = new Map<
    string,
    { owner: string; base: number; backup: Backup; expires: number }
  >();
  const cookie = (raw: string, maxAge = 30 * 86400) =>
    `star_session=${raw}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
  async function authenticate(req: IncomingMessage) {
    const raw = /(?:^|;\s*)star_session=([\w-]+)/.exec(req.headers.cookie ?? '')?.[1];
    if (!raw) throw new HttpError(401, '请先登录');
    const u = (
      await db.query(
        sql`select u.* from users u join auth_sessions s on u.id=s.owner_id where s.token_hash=${hash(raw)} and s.expires_at>now()`,
      )
    )[0];
    if (!u || u.disabled) throw new HttpError(401, '登录已失效，请重新登录');
    if (req.headers['x-star-study-account'] && req.headers['x-star-study-account'] !== u.id)
      throw new HttpError(409, '账号已在另一标签页切换，请刷新后继续；本机数据保留');
    if (
      !['GET', 'HEAD'].includes(req.method ?? 'GET') &&
      !equal(String(req.headers['x-csrf-token'] ?? ''), csrf(raw, secret))
    )
      throw new HttpError(403, '安全校验失效，请刷新后重试');
    return { u, raw };
  }
  async function session(res: ServerResponse, u: Row) {
    const raw = token();
    await db.query(
      sql`insert into auth_sessions(token_hash,owner_id,expires_at) values(${hash(raw)},${u.id},now()+interval '30 days')`,
    );
    res.setHeader('Set-Cookie', cookie(raw));
    return { user: publicUser(u), csrf: csrf(raw, secret) };
  }
  return async (req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> => {
    if (!url.pathname.startsWith('/api/platform/')) return false;
    try {
      const route = url.pathname.slice('/api/platform'.length),
        method = req.method ?? 'GET';
      if (!['GET', 'HEAD'].includes(method)) {
        if (req.headers.origin !== publicUrl.origin) throw new HttpError(403, '请求来源不匹配');
        if (
          String(req.headers['content-type']).split(';', 1)[0].trim().toLowerCase() !==
          'application/json'
        )
          throw new HttpError(415, '请使用JSON请求');
      }
      if (route === '/status' && method === 'GET') {
        const [{ count }] = await db.query(sql`select count(*)::int count from users`);
        const setting = (
          await db.query(sql`select value from platform_settings where key='registration'`)
        )[0];
        json(res, 200, {
          enabled: true,
          setupRequired: Number(count) === 0,
          registration: setting?.value ?? 'invite',
          version: '0.4.0',
          database: 'postgresql',
        });
        return true;
      }
      if (route === '/health' && method === 'GET') {
        await db.query(sql`select 1`);
        json(res, 200, { ok: true, version: '0.4.0' });
        return true;
      }
      if (['/setup', '/register', '/login'].includes(route) && method === 'POST') {
        limiter.take(`auth:${hash(req.socket.remoteAddress ?? 'unknown')}`, 60, 15 * 60000);
        const input = credentials.parse(await body(req, bodyLimits.credentials));
        let u: Row;
        limiter.take(`auth-account:${hash(input.email)}`, 8, 15 * 60000);
        if (route === '/login') {
          const found = (await db.query(sql`select * from users where email=${input.email}`))[0];
          // Equal-cost fallback prevents fast account enumeration.
          const fallback = `scrypt$00000000000000000000000000000000$${'0'.repeat(128)}`;
          if (
            !(await passwordMatches(input.password, String(found?.password_hash ?? fallback))) ||
            !found ||
            found.disabled
          )
            throw new HttpError(401, '邮箱或密码不正确，或账号已停用');
          u = found;
        } else {
          // The secret setup gate is cheap; unauthenticated invalid tokens must never trigger scrypt.
          if (
            route === '/setup' &&
            (!env.SETUP_TOKEN || !equal(input.setupToken ?? '', env.SETUP_TOKEN))
          )
            throw new HttpError(403, '初始化口令无效或管理员已创建');
          const pw = await passwordHash(input.password),
            id = randomUUID();
          u = await db.transaction(async (tx) => {
            // Transaction advisory lock serializes first-admin creation and invitation consumption.
            await tx.query(sql`select pg_advisory_xact_lock(798124)`);
            const [{ count }] = await tx.query(sql`select count(*)::int count from users`),
              first = Number(count) === 0;
            if (route === '/setup') {
              if (!first || !env.SETUP_TOKEN || !equal(input.setupToken ?? '', env.SETUP_TOKEN))
                throw new HttpError(403, '初始化口令无效或管理员已创建');
            } else {
              if (first) throw new HttpError(403, '请先由部署者初始化管理员');
              const setting = (
                await tx.query(sql`select value from platform_settings where key='registration'`)
              )[0];
              if (setting?.value !== 'public') {
                const invite = (
                  await tx.query(
                    sql`select * from invitations where token_hash=${hash(input.invite ?? '')} and used_by is null and expires_at>now() for update`,
                  )
                )[0];
                if (!invite) throw new HttpError(403, '邀请码无效、过期或已使用');
                // Mark after user insert due to foreign key.
              }
            }
            if ((await tx.query(sql`select id from users where email=${input.email}`)).length)
              throw new HttpError(409, '此邮箱无法注册，请使用登录或联系管理员');
            const [created] = await tx.query(
              sql`insert into users(id,email,name,password_hash,role) values(${id},${input.email},${input.name ?? '研途同行者'},${pw},${route === '/setup' ? 'admin' : 'user'}) returning *`,
            );
            // Remove a consumed token: SET NULL on a deleted invitee must never revive a one-use invitation.
            if (input.invite)
              await tx.query(
                sql`delete from invitations where token_hash=${hash(input.invite)} and used_by is null`,
              );
            await seedData(tx, id);
            if (route === '/setup')
              await tx.query(
                sql`insert into platform_settings(key,value) values('registration',${JSON.stringify(env.INITIAL_REGISTRATION === 'public' ? 'public' : 'invite')}::jsonb) on conflict(key) do nothing`,
              );
            return created;
          });
        }
        json(res, 200, await session(res, u));
        return true;
      }
      const { u, raw } = await authenticate(req),
        owner = String(u.id);
      if (route === '/session' && method === 'GET') {
        json(res, 200, { user: publicUser(u), csrf: csrf(raw, secret) });
        return true;
      }
      if (route === '/logout' && method === 'POST') {
        await db.query(
          sql`delete from auth_sessions where token_hash=${hash(raw)} and owner_id=${owner}`,
        );
        ai.deleteKey(hash(raw));
        res.setHeader('Set-Cookie', cookie('', 0));
        json(res, 200, { ok: true });
        return true;
      }
      if (route === '/account' && method === 'PATCH') {
        const input = z
          .strictObject({
            name: z.string().trim().min(1).max(80),
            onboarded: z.boolean().optional(),
          })
          .parse(await body(req));
        await db.query(
          sql`update users set name=${input.name},onboarded=${input.onboarded ?? u.onboarded} where id=${owner}`,
        );
        json(res, 200, { ok: true });
        return true;
      }
      if (route === '/password' && method === 'POST') {
        limiter.take(`pw:${owner}`, 5, 15 * 60000);
        const input = z
          .strictObject({ current: z.string().max(128), next: z.string().min(12).max(128) })
          .parse(await body(req));
        if (!(await passwordMatches(input.current, String(u.password_hash))))
          throw new HttpError(403, '当前密码不正确');
        await db.transaction(async (tx) => {
          await tx.query(
            sql`update users set password_hash=${await passwordHash(input.next)} where id=${owner}`,
          );
          await tx.query(
            sql`delete from auth_sessions where owner_id=${owner} and token_hash<>${hash(raw)}`,
          );
        });
        json(res, 200, { ok: true });
        return true;
      }
      if (route === '/account' && method === 'DELETE') {
        const input = z
          .strictObject({ password: z.string().max(128), confirmation: z.literal('DELETE') })
          .parse(await body(req));
        if (!(await passwordMatches(input.password, String(u.password_hash))))
          throw new HttpError(403, '密码不正确');
        const removedSessions = await db.transaction(async (tx) => {
          await tx.query(sql`select pg_advisory_xact_lock(798124)`);
          // Re-read under the same lock used for role changes; the authenticated snapshot can be stale.
          const [currentUser] = await tx.query(
            sql`select role from users where id=${owner} for update`,
          );
          if (!currentUser) throw new HttpError(401, '账号已不存在');
          if (currentUser.role === 'admin') {
            const [{ count }] = await tx.query(
              sql`select count(*)::int count from users where role='admin' and disabled=false`,
            );
            if (Number(count) <= 1)
              throw new HttpError(409, '不能删除最后一位管理员，请先指定其他管理员');
          }
          const sessionRows = await tx.query(
            sql`select token_hash from auth_sessions where owner_id=${owner}`,
          );
          await tx.query(sql`delete from invitations where used_by=${owner}`);
          await tx.query(sql`delete from users where id=${owner}`);
          return sessionRows;
        });
        for (const session of removedSessions) ai.deleteKey(String(session.token_hash));
        for (const [key, value] of previews) if (value.owner === owner) previews.delete(key);
        for (const [key, value] of restorePreviews)
          if (value.owner === owner) restorePreviews.delete(key);
        res.setHeader('Set-Cookie', cookie('', 0));
        json(res, 200, { ok: true });
        return true;
      }
      if (route === '/data/version' && method === 'GET') {
        json(
          res,
          200,
          (
            await db.query(
              sql`select version,updated_at from data_versions where owner_id=${owner}`,
            )
          )[0],
        );
        return true;
      }
      if (route === '/data' && method === 'GET') {
        json(res, 200, await readData(db, owner));
        return true;
      }
      if (route === '/data' && method === 'PUT') {
        const input = z
          .strictObject({ baseVersion: z.number().int().nonnegative(), backup: z.unknown() })
          .parse(await body(req, bodyLimits.backup));
        json(
          res,
          200,
          await db.transaction((tx) => writeData(tx, owner, input.backup, input.baseVersion)),
        );
        return true;
      }
      if (route === '/data/restore/preview' && method === 'POST') {
        limiter.take(`restore-preview:${owner}`, 5, 60000);
        const input = z
          .strictObject({ backup: z.unknown() })
          .parse(await body(req, bodyLimits.backup));
        let backup: Backup;
        try {
          backup = validateBackup(input.backup);
        } catch (error) {
          throw new HttpError(
            400,
            error instanceof Error
              ? `备份校验失败：${error.message.slice(0, 600)}`
              : '备份格式无效',
          );
        }
        const current = await readData(db, owner);
        if (current.backup.data.sessions.some((s) => s.state !== 'ended'))
          throw new HttpError(409, '账户在其他设备仍有未结束计时，请先结束后再恢复');
        for (const [key, value] of restorePreviews)
          if (value.owner === owner || value.expires < Date.now()) restorePreviews.delete(key);
        if (restorePreviews.size >= 16) throw new HttpError(429, '当前恢复预览较多，请稍后重试');
        const previewId = token();
        restorePreviews.set(previewId, {
          owner,
          base: current.version,
          backup,
          expires: Date.now() + 15 * 60000,
        });
        const counts = TABLE_NAMES.map((name) => {
          const ids = new Set(current.backup.data[name].map((record) => record.id));
          return {
            name,
            current: current.backup.data[name].length,
            incoming: backup.data[name].length,
            conflicts: backup.data[name].filter((record) => ids.has(record.id)).length,
          };
        });
        json(res, 200, { previewId, baseVersion: current.version, counts });
        return true;
      }
      if (route === '/data/restore/apply' && method === 'POST') {
        const input = z
            .strictObject({ previewId: z.string().max(128), confirmed: z.literal(true) })
            .parse(await body(req)),
          item = restorePreviews.get(input.previewId);
        if (!item || item.owner !== owner || item.expires < Date.now())
          throw new HttpError(409, '恢复预览已失效，请重新预览');
        const result = await db.transaction(async (tx) => {
          const current = await readData(tx, owner, true);
          if (current.version !== item.base)
            throw new HttpError(409, '恢复预览后账户数据已变化，请重新预览；原数据保留');
          if (current.backup.data.sessions.some((s) => s.state !== 'ended'))
            throw new HttpError(409, '请先结束账户中的计时，再恢复数据');
          // Only this explicit, owner-bound approval path may replace study history. writeData backs up and rolls back atomically.
          return writeData(tx, owner, item.backup, item.base, false);
        });
        restorePreviews.delete(input.previewId);
        json(res, 200, result);
        return true;
      }
      if (route === '/plans/preview' && method === 'POST') {
        limiter.take(`preview:${owner}`, 10, 60000);
        for (const [k, v] of previews)
          if (v.expires < Date.now() || v.owner === owner) previews.delete(k);
        if (previews.size >= 16) throw new HttpError(429, '当前计划预览较多，请稍后重试');
        const input = z
            .strictObject({ plan: z.unknown(), mode: importModeSchema })
            .parse(await body(req, bodyLimits.plan)),
          current = await readData(db, owner);
        const preview = previewStudyPlan(input.plan, current.backup, input.mode, randomUUID),
          previewId = token();
        // Business previews must also satisfy the actual persisted schema before an approval token exists.
        if (!preview.errors.length) validateBackup(preview.after);
        const oldRevisionIds = new Set(current.backup.data.revisions.map((r) => r.id));
        previews.set(previewId, {
          owner,
          base: current.version,
          preview,
          expires: Date.now() + 15 * 60000,
          createdRevisions: preview.after.data.revisions
            .filter((r) => !oldRevisionIds.has(r.id))
            .map((r) => r.id),
        });
        const { after, ...view } = preview;
        void after;
        json(res, 200, { ...view, previewId, baseVersion: current.version });
        return true;
      }
      if (route === '/plans/apply' && method === 'POST') {
        const input = z
            .strictObject({ previewId: z.string().max(128), confirmed: z.literal(true) })
            .parse(await body(req)),
          item = previews.get(input.previewId);
        if (!item || item.owner !== owner || item.expires < Date.now())
          throw new HttpError(409, '预览已失效，请重新校验');
        if (item.preview.errors.length) throw new HttpError(400, '请先修正预览中的问题');
        const approvedAt = new Date().toISOString();
        for (const revision of item.preview.after.data.revisions)
          if (item.createdRevisions.includes(revision.id)) {
            revision.approvedAt = approvedAt;
            revision.updatedAt = approvedAt;
          }
        const result = await db.transaction((tx) =>
          writeData(tx, owner, item.preview.after, item.base),
        );
        previews.delete(input.previewId);
        json(res, 200, result);
        return true;
      }
      if (route === '/ai/status' && method === 'GET') {
        json(res, 200, {
          ...(await ai.config()),
          adminKeyConfigured: !!env.DEEPSEEK_API_KEY,
          byok: ai.keyStatus(hash(raw)),
          usage: await db.query(
            sql`select provider,kind,status,input_tokens,output_tokens,estimated_micro_cost,created_at from ai_usage where owner_id=${owner} order by created_at desc limit 30`,
          ),
        });
        return true;
      }
      if (route === '/ai/key' && method === 'POST') {
        const input = z.strictObject({ key: z.string() }).parse(await body(req));
        ai.setKey(hash(raw), input.key);
        json(res, 200, ai.keyStatus(hash(raw)));
        return true;
      }
      if (route === '/ai/key' && method === 'DELETE') {
        ai.deleteKey(hash(raw));
        json(res, 200, { ok: true });
        return true;
      }
      if (route === '/ai/call' && method === 'POST') {
        json(res, 200, await ai.call(owner, hash(raw), await body(req, bodyLimits.ai)));
        return true;
      }
      if (route.startsWith('/admin')) {
        if (u.role !== 'admin') throw new HttpError(403, '需要管理员权限');
        if (route === '/admin' && method === 'GET') {
          json(res, 200, {
            users: await db.query(
              sql`select id,email,name,role,disabled,created_at from users order by created_at`,
            ),
            settings: await db.query(sql`select key,value from platform_settings`),
            ai: await ai.config(),
            health: {
              database: true,
              version: '0.4.0',
              backupMetadata: env.LAST_BACKUP_AT ?? '尚未报告，请运行备份脚本',
            },
            events: await db.query(
              sql`select action,created_at from audit_events order by created_at desc limit 50`,
            ),
            usage: await db.query(
              sql`select status,count(*)::int calls,sum(input_tokens+output_tokens)::int tokens,sum(estimated_micro_cost)::bigint estimated_micro_cost from ai_usage group by status`,
            ),
          });
          return true;
        }
        if (route === '/admin/settings' && method === 'PUT') {
          const input = z
            .strictObject({
              registration: z.enum(['invite', 'public']),
              ai: z.strictObject({
                enabled: z.boolean(),
                callsPerDay: z.number().int().min(0).max(1000),
                tokensPerDay: z.number().int().min(0).max(10000000),
                callsPerMinute: z.number().int().min(1).max(20),
              }),
            })
            .parse(await body(req));
          await db.transaction(async (tx) => {
            for (const [key, value] of Object.entries(input))
              await tx.query(
                sql`insert into platform_settings(key,value) values(${key},${JSON.stringify(value)}::jsonb) on conflict(key) do update set value=excluded.value`,
              );
            await tx.query(
              sql`insert into audit_events(id,actor_id,action) values(${randomUUID()},${owner},'admin.settings.updated')`,
            );
          });
          json(res, 200, { ok: true });
          return true;
        }
        if (route === '/admin/invite' && method === 'POST') {
          const code = token();
          await db.query(
            sql`insert into invitations(token_hash,created_by,expires_at) values(${hash(code)},${owner},now()+interval '7 days')`,
          );
          json(res, 200, { code, expiresInDays: 7 });
          return true;
        }
        if (route === '/admin/user' && method === 'PATCH') {
          const input = z
            .strictObject({ id: z.uuid(), disabled: z.boolean(), role: z.enum(['user', 'admin']) })
            .parse(await body(req));
          await db.transaction(async (tx) => {
            await tx.query(sql`select pg_advisory_xact_lock(798124)`);
            const [target] = await tx.query(
              sql`select role,disabled from users where id=${input.id}`,
            );
            if (!target) throw new HttpError(404, '账号不存在');
            if (target.role === 'admin' && (input.disabled || input.role !== 'admin')) {
              const [{ count }] = await tx.query(
                sql`select count(*)::int count from users where role='admin' and disabled=false`,
              );
              if (Number(count) <= 1) throw new HttpError(409, '必须保留至少一位可用管理员');
            }
            await tx.query(
              sql`update users set role=${input.role},disabled=${input.disabled} where id=${input.id}`,
            );
            if (input.disabled)
              await tx.query(sql`delete from auth_sessions where owner_id=${input.id}`);
            await tx.query(
              sql`insert into audit_events(id,actor_id,action) values(${randomUUID()},${owner},'admin.account.updated')`,
            );
          });
          json(res, 200, { ok: true });
          return true;
        }
      }
      throw new HttpError(404, '接口不存在');
    } catch (error) {
      const status =
        error instanceof HttpError ? error.status : error instanceof ZodError ? 400 : 500;
      const message =
        error instanceof HttpError
          ? error.message
          : error instanceof ZodError
            ? error.issues
                .slice(0, 3)
                .map((i) => `${i.path.join('.')}：${i.message}`)
                .join('；')
            : '服务暂时不可用，请重试或联系部署者';
      if (status === 413) {
        // Closing while a finite upload is still in flight can reset TCP before clients receive the 413.
        // Drain ordinary uploads first so this connection is also safe to reuse for the next request.
        const drained = await drainRejectedBody(req);
        if (res.destroyed) return true;
        if (!drained) res.setHeader('Connection', 'close');
      }
      json(res, status, { error: message });
      return true;
    }
  };
}
