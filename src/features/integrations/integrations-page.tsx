'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from '@/components/ui/app-link';
import { useApp } from '@/components/provider';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import {
  integrationStatus,
  emptyConfig,
  requestAi,
  type IntegrationConfig,
} from '@/services/integrations';
import {
  cloudClient,
  supabaseStore,
  readCursor,
  writeCursor,
  cursorKey,
  pushSnapshot,
  payloadHash,
  syncDecision,
  SyncConflict,
  type RemoteSnapshot,
} from '@/services/cloud';
import { createBackup, backupPreview, restoreBackup } from '@/services/backup';
import { learningReport, previewExternalPlan } from '@/services/collaboration';
import { ProposalPreview } from '@/features/planner/proposal-preview';
import type { PlanProposal } from '@/scheduler/types';
import { download, today } from '@/lib/utils';
import { db } from '@/db';
import { ReminderSettings } from '@/components/reminders';
import { usePlatform } from '@/features/platform/platform';
import { PlatformAiPage } from '@/features/platform/ai-page';
export function IntegrationsPage() {
  const platform = usePlatform();
  const [config, setConfig] = useState<IntegrationConfig>(emptyConfig),
    [loaded, setLoaded] = useState(false);
  useEffect(() => {
    integrationStatus().then((c) => {
      setConfig(c);
      setLoaded(true);
    });
  }, []);
  if (platform.enabled) return <PlatformAiPage />;
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">可选连接，本地学习始终可用</p>
          <h1>云同步与 AI</h1>
          <p>当前{loaded ? '配置已检测' : '正在检查配置'}。未配置的服务不会返回模拟数据。</p>
        </div>
      </div>
      <CloudPanel config={config} />
      <AiPanel config={config} />
      <ReminderSettings />
    </>
  );
}
function CloudPanel({ config }: { config: IntegrationConfig }) {
  const app = useApp();
  const [email, setEmail] = useState(''),
    [password, setPassword] = useState(''),
    [userId, setUserId] = useState(''),
    [account, setAccount] = useState(''),
    [remote, setRemote] = useState<RemoteSnapshot | null>(null),
    [status, setStatus] = useState('尚未连接'),
    [busy, setBusy] = useState(false),
    [preview, setPreview] = useState<Awaited<ReturnType<typeof backupPreview>> | null>(null),
    [confirm, setConfirm] = useState(false),
    [queued, setQueued] = useState(false);
  const refresh = async () => {
    const connection = await supabaseStore(config);
    setUserId(connection.userId);
    setAccount(connection.email);
    const latest = await connection.store.read();
    setRemote(latest);
    const backup = await createBackup();
    const key = cursorKey(config.cloud.url, connection.userId),
      cursor = readCursor(key);
    setQueued(!!cursor?.queued);
    const decision = syncDecision(await payloadHash(backup), cursor, latest);
    setStatus(
      {
        upload: '本机有待上传内容',
        download: '云端有新版本，请预览后恢复',
        conflict: '本机与云端都有修改，需要选择版本',
        choose: '首次连接，请选择保留本机或云端版本',
        synced: '当前本机与已记录云端版本一致',
      }[decision],
    );
    return { connection, latest, backup, key, cursor };
  };
  useEffect(() => {
    if (!config.cloud.configured) return;
    cloudClient(config)
      .then((c) => c.auth.getSession())
      .then(({ data }) => {
        if (data.session) {
          setUserId(data.session.user.id);
          setAccount(data.session.user.email ?? '');
        }
      })
      .catch(() => {});
  }, [config]);
  const upload = useCallback(
    async (override = false) => {
      if (app.sessions.some((s) => s.state !== 'ended'))
        throw new Error('请先结束计时，再同步完整快照');
      const connection = await supabaseStore(config),
        key = cursorKey(config.cloud.url, connection.userId),
        cursor = readCursor(key);
      if (!navigator.onLine) {
        writeCursor(key, {
          revision: cursor?.revision ?? 0,
          dataHash: cursor?.dataHash ?? '',
          queued: true,
        });
        setQueued(true);
        setStatus('已排队，网络恢复后检查版本再上传');
        return;
      }
      const latest = await connection.store.read();
      setRemote(latest);
      if (!override && latest && (!cursor || latest.revision !== cursor.revision)) {
        setStatus('云端版本不同，请选择版本处理冲突');
        throw new SyncConflict();
      }
      if (override && latest)
        download(
          `星研-云端覆盖前备份-v${latest.revision}.json`,
          JSON.stringify(latest.payload, null, 2),
        );
      const backup = await createBackup(),
        result = await pushSnapshot(
          connection.store,
          backup,
          override ? (latest?.revision ?? 0) : (cursor?.revision ?? 0),
        );
      writeCursor(key, {
        revision: result.revision,
        dataHash: await payloadHash(backup),
        queued: false,
      });
      setRemote(result);
      setQueued(false);
      setStatus(`已上传云端 v${result.revision}，完整任务、图片与学习记录已包含`);
    },
    [app, config],
  );
  useEffect(() => {
    if (!userId || !config.cloud.configured) return;
    const onOnline = () => {
      const cursor = readCursor(cursorKey(config.cloud.url, userId));
      if (cursor?.queued) {
        setBusy(true);
        app.run(() => upload(false), '离线队列已检查并处理').finally(() => setBusy(false));
      }
    };
    window.addEventListener('online', onOnline);
    if (navigator.onLine) onOnline();
    return () => window.removeEventListener('online', onOnline);
  }, [config, userId, app, upload]);
  return (
    <section className="panel settings-section">
      <div className="section-heading">
        <h2>可选 Supabase 账户与快照同步</h2>
        <span className="tag">{config.cloud.configured ? '已配置，需登录' : '未配置'}</span>
      </div>
      {!config.cloud.configured && (
        <p className="warning-box">
          当前没有配置 Supabase 项目。请按项目文档设置地址、公开密钥及 RLS
          权限策略；本机数据不会自动上传。
        </p>
      )}
      <p className="hint">
        采用带版本校验的完整快照同步，包含图片。冲突时由你选择版本，不自动合并两份有分歧的数据；下载云端前有恢复预览与本地自动备份。
      </p>
      {!userId ? (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            await app.run(async () => {
              const c = await cloudClient(config);
              const { error } = await c.auth.signInWithPassword({ email, password });
              if (error) throw new Error(error.message);
              setPassword('');
              await refresh();
            }, '账户已登录');
            setBusy(false);
          }}
        >
          <div className="form-grid">
            <label>
              云端邮箱
              <input
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <label>
              账户密码
              <input
                type="password"
                autoComplete="current-password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
          </div>
          <div className="record-actions">
            <Button disabled={busy || !config.cloud.configured}>登录账户</Button>
            <Button
              type="button"
              variant="secondary"
              disabled={busy || !config.cloud.configured || !email || password.length < 8}
              onClick={async () => {
                setBusy(true);
                await app.run(async () => {
                  const c = await cloudClient(config);
                  const { error } = await c.auth.signUp({ email, password });
                  if (error) throw new Error(error.message);
                  setPassword('');
                }, '注册请求已发送，请按项目的邮件验证设置完成确认后登录');
                setBusy(false);
              }}
            >
              注册账户
            </Button>
          </div>
        </form>
      ) : (
        <>
          <p>当前账户：{account}</p>
          <p role="status" className="hint">
            {status}
            {queued ? ' · 有离线上传队列' : ''}
          </p>
          <p className="hint">本地学习空间不会随账户自动切换，上传前请确认这些数据属于当前账户。</p>
          <div className="record-actions">
            <Button
              disabled={busy}
              variant="secondary"
              onClick={async () => {
                setBusy(true);
                await app.run(refresh, '云端版本已检查');
                setBusy(false);
              }}
            >
              检查云端版本
            </Button>
            <Button
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                await app.run(() => upload(false), '同步请求已处理');
                setBusy(false);
              }}
            >
              上传本机快照 / 离线排队
            </Button>
            <Button
              disabled={busy}
              variant="secondary"
              onClick={async () => {
                setBusy(true);
                await app.run(async () => {
                  const c = await supabaseStore(config);
                  const r = await c.store.read();
                  if (!r) throw new Error('云端还没有学习快照');
                  setRemote(r);
                  setPreview(await backupPreview(r.payload));
                  setConfirm(false);
                }, '云端快照已校验，请检查恢复预览');
                setBusy(false);
              }}
            >
              下载云端并预览
            </Button>
            <Button
              disabled={busy || !remote}
              variant="danger"
              onClick={async () => {
                if (!confirmDialog('确认以本机完整快照覆盖云端？将先下载一份云端旧版本备份。'))
                  return;
                setBusy(true);
                await app.run(() => upload(true), '云端已更新，覆盖前备份已下载');
                setBusy(false);
              }}
            >
              冲突：以本机为准
            </Button>
            <Button
              disabled={busy}
              variant="ghost"
              onClick={() =>
                app.run(async () => {
                  const c = await cloudClient(config);
                  await c.auth.signOut();
                  setUserId('');
                  setAccount('');
                  setRemote(null);
                }, '已退出，本地数据保留')
              }
            >
              退出账户
            </Button>
          </div>
        </>
      )}
      {preview && (
        <Modal title="云端恢复预览" onClose={() => !busy && setPreview(null)} wide>
          <p className="warning-box">
            云端 v{remote?.revision}{' '}
            将替换本机核心数据，确认前请检查数量。本机恢复前快照会自动保留。
          </p>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>数据表</th>
                  <th>本机</th>
                  <th>云端</th>
                  <th>同ID</th>
                </tr>
              </thead>
              <tbody>
                {preview.counts.map((c) => (
                  <tr key={c.name}>
                    <td>{c.name}</td>
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
              checked={confirm}
              onChange={(e) => setConfirm(e.target.checked)}
            />
            确认采用这份云端版本替换本机数据
          </label>
          <div className="modal-actions">
            <Button variant="secondary" onClick={() => setPreview(null)}>
              取消恢复
            </Button>
            <Button
              disabled={busy || !confirm}
              onClick={async () => {
                setBusy(true);
                if (
                  await app.run(async () => {
                    await restoreBackup(preview.backup, db, preview.currentSignature);
                    const local = await createBackup();
                    writeCursor(cursorKey(config.cloud.url, userId), {
                      revision: remote!.revision,
                      dataHash: await payloadHash(local),
                      queued: false,
                    });
                    setStatus('云端快照已恢复，后续本机修改会作为新变更');
                  }, '云端快照已安全恢复')
                )
                  setPreview(null);
                setBusy(false);
              }}
            >
              确认恢复云端快照
            </Button>
          </div>
        </Modal>
      )}
    </section>
  );
}
function confirmDialog(message: string) {
  return window.confirm(message);
}
function AiPanel({ config }: { config: IntegrationConfig }) {
  const app = useApp();
  const [token, setToken] = useState(''),
    [kind, setKind] = useState<'plan' | 'mistake'>('plan'),
    [request, setRequest] = useState(''),
    [result, setResult] = useState(''),
    [busy, setBusy] = useState(false),
    [proposal, setProposal] = useState<PlanProposal | null>(null);
  return (
    <section className="panel settings-section">
      <div className="section-heading">
        <h2>可选服务端 AI</h2>
        <span className="tag">{config.ai.configured ? `已配置 ${config.ai.model}` : '未配置'}</span>
      </div>
      {!config.ai.configured && (
        <p className="warning-box">
          未配置服务端密钥、模型和网关口令。当前不会生成模拟 AI
          回答；本地排期与文件协作可以完整使用。
        </p>
      )}
      <div className="form-grid">
        <label>
          使用方式
          <select
            aria-label="AI用途"
            value={kind}
            onChange={(e) => setKind(e.target.value as 'plan' | 'mistake')}
          >
            <option value="plan">学习规划建议</option>
            <option value="mistake">错题文本分析</option>
          </select>
        </label>
        <label>
          AI网关访问口令
          <input
            type="password"
            autoComplete="off"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="由服务端配置，非模型API密钥"
          />
        </label>
        <label className="span-2">
          {kind === 'plan' ? '调整要求' : '错题题目、答案与困惑'}
          <textarea rows={4} value={request} onChange={(e) => setRequest(e.target.value)} />
        </label>
      </div>
      <p className="hint">
        规划仅发送近7天汇总与未完成任务，不发送私人笔记、图片或错题文本。错题分析只发送你在上面输入的文字。API密钥仅在服务端；网关口令只保留在此页面内存。
      </p>
      <div className="record-actions">
        <Button
          disabled={busy || !config.ai.configured || !request.trim()}
          onClick={async () => {
            setBusy(true);
            await app.run(async () => {
              const context =
                kind === 'plan'
                  ? learningReport(app, {
                      days: 7,
                      includeFuture: false,
                      includeNotes: false,
                      includeMistakeText: false,
                      request,
                    })
                  : { question: request };
              const r = await requestAi(kind, context, token);
              setResult(r.text);
            }, 'AI文本已返回，尚未修改任何学习数据');
            setBusy(false);
          }}
        >
          请求服务端 AI
        </Button>
        <Button asChild variant="secondary">
          <Link href="/collaboration/">使用无需 API 的文件协作</Link>
        </Button>
      </div>
      {result && (
        <>
          <label>
            AI返回结果
            <textarea
              aria-label="AI返回结果"
              className="code-input"
              rows={12}
              value={result}
              onChange={(e) => setResult(e.target.value)}
            />
          </label>
          <div className="record-actions">
            <Button
              variant="secondary"
              onClick={() => download(`星研-AI建议-${today()}.md`, result, 'text/markdown')}
            >
              下载建议
            </Button>
            <Button
              onClick={() =>
                app.run(
                  async () =>
                    setProposal(
                      await previewExternalPlan(
                        JSON.parse(result.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '')),
                      ),
                    ),
                  'JSON已校验，请检查计划差异',
                )
              }
            >
              将结果作为 JSON 校验预览
            </Button>
          </div>
        </>
      )}
      {proposal && (
        <ProposalPreview
          proposal={proposal}
          onCancel={() => setProposal(null)}
          onModify={() => setProposal(null)}
        />
      )}
    </section>
  );
}
