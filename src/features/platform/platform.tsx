'use client';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { selectDatabase, initialize, db } from '@/db';
import { restoreBackup, createBackup, backupPreview } from '@/services/backup';
import { Button } from '@/components/ui/button';
import { dataHash } from '@/lib/data-hash';
import Link from '@/components/ui/app-link';
import { flushSync } from 'react-dom';
export interface Account {
  id: string;
  email: string;
  name: string;
  role: string;
  onboarded: boolean;
}
interface Platform {
  enabled: boolean;
  user: Account | null;
  csrf: string;
  refresh: () => Promise<void>;
  announce: () => void;
  request: <T = Record<string, unknown>>(
    path: string,
    method?: string,
    data?: unknown,
  ) => Promise<T>;
}
const Context = createContext<Platform>({
  enabled: false,
  user: null,
  csrf: '',
  refresh: async () => {},
  announce: () => {},
  request: async () => {
    throw new Error('未启用账户服务');
  },
});
export const usePlatform = () => useContext(Context);
export function PlatformGate({ children }: { children: ReactNode }) {
  const channel = useRef<BroadcastChannel | null>(null);
  const refreshEpoch = useRef(0);
  const switchScope = useCallback((accountId?: string) => {
    const name = accountId ? `star-study-account-${accountId}` : 'star-study';
    if (db.name === name) return;
    // Unmount all learning components before changing the live database binding.
    flushSync(() => setState((s) => ({ ...s, ready: false })));
    selectDatabase(accountId);
  }, []);
  const [state, setState] = useState<{
    ready: boolean;
    enabled: boolean;
    setup: boolean;
    user: Account | null;
    csrf: string;
    error: string;
  }>({ ready: false, enabled: false, setup: false, user: null, csrf: '', error: '' });
  const request = useCallback(
    async <T,>(path: string, method = 'GET', data?: unknown): Promise<T> => {
      const response = await fetch(`/api/platform${path}`, {
        method,
        credentials: 'same-origin',
        cache: 'no-store',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': state.csrf,
          ...(state.user ? { 'X-Star-Study-Account': state.user.id } : {}),
        },
        ...(data === undefined ? {} : { body: JSON.stringify(data) }),
        signal: AbortSignal.timeout(path === '/ai/call' ? 55000 : 30000),
      });
      const body = await response.json();
      if (!response.ok)
        throw Object.assign(new Error(body.error ?? '请求失败'), { status: response.status });
      return body as T;
    },
    [state.csrf, state.user],
  );
  const refresh = useCallback(async () => {
    const attempt = ++refreshEpoch.current;
    try {
      const response = await fetch('/api/platform/status', {
        cache: 'no-store',
        signal: AbortSignal.timeout(5000),
      });
      if (attempt !== refreshEpoch.current) return;
      if (response.status === 404) {
        localStorage.setItem('star-platform-mode', 'local');
        localStorage.removeItem('star-account');
        switchScope();
        setState((s) => ({
          ...s,
          ready: true,
          enabled: false,
          user: null,
          csrf: '',
          setup: false,
          error: '',
        }));
        return;
      }
      if (!response.ok) throw new Error('账号服务暂时不可用');
      const status = (await response.json()) as { enabled: boolean; setupRequired: boolean };
      if (attempt !== refreshEpoch.current) return;
      if (!status.enabled) {
        localStorage.setItem('star-platform-mode', 'local');
        localStorage.removeItem('star-account');
        switchScope();
        setState((s) => ({
          ...s,
          ready: true,
          enabled: false,
          user: null,
          csrf: '',
          setup: false,
          error: '',
        }));
        return;
      }
      localStorage.setItem('star-platform-mode', 'account');
      const session = await fetch('/api/platform/session', {
        cache: 'no-store',
        signal: AbortSignal.timeout(10000),
      });
      if (attempt !== refreshEpoch.current) return;
      if (session.status === 401) {
        localStorage.removeItem('star-account');
        switchScope();
        setState({
          ready: true,
          enabled: true,
          setup: status.setupRequired,
          user: null,
          csrf: '',
          error: '',
        });
        return;
      }
      if (!session.ok) throw new Error('无法恢复登录状态');
      const auth = (await session.json()) as { user: Account; csrf: string };
      if (attempt !== refreshEpoch.current) return;
      switchScope(auth.user.id);
      const database = db;
      const existing = await database.userProfiles.count();
      await initialize(database);
      if (!existing) {
        const guard = await backupPreview(await createBackup(database), database);
        const remote = await fetch('/api/platform/data', {
          cache: 'no-store',
          signal: AbortSignal.timeout(30000),
          headers: { 'X-Star-Study-Account': auth.user.id },
        });
        if (!remote.ok) throw new Error('无法读取账户数据');
        const payload = await remote.json();
        if (attempt !== refreshEpoch.current) return;
        await restoreBackup(payload.backup, database, guard.currentSignature);
        localStorage.setItem(
          `star-sync:${auth.user.id}`,
          JSON.stringify({ version: payload.version, hash: await dataHash(payload.backup) }),
        );
      }
      if (attempt !== refreshEpoch.current) return;
      localStorage.setItem('star-account', JSON.stringify(auth.user));
      setState({ ready: true, enabled: true, setup: false, ...auth, error: '' });
    } catch (e) {
      if (attempt !== refreshEpoch.current) return;
      // Only a previously signed-in account may reopen its own offline cache. No new offline login.
      const cached = localStorage.getItem('star-account');
      const unreachable =
        !navigator.onLine ||
        e instanceof TypeError ||
        (e instanceof Error && ['TimeoutError', 'AbortError'].includes(e.name));
      if (unreachable && cached && localStorage.getItem('star-platform-mode') === 'account') {
        try {
          const user = JSON.parse(cached) as Account;
          switchScope(user.id);
          setState({ ready: true, enabled: true, setup: false, user, csrf: '', error: '' });
          return;
        } catch {}
      }
      if (unreachable && localStorage.getItem('star-platform-mode') === 'local') {
        switchScope();
        setState((s) => ({
          ...s,
          ready: true,
          enabled: false,
          user: null,
          csrf: '',
          setup: false,
          error: '',
        }));
        return;
      }
      setState((s) => ({
        ...s,
        ready: true,
        error: e instanceof Error ? e.message : '无法打开账户服务',
      }));
    }
  }, [switchScope]);
  useEffect(() => {
    const epoch = refreshEpoch;
    void refresh();
    channel.current = new BroadcastChannel('star-account-events');
    channel.current.onmessage = () => location.reload();
    const online = () => void refresh();
    window.addEventListener('online', online);
    return () => {
      epoch.current++;
      channel.current?.close();
      channel.current = null;
      window.removeEventListener('online', online);
    };
  }, [refresh]);
  if (!state.ready)
    return (
      <main className="boot" aria-busy="true">
        <h1>星研</h1>
        <p>正在打开学习空间…</p>
      </main>
    );
  if (state.error)
    return (
      <main className="boot">
        <h1>星研</h1>
        <p role="alert">{state.error}</p>
        <Button onClick={refresh}>重新连接</Button>
      </main>
    );
  return (
    <Context.Provider
      value={{
        enabled: state.enabled,
        user: state.user,
        csrf: state.csrf,
        refresh,
        request,
        announce: () => channel.current?.postMessage('account-changed'),
      }}
    >
      {state.enabled && !state.user ? (
        <AuthForm setup={state.setup} onDone={refresh} />
      ) : (
        <div key={state.user?.id ?? 'local'}>{children}</div>
      )}
    </Context.Provider>
  );
}
function AuthForm({ setup, onDone }: { setup: boolean; onDone: () => Promise<void> }) {
  const platform = usePlatform();
  const [register, setRegister] = useState(false),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  return (
    <main className="auth-space">
      <Link className="brand" href="/">
        <img src="/icons/star.svg" width="44" height="44" alt="" />
        <span>
          <strong>星研</strong>
          <small>STAR STUDY</small>
        </span>
      </Link>
      <h1>{setup ? '创建首位管理员' : register ? '开始你的研途' : '欢迎回来'}</h1>
      <p>以星为引，逐梦研途。</p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy) return;
          setBusy(true);
          setError('');
          const fields = new FormData(e.currentTarget);
          const data = Object.fromEntries(fields);
          try {
            const res = await fetch(
              `/api/platform/${setup ? 'setup' : register ? 'register' : 'login'}`,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data),
              },
            );
            const result = await res.json();
            if (!res.ok) throw new Error(result.error);
            await onDone();
            platform.announce();
          } catch (e) {
            setError(e instanceof Error ? e.message : '请求失败');
          } finally {
            setBusy(false);
          }
        }}
      >
        {(setup || register) && (
          <label>
            昵称
            <input name="name" required maxLength={80} autoComplete="nickname" />
          </label>
        )}
        <label>
          邮箱
          <input type="email" name="email" required autoComplete="username" />
        </label>
        <label>
          密码（至少12位）
          <input
            name="password"
            type="password"
            minLength={12}
            maxLength={128}
            required
            autoComplete={register || setup ? 'new-password' : 'current-password'}
          />
        </label>
        {setup ? (
          <label>
            首次初始化口令
            <input name="setupToken" type="password" required autoComplete="off" />
            <small>仅部署者可从安装结果取得；管理员创建后自动失效。</small>
          </label>
        ) : (
          register && (
            <label>
              邀请码
              <input name="invite" aria-label="邀请码" autoComplete="off" />
              <small>默认需要邀请；公开注册模式可留空。</small>
            </label>
          )
        )}
        {error && (
          <p role="alert" className="warning">
            {error}
          </p>
        )}
        <Button type="submit" loading={busy}>
          {setup ? '创建管理员' : register ? '注册并登录' : '登录'}
        </Button>
      </form>
      {!setup && (
        <Button
          variant="ghost"
          onClick={() => {
            setError('');
            setRegister(!register);
          }}
        >
          {register ? '已有账户？登录' : '有邀请码？注册账户'}
        </Button>
      )}
      <small>账户数据仅用于此部署。请使用可信的 HTTPS 服务。</small>
      <a href="/source/star-study-source.zip" download>
        对应源码 · AGPL-3.0
      </a>
    </main>
  );
}
