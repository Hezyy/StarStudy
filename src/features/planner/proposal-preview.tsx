'use client';
import { useState } from 'react';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { useApp } from '@/components/provider';
import { applyProposal } from '@/services/plans';
import type { PlanProposal } from '@/scheduler/types';
export function ProposalPreview({
  proposal,
  onCancel,
  onModify,
  onApplied,
}: {
  proposal: PlanProposal;
  onCancel: () => void;
  onModify: () => void;
  onApplied?: () => void;
}) {
  const app = useApp();
  const [page, setPage] = useState(0);
  const perPage = 100;
  const [busy, setBusy] = useState(false),
    [skip, setSkip] = useState(false);
  return (
    <Modal
      title="计划调整预览"
      onClose={() => !busy && onCancel()}
      protectChanges={false}
      busy={busy}
      wide
    >
      <p className="pre-wrap">{proposal.reason}</p>
      <p className="hint">
        范围 {proposal.from} 至 {proposal.to} · 需要 {proposal.requiredMinutes} 分钟 · 可用{' '}
        {proposal.availableMinutes} 分钟 · {proposal.changes.length} 项变化
      </p>
      {proposal.preferencesAfter && (
        <p className="warning-box">此方案还会更新已预览的时间预算，只有确认后才生效。</p>
      )}
      {proposal.warnings.map((w, i) => (
        <p className="warning-box" key={i}>
          {w}
        </p>
      ))}
      <div className="table-scroll">
        <table>
          <caption>新旧计划差异与受影响任务</caption>
          <thead>
            <tr>
              <th>任务 / 类型</th>
              <th>原日期 → 新日期</th>
              <th>原预计 → 新预计</th>
              <th>调整原因</th>
            </tr>
          </thead>
          <tbody>
            {proposal.changes.slice(page * perPage, (page + 1) * perPage).map((c) => (
              <tr key={c.id}>
                <td>
                  {c.after.title}
                  <br />
                  <small>
                    {
                      {
                        new: '新增复习/任务',
                        move: '改期',
                        split: '拆分',
                        update: '调整',
                        archive: '取消（保留历史）',
                      }[c.type]
                    }
                  </small>
                </td>
                <td>
                  {c.before?.date ?? '新建'} →{' '}
                  {c.after.deletedAt
                    ? '归档'
                    : c.after.unscheduled
                      ? '未排期（保留）'
                      : c.after.date}
                </td>
                <td>
                  {c.before?.estimatedMinutes ?? 0} → {c.after.estimatedMinutes} 分钟
                  {c.after.plannedMinutes !== undefined && (
                    <small>
                      <br />
                      当前日期分配 {c.after.plannedMinutes} 分钟
                    </small>
                  )}
                </td>
                <td>{c.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {proposal.changes.length > perPage && (
        <div className="selection-toolbar">
          <span>
            全部差异共 {proposal.changes.length} 项，当前第 {page + 1}/
            {Math.ceil(proposal.changes.length / perPage)} 页
          </span>
          <Button
            size="sm"
            variant="secondary"
            disabled={page === 0}
            onClick={() => setPage((p) => p - 1)}
          >
            上一页差异
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={(page + 1) * perPage >= proposal.changes.length}
            onClick={() => setPage((p) => p + 1)}
          >
            下一页差异
          </Button>
        </div>
      )}
      {proposal.unassigned.length > 0 && (
        <section className="warning-box">
          <strong>
            无法安排 {proposal.unassigned.length} 项 · 余量{' '}
            {proposal.unassigned.reduce((n, u) => n + u.minutes, 0)} 分钟
          </strong>
          <p>
            未完成内容会保留。可增加可用时间、修改科目上限、延后截止日期或先补齐依赖后重新预览。
          </p>
          {proposal.unassigned.map((u) => (
            <p key={u.taskId}>
              {u.title} · {u.minutes} 分钟 · {u.reason}
            </p>
          ))}
        </section>
      )}
      {!!proposal.conflicts?.length && (
        <section className="warning-box">
          <strong>以下冲突任务将保留当前状态</strong>
          {proposal.conflicts.map((c) => (
            <p key={c.taskId}>
              {c.title} · {c.reason}
            </p>
          ))}
          <label className="inline-check">
            <input type="checkbox" checked={skip} onChange={(e) => setSkip(e.target.checked)} />
            我选择保留冲突任务，仅恢复其他安全差异
          </label>
        </section>
      )}
      <p className="hint">
        计时、笔记、完成状态和错题复习不会被此方案覆盖。预览后数据变化时须重新生成方案。
      </p>
      <div className="modal-actions">
        <Button variant="secondary" disabled={busy} onClick={onCancel}>
          取消调整
        </Button>
        <Button variant="secondary" disabled={busy} onClick={onModify}>
          修改方案
        </Button>
        <Button
          disabled={
            busy ||
            (!!proposal.conflicts?.length && !skip) ||
            (!proposal.changes.length && !proposal.preferencesAfter)
          }
          onClick={async () => {
            setBusy(true);
            if (
              await app.run(
                () => applyProposal(proposal, true),
                '计划已确认应用，版本与原始学习记录已保留',
              )
            ) {
              onCancel();
              onApplied?.();
            }
            setBusy(false);
          }}
        >
          确认调整
        </Button>
      </div>
    </Modal>
  );
}
