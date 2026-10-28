'use client';
import { useMemo, useState } from 'react';
import { useApp } from '@/components/provider';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { db } from '@/db';
import { today, validDate } from '@/lib/utils';
import { buildPlanCleanup, type CleanupScope } from '@/services/plan-cleanup';
import { applyProposal } from '@/services/plans';
import type { PlanRevision } from '@/types';

export function CleanupDialog({
  initialSubjectId,
  onClose,
  onApplied,
}: {
  initialSubjectId?: string;
  onClose: () => void;
  onApplied: (revision: PlanRevision, count: number) => void;
}) {
  const app = useApp(),
    database = db;
  const dates = app.tasks
    .filter((task) => !task.deletedAt)
    .map((task) => task.date)
    .sort();
  const [range, setRange] = useState<'all' | 'range'>('all');
  const [from, setFrom] = useState(dates[0] ?? today());
  const [to, setTo] = useState(dates.at(-1) ?? today());
  const [subject, setSubject] = useState(initialSubjectId ?? 'all');
  const [busy, setBusy] = useState(false);
  const preview = useMemo(() => {
    try {
      if (range === 'range' && (!validDate(from) || !validDate(to)))
        throw new Error('请填写有效的开始日期和结束日期。');
      const scope: CleanupScope = {
        ...(range === 'range' ? { from, to } : {}),
        ...(subject === 'all' ? {} : { subjectId: subject }),
      };
      return { result: buildPlanCleanup(app, scope), error: '' };
    } catch (cause) {
      return {
        result: null,
        error: cause instanceof Error ? cause.message : '无法预览，请检查范围。',
      };
    }
  }, [app, range, from, to, subject]);
  const count = preview.result?.proposal.changes.length ?? 0;
  const timerActive = app.sessions.some((session) => session.state !== 'ended');
  return (
    <Modal title="清空学习计划" onClose={onClose} protectChanges={false} busy={busy}>
      <p>先检查范围，再确认清空。这里只归档尚未开始的任务，已完成、已学习及关联进度会保留。</p>
      <div className="form-grid">
        <label>
          清空范围
          <select
            aria-label="清空范围"
            value={range}
            disabled={busy}
            onChange={(event) => setRange(event.target.value as 'all' | 'range')}
          >
            <option value="all">全部日期</option>
            <option value="range">指定日期范围</option>
          </select>
        </label>
        <label>
          清空科目
          <select
            aria-label="清空科目"
            value={subject}
            disabled={busy}
            onChange={(event) => setSubject(event.target.value)}
          >
            <option value="all">所有科目</option>
            {app.subjects.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
                {item.active ? '' : '（历史）'}
              </option>
            ))}
          </select>
        </label>
        {range === 'range' && (
          <>
            <label>
              清空开始日期
              <input
                type="date"
                value={from}
                disabled={busy}
                aria-invalid={!!preview.error}
                onChange={(event) => setFrom(event.target.value)}
              />
            </label>
            <label>
              清空结束日期
              <input
                type="date"
                value={to}
                disabled={busy}
                aria-invalid={!!preview.error}
                onChange={(event) => setTo(event.target.value)}
              />
            </label>
          </>
        )}
      </div>
      {preview.error && (
        <p role="alert" className="warning-box">
          {preview.error}
        </p>
      )}
      {preview.result && (
        <>
          <p role="status" className="hint">
            范围内 {preview.result.matchedCount} 项 · 可清空 {count} 项 · 受保护{' '}
            {preview.result.protectedTasks.length} 项
          </p>
          {count > 0 ? (
            <section className="preview-changes" aria-label="将清空的任务">
              <h3>将清空</h3>
              {preview.result.proposal.changes.slice(0, 12).map((change) => (
                <div key={change.id}>
                  <strong>{change.after.title}</strong>
                  <p className="hint">
                    {change.after.date} ·{' '}
                    {app.subjects.find((item) => item.id === change.after.subjectId)?.name}
                  </p>
                </div>
              ))}
              {count > 12 && (
                <p className="hint">
                  另有 {count - 12} 项，合计 {count} 项。
                </p>
              )}
            </section>
          ) : (
            <p className="hint">
              当前范围没有可清空的任务。可以调整日期或科目；已受保护的内容不会被强制清除。
            </p>
          )}
          {preview.result.protectedTasks.length > 0 && (
            <section className="preview-changes" aria-label="清空时保留的任务">
              <h3>会保留的内容</h3>
              {preview.result.protectedTasks.slice(0, 12).map(({ task, reason }) => (
                <div key={task.id}>
                  <strong>{task.title}</strong>
                  <p className="hint">
                    {task.date} · {reason}
                  </p>
                </div>
              ))}
              {preview.result.protectedTasks.length > 12 && (
                <p className="hint">
                  另有 {preview.result.protectedTasks.length - 12} 项受保护任务。
                </p>
              )}
            </section>
          )}
        </>
      )}
      <p className="warning-box">
        清空后任务会从日历隐藏，学习记录与原始任务仍会保留，并保存可撤销的计划版本。预览后数据变化时，需要重新检查。
      </p>
      {timerActive && (
        <p role="alert" className="warning-box">
          请先结束当前学习计时，再确认清空计划。计时和已学内容都会保留。
        </p>
      )}
      <div className="modal-actions">
        <Button type="button" variant="secondary" disabled={busy} onClick={onClose}>
          取消清空
        </Button>
        <Button
          type="button"
          variant="danger"
          disabled={busy || timerActive || !count || !!preview.error}
          loading={busy}
          onClick={async () => {
            if (!preview.result || !count || busy) return;
            const proposal = preview.result.proposal;
            setBusy(true);
            let revision: PlanRevision | undefined;
            const saved = await app.run(async () => {
              revision = await applyProposal(proposal, true, database);
            });
            if (saved && revision) onApplied(revision, count);
            setBusy(false);
          }}
        >
          确认清空 {count} 项
        </Button>
      </div>
    </Modal>
  );
}
