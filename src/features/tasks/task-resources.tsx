'use client';
import { useState } from 'react';
import { useApp } from '@/components/provider';
import { db } from '@/db';
import { videoLink } from '@/lib/video-link';
import { Button } from '@/components/ui/button';
export function TaskResources({ taskId }: { taskId: string }) {
  const app = useApp(),
    [edit, setEdit] = useState<string | null>(null),
    [url, setUrl] = useState('');
  const links = app.taskResources.filter((l) => l.taskId === taskId);
  if (!links.length) return null;
  return (
    <div className="task-linked-resources" aria-label="任务关联资料">
      {links.map((link) => {
        const r = app.resources.find((r) => r.id === link.resourceId);
        if (!r) return null;
        const video = videoLink(r.url);
        return (
          <div key={link.id}>
            <span>
              {r.name} · {r.verification === 'verified' ? '本人已核实' : '待核实'}
            </span>
            <div className="button-row">
              {video.href ? (
                <a
                  className="task-resource-link"
                  href={video.href}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {video.label}
                </a>
              ) : (
                <span>{video.label}</span>
              )}
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  app.run(
                    () =>
                      db.taskResources.update(link.id, {
                        watchedAt: link.watchedAt ? undefined : new Date().toISOString(),
                        updatedAt: new Date().toISOString(),
                      }),
                    link.watchedAt ? '已撤销观看标记' : '已标记观看；掌握状态仍由你评估',
                  )
                }
              >
                {link.watchedAt ? '已观看 · 撤销' : '标记已观看'}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setEdit(r.id);
                  setUrl(r.url);
                }}
              >
                编辑链接
              </Button>
            </div>
            {edit === r.id && (
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  const check = videoLink(url);
                  if (check.kind === 'invalid') {
                    app.notify(check.reason ?? '链接无效', true);
                    return;
                  }
                  await app.run(async () => {
                    await db.resources.update(r.id, {
                      url,
                      verification: 'pending',
                      updatedAt: new Date().toISOString(),
                    });
                    setEdit(null);
                  }, '链接已更新，请自行核实内容');
                }}
              >
                <label>
                  资料链接
                  <input type="url" value={url} onChange={(e) => setUrl(e.target.value)} />
                </label>
                <Button size="sm" type="submit">
                  保存链接
                </Button>
                <Button size="sm" variant="ghost" type="button" onClick={() => setEdit(null)}>
                  取消
                </Button>
              </form>
            )}
          </div>
        );
      })}
    </div>
  );
}
