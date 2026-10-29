'use client';
import { appStorageKey } from '@/lib/app-path';
import { useCallback, useEffect, useRef, useState } from 'react';
import { usePlatform } from './platform';
import { useApp } from '@/components/provider';
import {
  encodeData,
  readCoreData,
  restoreBackup,
  backupPreview,
  type Backup,
} from '@/services/backup';
import { Button } from '@/components/ui/button';
import { download } from '@/lib/utils';
import { dataHash } from '@/lib/data-hash';
import { accountOperation } from '@/services/account-lock';
import { db } from '@/db';
export function SyncStatus() {
  const p = usePlatform(),
    app = useApp(),
    [message, setMessage] = useState('正在连接账户数据…'),
    [conflict, setConflict] = useState(false),
    busy = useRef(0),
    generation = useRef(0);
  const latest = useRef(app);
  latest.current = app;
  const sync = useCallback(
    async (forcePull = false, manual = false) => {
      const accountId = p.user?.id;
      const database = db;
      if (!accountId || (busy.current > 0 && !forcePull && !manual)) return;
      if (!navigator.onLine) {
        setMessage('离线修改保存在本机，联网后继续同步');
        return;
      }
      if (!p.csrf) {
        setMessage('正在恢复服务器会话；本机修改保留');
        return;
      }
      const queued = busy.current > 0;
      busy.current++;
      const ownGeneration = ++generation.current;
      const show = (text: string, hasConflict?: boolean) => {
        if (ownGeneration !== generation.current) return;
        setMessage(text);
        if (hasConflict !== undefined) setConflict(hasConflict);
      };
      if (queued && !forcePull) show('当前同步结束后将重试…');
      try {
        // Confirmation applies to this local snapshot, including while a previous sync holds the lock.
        // Later edits must require confirmation again rather than being silently replaced from the queue.
        const confirmedHash = forcePull
          ? await dataHash(await encodeData(await readCoreData(database), false))
          : undefined;
        if (queued && forcePull) show('正在等待当前同步结束，再读取服务器版本…');
        await accountOperation(accountId, async () => {
          const key = appStorageKey(`star-sync:${accountId}`),
            cursor = JSON.parse(localStorage.getItem(key) ?? 'null') as {
              version: number;
              hash: string;
            } | null;
          const local = await encodeData(await readCoreData(database), false),
            hash = await dataHash(local);
          if (forcePull && confirmedHash !== hash)
            throw new Error('等待同步期间本机数据变化，请重新确认服务器版本；本机内容已保留');
          const guard = await backupPreview(local, database);
          const remote = await p.request<{ version: number }>('/data/version');
          if (!cursor && !forcePull) {
            show('缓存缺少同步基线，请保留本机副本后选择服务器版本', true);
            return;
          }
          const changed = !cursor || (!!cursor.hash && cursor.hash !== hash);
          if (remote.version !== cursor?.version || forcePull) {
            if (changed && !forcePull) {
              show('另一设备也有修改。当前修改已保留，请先处理冲突。', true);
              return;
            }
            if (changed && latest.current.sessions.some((s) => s.state !== 'ended')) {
              show('服务器有更新，请结束本机计时后同步');
              return;
            }
            const payload = await p.request<{ version: number; backup: Backup }>('/data');
            // Guard against edits that arrived while downloading.
            if ((await dataHash(await encodeData(await readCoreData(database), false))) !== hash)
              throw new Error('下载期间本机数据变化，请重试');
            await restoreBackup(payload.backup, database, guard.currentSignature, {
              matchingRemoteSessions: !changed,
            });
            localStorage.setItem(
              key,
              JSON.stringify({ version: payload.version, hash: await dataHash(payload.backup) }),
            );
          } else if (changed && cursor) {
            const saved = await p.request<{ version: number }>('/data', 'PUT', {
              baseVersion: cursor.version,
              backup: local,
            });
            localStorage.setItem(key, JSON.stringify({ version: saved.version, hash }));
          } else if (cursor && !cursor.hash)
            localStorage.setItem(key, JSON.stringify({ ...cursor, hash }));
          show('账户数据已同步 · 离线修改保留在本机', false);
        });
      } catch (e) {
        const status = (e as { status?: number }).status;
        show(
          e instanceof Error ? e.message : '同步失败，可稍后重试',
          status === 409 ? true : undefined,
        );
      } finally {
        busy.current--;
      }
    },
    [p],
  );
  useEffect(() => {
    if (!p.enabled) return;
    const id = setTimeout(() => void sync(), 1000);
    return () => clearTimeout(id);
  }, [
    app.tasks,
    app.sessions,
    app.settings,
    app.resources,
    app.knowledgePoints,
    app.mistakes,
    app.mistakeReviews,
    app.weeklyReviews,
    app.revisions,
    app.examTargets,
    app.subjects,
    app.userProfiles,
    app.taskResources,
    p.csrf,
    p.enabled,
    sync,
  ]);
  useEffect(() => {
    if (!p.enabled) return;
    const id = setInterval(() => void sync(), 15000);
    const run = () => void sync();
    window.addEventListener('star-study:sync', run);
    window.addEventListener('online', run);
    return () => {
      clearInterval(id);
      window.removeEventListener('star-study:sync', run);
      window.removeEventListener('online', run);
    };
  }, [p.user?.id, p.csrf, p.enabled, sync]);
  if (!p.enabled) return null;
  return (
    <aside className={`sync-strip ${conflict ? 'warning' : ''}`} aria-label="账户同步">
      <span role="status">{message}</span>
      <Button variant="ghost" size="sm" onClick={() => sync(false, true)}>
        重试同步
      </Button>
      {conflict && (
        <>
          <Button
            variant="secondary"
            size="sm"
            onClick={async () => {
              const b = await encodeData(await readCoreData());
              download('星研-同步冲突本机副本.json', JSON.stringify(b));
            }}
          >
            导出本机副本
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={async () => {
              if (
                confirm(
                  '将以服务器版本替换当前账户的本机缓存。请先导出本机副本；恢复前也会自动保存快照。确定继续？',
                )
              )
                await sync(true);
            }}
          >
            使用服务器版本
          </Button>
        </>
      )}
    </aside>
  );
}
