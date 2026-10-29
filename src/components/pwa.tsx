'use client';
import { useEffect, useState } from 'react';
import { WifiOff, RefreshCw, Download } from 'lucide-react';
import { Button } from './ui/button';
import { useApp } from './provider';
import { appUrl } from '@/lib/app-path';
type InstallPrompt = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: string }>;
};
export function PwaStatus() {
  const [offline, setOffline] = useState(false),
    [waiting, setWaiting] = useState<ServiceWorker | null>(null),
    [install, setInstall] = useState<InstallPrompt | null>(null);
  const { notify } = useApp();
  useEffect(() => {
    const update = () => setOffline(!navigator.onLine);
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    const prompt = (e: Event) => {
      e.preventDefault();
      setInstall(e as InstallPrompt);
    };
    window.addEventListener('beforeinstallprompt', prompt);
    if ('serviceWorker' in navigator && process.env.NODE_ENV === 'production')
      navigator.serviceWorker
        .register(appUrl('/sw.js'), { scope: appUrl('/') })
        .then((r) => {
          if (r.waiting) setWaiting(r.waiting);
          r.addEventListener('updatefound', () => {
            const worker = r.installing;
            worker?.addEventListener('statechange', () => {
              if (worker.state === 'installed' && navigator.serviceWorker.controller)
                setWaiting(worker);
            });
          });
        })
        .catch(() => notify('离线缓存注册失败，可在线使用并稍后重试', true));
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
      window.removeEventListener('beforeinstallprompt', prompt);
    };
  }, [notify]);
  return (
    <>
      {offline && (
        <div className="system-banner">
          <WifiOff size={16} />
          当前离线 · 本地任务可以正常查看和修改
        </div>
      )}
      {waiting && (
        <div className="system-banner">
          星研有新版本{' '}
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              if (confirm('更新将重新打开应用，请先保存正在编辑的内容。确认更新？')) {
                navigator.serviceWorker.addEventListener(
                  'controllerchange',
                  () => location.reload(),
                  { once: true },
                );
                waiting.postMessage({ type: 'SKIP_WAITING' });
              }
            }}
          >
            <RefreshCw size={14} />
            保存后更新
          </Button>
        </div>
      )}
      {install && (
        <button
          className="install-button"
          onClick={async () => {
            await install.prompt();
            await install.userChoice;
            setInstall(null);
          }}
        >
          <Download size={14} />
          安装星研
        </button>
      )}
    </>
  );
}
