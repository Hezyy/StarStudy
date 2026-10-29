'use client';
import { appUrl } from '@/lib/app-path';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { ZodError } from 'zod';
import { Check, AlertCircle, X } from 'lucide-react';
import { db, initialize } from '@/db';
import { defaults } from '@/lib/utils';
import type { CoreData, Preferences } from '@/types';
import { TABLE_NAMES } from '@/types';
import { useFocusReturnTracking } from '@/lib/interaction';
export type ToastAction = { label: string; onClick: () => Promise<unknown> | void };
type Toast = { message: string; error: boolean; action?: ToastAction; id: number };
type AppContext = CoreData & {
  preferences: Preferences;
  notify: (message: string, error?: boolean, action?: ToastAction) => void;
  run: (fn: () => Promise<unknown>, message?: string) => Promise<boolean>;
};
const Context = createContext<AppContext | null>(null);
const FeedbackContext = createContext<string | null>(null);
export const useFeedback = () => useContext(FeedbackContext);
export const useApp = () => {
  const c = useContext(Context);
  if (!c) throw new Error('应用尚未就绪');
  return c;
};
export function Provider({ children }: { children: ReactNode }) {
  useFocusReturnTracking();
  const [ready, setReady] = useState(false),
    [failure, setFailure] = useState(''),
    [toast, setToast] = useState<Toast | null>(null);
  const nextToast = useRef(0);
  const dismiss = useCallback(
    (id?: number) =>
      setToast((current) => (id === undefined || current?.id === id ? null : current)),
    [],
  );
  useEffect(() => {
    initialize()
      .then(() => setReady(true))
      .catch((e) => setFailure(`本地数据库无法打开：${e.message}。请检查是否允许本站存储数据。`));
  }, []);
  const data = useLiveQuery(async () => {
    if (!ready) return null;
    return db.transaction(
      'r',
      TABLE_NAMES.map((n) => db.table(n)),
      async () => {
        const d: Record<string, unknown> = {};
        for (const name of TABLE_NAMES) d[name] = await db.table(name).toArray();
        (d.subjects as CoreData['subjects']).sort((a, b) => a.priority - b.priority);
        return d as unknown as CoreData;
      },
    );
  }, [ready]);
  const preferences =
    (data?.settings.find((s) => s.key === 'preferences')?.value as Preferences | undefined) ??
    defaults;
  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      document.documentElement.dataset.theme =
        preferences.theme === 'system' ? (media.matches ? 'dark' : 'light') : preferences.theme;
    };
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [preferences.theme]);
  const notify = useCallback(
    (message: string, error = false, action?: ToastAction) =>
      setToast({ message, error, action, id: ++nextToast.current }),
    [],
  );
  const run = useCallback(
    async (fn: () => Promise<unknown>, message?: string) => {
      try {
        await fn();
        if (message) notify(message);
        return true;
      } catch (e) {
        notify(
          e instanceof ZodError
            ? `数据校验失败：${e.issues
                .slice(0, 3)
                .map((i) => `${i.path.join('.')} ${i.message}`)
                .join('；')}`
            : e instanceof Error
              ? e.message
              : '操作失败，请重试',
          true,
        );
        return false;
      }
    },
    [notify],
  );
  useEffect(() => {
    const report = (e: Event) =>
      notify(String((e as CustomEvent).detail || '操作失败，请重试'), true);
    window.addEventListener('star-study:operation-error', report);
    return () => window.removeEventListener('star-study:operation-error', report);
  }, [notify]);
  const value = useMemo(
    () => (data ? { ...data, preferences, notify, run } : null),
    [data, preferences, notify, run],
  );
  if (failure)
    return (
      <main className="boot">
        <h1>星研</h1>
        <p role="alert">{failure}</p>
        <button className="button button-primary" onClick={() => location.reload()}>
          重新打开
        </button>
      </main>
    );
  if (!value)
    return (
      <main className="boot" aria-busy="true">
        <img src={appUrl('/icons/star.svg')} alt="" width="48" height="48" />
        <h1>星研</h1>
        <p>正在打开你的学习空间…</p>
        <div className="boot-line" />
      </main>
    );
  return (
    <Context.Provider value={value}>
      <FeedbackContext.Provider value={toast?.error ? toast.message : null}>
        {children}
        <ToastView toast={toast} dismiss={dismiss} run={run} />
      </FeedbackContext.Provider>
    </Context.Provider>
  );
}
function ToastView({
  toast,
  dismiss,
  run,
}: {
  toast: Toast | null;
  dismiss: (id?: number) => void;
  run: AppContext['run'];
}) {
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => dismiss(toast.id), toast.action ? 12000 : 6000);
    return () => clearTimeout(id);
  }, [toast, dismiss]);
  if (!toast) return null;
  return (
    <div
      className={`toast ${toast.error ? 'toast-error' : ''}`}
      role={toast.error ? 'alert' : 'status'}
      key={toast.id}
    >
      {toast.error ? <AlertCircle size={17} /> : <Check size={17} />}
      <span>{toast.message}</span>
      {toast.action && (
        <button
          className="toast-action"
          disabled={busy}
          onClick={async () => {
            if (busy) return;
            setBusy(true);
            const ok = await run(async () => toast.action?.onClick());
            setBusy(false);
            if (ok) dismiss(toast.id);
          }}
        >
          {busy ? '处理中…' : toast.action.label}
        </button>
      )}
      <button aria-label="关闭提示" onClick={() => dismiss(toast.id)}>
        <X size={15} />
      </button>
    </div>
  );
}
