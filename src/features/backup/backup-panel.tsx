'use client';
import { useState } from 'react';
import { ArchiveRestore, Download, ShieldCheck } from 'lucide-react';
import { useApp } from '@/components/provider';
import { Button } from '@/components/ui/button';
import { backupPreview, createBackup, restoreBackup, type Backup } from '@/services/backup';
import { db } from '@/db';
import { download, today } from '@/lib/utils';
import { usePlatform } from '@/features/platform/platform';
import { dataHash } from '@/lib/data-hash';
import { accountOperation } from '@/services/account-lock';
const labels: Record<string, string> = {
  userProfiles: '个人资料',
  examTargets: '考试目标',
  subjects: '科目',
  knowledgePoints: '知识点',
  resources: '资料',
  tasks: '任务',
  taskResources: '任务资料关联',
  sessions: '计时记录',
  mistakes: '错题（含图片）',
  mistakeReviews: '错题复习',
  weeklyReviews: '周复盘',
  revisions: '计划版本',
  settings: '应用设置',
};
export function BackupPanel() {
  const app = useApp();
  const database=db;
  const platform = usePlatform();
  const [busy, setBusy] = useState(false),
    [preview, setPreview] = useState<Awaited<ReturnType<typeof backupPreview>> | null>(null),
    [confirmed, setConfirmed] = useState(false);
  const [remotePreview, setRemotePreview] = useState<{
    previewId: string;
    baseVersion: number;
    counts: { name: string; current: number; incoming: number; conflicts: number }[];
  } | null>(null);
  return (
    <section className="panel settings-section">
      <div className="section-heading">
        <h2>
          <ShieldCheck size={20} />
          数据备份与恢复
        </h2>
        <span className="tag">JSON v2</span>
      </div>
      <p className="warning-box">
        {platform.enabled
          ? '本机缓存可能因浏览器清理而丢失。账户可同步到此部署，仍请定期下载完整备份；恢复会替换此账户的服务器数据，需要联网、预览并确认。'
          : '数据保存在当前浏览器中，清理浏览器数据或设备故障可能导致丢失。请定期备份；手机与电脑之间需要手动迁移备份文件，当前没有自动同步。'}
      </p>
      <div className="backup-actions">
        <div>
          <h3>完整备份</h3>
          <p className="hint">
            包含所有核心数据、图片与计划变更历史。运行中的计时在备份中会冻结为暂停状态。
          </p>
          <Button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await app.run(
                async () =>
                  download(
                    `星研-完整备份-${today()}.json`,
                    JSON.stringify(await createBackup(database), null, 2),
                  ),
                '完整备份已生成，请妥善保存下载文件',
              );
              setBusy(false);
            }}
          >
            <Download size={16} />
            下载完整备份
          </Button>
        </div>
        <div>
          <h3>从备份恢复</h3>
          <p className="hint">先校验并预览。恢复将替换当前数据，执行前自动保留当前数据库快照。</p>
          <label className="file-button button button-secondary">
            <ArchiveRestore size={16} />
            选择 JSON 备份
            <input
              aria-label="选择 JSON 备份"
              type="file"
              accept=".json"
              disabled={busy}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                setPreview(null);
                setRemotePreview(null);
                setConfirmed(false);
                setBusy(true);
                await app.run(async () => {
                  const limit = platform.enabled ? 38 : 100;
                  if (file.size > limit * 1024 * 1024) throw new Error(`备份文件超过${limit} MB`);
                  if (platform.enabled && !navigator.onLine)
                    throw new Error('账户恢复需要联网完成服务器预览；离线时仍可下载本机完整备份');
                  const local = await backupPreview(JSON.parse(await file.text()),database);
                  if (platform.enabled)
                    setRemotePreview(
                      await platform.request('/data/restore/preview', 'POST', {
                        backup: local.backup,
                      }),
                    );
                  setPreview(local);
                }, '备份校验通过，请检查恢复预览');
                setBusy(false);
                e.target.value = '';
              }}
            />
          </label>
        </div>
      </div>
      {preview && (
        <div className="restore-preview">
          <h3>恢复预览</h3>
          <p className="hint">
            备份时间：{new Date(preview.backup.exportedAt).toLocaleString('zh-CN')} · 同 ID
            表示将被备份内容替换。
          </p>
          {remotePreview && (
            <p className="warning">
              本账户服务器目前有{' '}
              {remotePreview.counts.find((c) => c.name === 'tasks')?.current ?? 0} 项任务、
              {remotePreview.counts.find((c) => c.name === 'sessions')?.current ?? 0}{' '}
              条计时。确认后以此备份替换，其他用户不受影响；服务器恢复前副本与本机恢复前快照均会保留。
            </p>
          )}
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>数据类型</th>
                  <th>当前</th>
                  <th>备份</th>
                  <th>同 ID 冲突</th>
                </tr>
              </thead>
              <tbody>
                {preview.counts.map((c) => (
                  <tr key={c.name}>
                    <td>{labels[c.name]}</td>
                    <td>{c.current}</td>
                    <td>{c.incoming}</td>
                    <td>{c.conflicts}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <label className="inline-check">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            我已检查预览，确认用该备份替换当前数据。
          </label>
          <div className="modal-actions">
            <Button variant="secondary" onClick={() => setPreview(null)}>
              取消恢复
            </Button>
            <Button
              disabled={busy || !confirmed}
              onClick={async () => {
                setBusy(true);
                if (
                  await app.run(async () => {
                    if (platform.enabled) {
                      await accountOperation(platform.user!.id, async () => {
                        if (!remotePreview) throw new Error('服务器恢复预览已失效，请重新选择备份');
                        const latest = await backupPreview(preview.backup,database);
                        if (latest.currentSignature !== preview.currentSignature)
                          throw new Error('预览后本机数据已变化，请重新预览');
                        if (await database.sessions.filter((s) => s.state !== 'ended').count())
                          throw new Error('请先结束计时再恢复');
                        await platform.request<{ version: number }>('/data/restore/apply', 'POST', {
                          previewId: remotePreview.previewId,
                          confirmed: true,
                        });
                        const result = await platform.request<{ version: number; backup: Backup }>(
                          '/data',
                        );
                        try {
                          await restoreBackup(result.backup, database, preview.currentSignature);
                        } catch {
                          throw new Error(
                            '服务器已恢复；本机数据在恢复期间发生变化，已保留本机修改。请通过同步冲突入口处理。',
                          );
                        }
                        localStorage.setItem(
                          `star-sync:${platform.user!.id}`,
                          JSON.stringify({
                            version: result.version,
                            hash: await dataHash(result.backup),
                          }),
                        );
                        setRemotePreview(null);
                      });
                    } else await restoreBackup(preview.backup, database, preview.currentSignature);
                  }, '恢复成功；恢复前快照已保留')
                ) {
                  setPreview(null);
                  setConfirmed(false);
                }
                setBusy(false);
              }}
            >
              确认恢复
            </Button>
          </div>
        </div>
      )}
      <div className="recovery-row">
        <span className="hint">
          恢复后发现选错文件？可下载最近一次恢复前快照，再通过上方入口恢复。
        </span>
        <Button
          disabled={busy}
          size="sm"
          variant="ghost"
          onClick={() =>
            app.run(async () => {
              const s = await database.recoverySnapshots.orderBy('createdAt').last();
              if (!s) throw new Error('还没有恢复前快照');
              download(`星研-恢复前快照-${s.createdAt.slice(0, 10)}.json`, s.json);
            }, '恢复前快照已下载')
          }
        >
          下载恢复前快照
        </Button>
      </div>
    </section>
  );
}
