'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { usePlatform } from './platform';
import { useApp } from '@/components/provider';
import { Button } from '@/components/ui/button';
import { useUnsavedChanges } from '@/lib/interaction';

interface Policy {
  enabled: boolean;
  callsPerDay: number;
  tokensPerDay: number;
  callsPerMinute: number;
}
interface AdminData {
  users: { id: string; email: string; name: string; role: 'user' | 'admin'; disabled: boolean }[];
  settings: { key: string; value: unknown }[];
  ai: Policy;
  health: { version: string; database: boolean; backupMetadata: string };
  events: { action: string; created_at: string }[];
  usage: { status: string; calls: number; tokens: number }[];
}
const actionLabels: Record<string, string> = {
  'admin.settings.updated': '更新服务设置',
  'admin.account.updated': '更新账户状态或权限',
};

export function AdminPage() {
  const platform = usePlatform(),
    app = useApp();
  const { request } = platform;
  const { run } = app;
  const [data, setData] = useState<AdminData | null>(null);
  const [registration, setRegistration] = useState('invite'),
    [policy, setPolicy] = useState<Policy | null>(null);
  const [invite, setInvite] = useState(''),
    [error, setError] = useState(''),
    [pending, setPending] = useState<string | null>(null);
  const lock = useRef(false),
    savedPolicy = useRef('');
  const dirty =
    policy !== null && JSON.stringify({ registration, ai: policy }) !== savedPolicy.current;
  useUnsavedChanges(dirty);

  const load = useCallback(
    async (resetForm = true) => {
      const response = await request<AdminData>('/admin');
      setData(response);
      if (resetForm) {
        const mode = String(
          response.settings.find((setting) => setting.key === 'registration')?.value ?? 'invite',
        );
        setRegistration(mode);
        setPolicy(response.ai);
        savedPolicy.current = JSON.stringify({ registration: mode, ai: response.ai });
      }
      setError('');
    },
    [request],
  );
  const act = useCallback(
    async (id: string, operation: () => Promise<unknown>, success?: string) => {
      if (lock.current) return;
      lock.current = true;
      setPending(id);
      setError('');
      try {
        await run(async () => {
          try {
            await operation();
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : '读取失败，请重试。');
            throw cause;
          }
        }, success);
      } finally {
        lock.current = false;
        setPending(null);
      }
    },
    [run],
  );
  useEffect(() => {
    if (platform.user?.role === 'admin') void act('load', () => load());
  }, [platform.user?.id, platform.user?.role, act, load]);

  if (platform.user?.role !== 'admin')
    return (
      <section className="empty-state">
        <h1>服务管理</h1>
        <p>此页面仅供部署管理员使用。服务端会校验每次请求的权限。</p>
      </section>
    );
  const activeAdmins =
    data?.users.filter((user) => user.role === 'admin' && !user.disabled).length ?? 0;
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>服务管理</h1>
          <p>仅显示账户与运行元数据，不读取私人学习内容。</p>
        </div>
        <Button
          variant="secondary"
          loading={pending === 'load'}
          disabled={!!pending}
          onClick={() => {
            if (dirty && !confirm('刷新会重新载入服务设置，尚未保存的设置将丢失。确认继续？'))
              return;
            return act('load', () => load());
          }}
        >
          刷新状态
        </Button>
      </div>
      {error && (
        <p className="warning" role="alert">
          {error}
        </p>
      )}
      {!data && !error && (
        <section className="panel settings-section" aria-busy="true">
          <h2>正在读取服务状态…</h2>
          <p>加载账户与运行元数据。</p>
        </section>
      )}
      {data && policy && (
        <>
          <section className="panel settings-section">
            <h2>服务概况</h2>
            <p>
              {data.users.length}位用户 · 星研{data.health.version} · 数据库
              {data.health.database ? '已连接' : '异常'}
            </p>
            <p>备份状态：{data.health.backupMetadata}</p>
            <p>
              AI：
              {data.usage
                .map(
                  (usage) =>
                    `${({ success: '成功', failed: '失败', pending: '处理中' } as Record<string, string>)[usage.status] ?? usage.status} ${usage.calls}次 / ${usage.tokens ?? 0} tokens`,
                )
                .join('；') || '暂无调用记录'}
            </p>
          </section>
          <form
            className="platform-settings-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (
                registration === 'public' &&
                !confirm('确认将此部署改为公开注册？请先确认HTTPS、容量和备份安排。')
              )
                return;
              void act(
                'settings',
                async () => {
                  await platform.request('/admin/settings', 'PUT', { registration, ai: policy });
                  await load();
                },
                '服务设置已保存',
              );
            }}
          >
            <section className="panel settings-section">
              <h2>注册与邀请</h2>
              <label>
                注册模式
                <select
                  aria-label="注册模式"
                  value={registration}
                  disabled={!!pending}
                  onChange={(event) => setRegistration(event.target.value)}
                >
                  <option value="invite">邀请注册（默认）</option>
                  <option value="public">公开注册</option>
                </select>
              </label>
              <Button
                type="button"
                variant="secondary"
                loading={pending === 'invite'}
                disabled={!!pending}
                onClick={() =>
                  act(
                    'invite',
                    async () => {
                      const response = await platform.request<{ code: string }>(
                        '/admin/invite',
                        'POST',
                        {},
                      );
                      setInvite(response.code);
                    },
                    '邀请码已创建，7天有效且仅可使用一次',
                  )
                }
              >
                创建邀请码
              </Button>
              {invite && (
                <div className="platform-preview">
                  <label>
                    邀请码（仅此时显示）
                    <input readOnly value={invite} autoComplete="off" spellCheck={false} />
                  </label>
                  <div className="button-row">
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() =>
                        app.run(() => navigator.clipboard.writeText(invite), '邀请码已复制')
                      }
                    >
                      复制邀请码
                    </Button>
                    <Button type="button" variant="ghost" onClick={() => setInvite('')}>
                      收起邀请码
                    </Button>
                  </div>
                </div>
              )}
            </section>
            <section className="panel settings-section">
              <h2>AI服务限额</h2>
              <label className="inline-check">
                <input
                  type="checkbox"
                  checked={policy.enabled}
                  disabled={!!pending}
                  onChange={(event) => setPolicy({ ...policy, enabled: event.target.checked })}
                />
                启用AI服务（仍需配置密钥）
              </label>
              <div className="form-grid">
                {(
                  [
                    ['callsPerDay', '每日调用次数', 0, 1000],
                    ['tokensPerDay', '每日Token预算', 0, 10000000],
                    ['callsPerMinute', '每分钟调用次数', 1, 20],
                  ] as const
                ).map(([key, label, minimum, maximum]) => (
                  <label key={key}>
                    {label}
                    <input
                      type="number"
                      required
                      step={1}
                      inputMode="numeric"
                      disabled={!!pending}
                      value={policy[key]}
                      min={minimum}
                      max={maximum}
                      onChange={(event) =>
                        setPolicy({ ...policy, [key]: Number(event.target.value) })
                      }
                    />
                  </label>
                ))}
              </div>
              <p className="hint">
                每日次数或Token预算设为0可阻止调用。额度仅限制此部署，不代表服务商账单。
              </p>
              <div className="button-row">
                <Button
                  type="submit"
                  loading={pending === 'settings'}
                  disabled={!dirty || !!pending}
                >
                  保存服务设置
                </Button>
                {dirty && (
                  <span className="hint" role="status">
                    有未保存的服务设置
                  </span>
                )}
              </div>
            </section>
          </form>
          <section className="panel settings-section">
            <h2>账户管理</h2>
            <p className="hint">始终保留至少一位可用管理员。停用账号会使该用户当前登录失效。</p>
            <div className="management-list">
              {data.users.map((user) => {
                const lastAdmin = user.role === 'admin' && !user.disabled && activeAdmins <= 1;
                return (
                  <article className="platform-user" key={user.id}>
                    <div>
                      <strong>
                        {user.name}
                        {user.id === platform.user?.id ? ' · 当前账户' : ''}
                      </strong>
                      <p>
                        {user.email} · {user.role === 'admin' ? '管理员' : '普通用户'} ·{' '}
                        {user.disabled ? '已停用' : '正常'}
                      </p>
                      {lastAdmin && <small className="hint">当前唯一可用管理员</small>}
                    </div>
                    <div className="button-row">
                      <Button
                        type="button"
                        variant="secondary"
                        loading={pending === `disable:${user.id}`}
                        disabled={!!pending || lastAdmin}
                        onClick={() => {
                          if (
                            !confirm(`确认${user.disabled ? '启用' : '停用'}账号「${user.name}」？`)
                          )
                            return;
                          return act(
                            `disable:${user.id}`,
                            async () => {
                              await platform.request('/admin/user', 'PATCH', {
                                id: user.id,
                                disabled: !user.disabled,
                                role: user.role,
                              });
                              if (user.id === platform.user?.id) await platform.refresh();
                              else await load(false);
                            },
                            '账户状态已更新',
                          );
                        }}
                      >
                        {user.disabled ? '启用' : '停用'}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        loading={pending === `role:${user.id}`}
                        disabled={!!pending || lastAdmin}
                        onClick={() => {
                          if (
                            !confirm(
                              `确认将「${user.name}」设为${user.role === 'admin' ? '普通用户' : '管理员'}？`,
                            )
                          )
                            return;
                          return act(
                            `role:${user.id}`,
                            async () => {
                              await platform.request('/admin/user', 'PATCH', {
                                id: user.id,
                                disabled: user.disabled,
                                role: user.role === 'admin' ? 'user' : 'admin',
                              });
                              if (user.id === platform.user?.id) await platform.refresh();
                              else await load(false);
                            },
                            '权限已更新',
                          );
                        }}
                      >
                        {user.role === 'admin' ? '设为普通用户' : '设为管理员'}
                      </Button>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
          <section className="panel settings-section">
            <h2>脱敏操作记录</h2>
            {data.events.length ? (
              <ul className="platform-usage-list">
                {data.events.map((event, index) => (
                  <li key={index}>
                    <time dateTime={event.created_at}>
                      {new Date(event.created_at).toLocaleString()}
                    </time>
                    <span>{actionLabels[event.action] ?? event.action}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p>暂无管理员操作记录。</p>
            )}
          </section>
        </>
      )}
    </>
  );
}
