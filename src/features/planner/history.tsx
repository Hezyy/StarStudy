'use client';
import { useState } from 'react';
import { useApp } from '@/components/provider';
import { Button } from '@/components/ui/button';
import { versionProposal, planFields, planAtVersion } from '@/services/plans';
import { ProposalPreview } from './proposal-preview';
import type { PlanProposal } from '@/scheduler/types';
import type { StudyTask } from '@/types';
export function PlanHistory() {
  const app = useApp();
  const revisions = [...app.revisions].sort((a, b) => b.planVersion - a.planVersion);
  const [proposal, setProposal] = useState<PlanProposal | null>(null),
    [a, setA] = useState(''),
    [b, setB] = useState('');
  const make = async (id: string, mode: 'undo' | 'restore') =>
    app.run(async () => setProposal(await versionProposal(id, mode)));
  const atVersion = (id: string) => planAtVersion(app, id);
  const sa = atVersion(a),
    sb = atVersion(b),
    diff =
      a && b
        ? [...new Set([...sa.keys(), ...sb.keys()])].filter(
            (id) =>
              JSON.stringify(sa.get(id) ? planFields(sa.get(id)!) : null) !==
              JSON.stringify(sb.get(id) ? planFields(sb.get(id)!) : null),
          )
        : [];
  const last = revisions.find(
    (r) =>
      (['schedule', 'external'].includes(r.kind ?? '') ||
        (r.kind === 'manual' && r.reason.startsWith('清空未开始计划'))) &&
      !revisions.some((v) => v.kind === 'undo' && v.restoresRevisionId === r.revisionId),
  );
  return (
    <section className="panel settings-section">
      <div className="section-heading">
        <h2>计划历史版本</h2>
        <Button
          variant="secondary"
          size="sm"
          disabled={!last}
          onClick={() => last && make(last.revisionId, 'undo')}
        >
          撤销上一次调整
        </Button>
      </div>
      <p className="hint">
        恢复前会检查完成状态、后续学习记录及计划冲突；只还原计划字段，不回滚整库。
      </p>
      <div className="form-grid">
        <label>
          比较版本 A
          <select aria-label="比较版本A" value={a} onChange={(e) => setA(e.target.value)}>
            <option value="">请选择</option>
            {revisions.map((r) => (
              <option key={r.id} value={r.revisionId}>
                v{r.planVersion} {r.reason}
              </option>
            ))}
          </select>
        </label>
        <label>
          比较版本 B
          <select aria-label="比较版本B" value={b} onChange={(e) => setB(e.target.value)}>
            <option value="">请选择</option>
            {revisions.map((r) => (
              <option key={r.id} value={r.revisionId}>
                v{r.planVersion} {r.reason}
              </option>
            ))}
          </select>
        </label>
      </div>
      {a && b && (
        <div className="table-scroll">
          <table>
            <caption>两个版本的计划差异：{diff.length} 项</caption>
            <thead>
              <tr>
                <th>任务</th>
                <th>版本 A</th>
                <th>版本 B</th>
              </tr>
            </thead>
            <tbody>
              {diff.map((id) => {
                const x = sa.get(id),
                  y = sb.get(id);
                return (
                  <tr key={id}>
                    <td>{y?.title ?? x?.title}</td>
                    <td>{describe(x)}</td>
                    <td>{describe(y)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {revisions.map((r) => (
        <details className="revision" key={r.id}>
          <summary>
            v{r.planVersion} · {r.reason}
            <small>
              {new Date(r.createdAt).toLocaleString('zh-CN')} · 用户确认{' '}
              {new Date(r.approvedAt).toLocaleString('zh-CN')}
            </small>
          </summary>
          <ul className="hint">
            {r.changes.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>任务</th>
                  <th>修改前</th>
                  <th>修改后</th>
                </tr>
              </thead>
              <tbody>
                {r.afterSnapshot.map((t) => (
                  <tr key={t.id}>
                    <td>{t.title}</td>
                    <td>{describe(r.beforeSnapshot.find((v) => v.id === t.id))}</td>
                    <td>{describe(t)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="record-actions">
            <Button size="sm" variant="secondary" onClick={() => make(r.revisionId, 'undo')}>
              预览撤销此版本
            </Button>
            <Button size="sm" variant="ghost" onClick={() => make(r.revisionId, 'restore')}>
              恢复到此历史计划
            </Button>
          </div>
        </details>
      ))}
      {!revisions.length && <p className="hint">暂无计划变更。</p>}
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
function describe(t?: StudyTask) {
  return !t
    ? '不存在'
    : t.deletedAt
      ? '已归档'
      : `${t.unscheduled ? '未排期' : t.date} / ${t.estimatedMinutes}分钟`;
}
