'use client';
import { useViewState } from '@/lib/interaction';
import { useState } from 'react';
import { addDays, format, parseISO } from 'date-fns';
import { useApp } from '@/components/provider';
import { Button } from '@/components/ui/button';
import { today } from '@/lib/utils';
import { createSchedule } from '@/services/plans';
import { ProposalPreview } from './proposal-preview';
import { PlanHistory } from './history';
import type { PlanProposal } from '@/scheduler/types';
import { db } from '@/db';
export function PlannerPage() {
  const app = useApp();
  const notice = app.settings.find((s) => s.key === 'plan-review-notice');
  const acknowledged =
    notice?.value &&
    typeof notice.value === 'object' &&
    'acknowledged' in notice.value &&
    notice.value.acknowledged === true;
  const [from, setFrom] = useState(today()),
    [to, setTo] = useState(app.examTargets[0].examDate),
    [reason, setReason] = useState('根据当前进度、掌握度与可用时间调整'),
    [maxChunk, setMaxChunk] = useState(45),
    [reviews, setReviews] = useState(true),
    [limit, setLimit] = useState<Record<string, string>>({}),
    [budget, setBudget] = useState(false),
    [budgetStart, setBudgetStart] = useState(today()),
    [budgetEnd, setBudgetEnd] = useState(format(addDays(parseISO(today()), 6), 'yyyy-MM-dd')),
    [budgetMinutes, setBudgetMinutes] = useState(30),
    [reviewId, setReviewId] = useState(''),
    [proposal, setProposal] = useState<PlanProposal | null>(null),
    [busy, setBusy] = useState(false),
    [tab, setTab] = useViewState('planner.tab', 'schedule');
  const generate = async () => {
    setBusy(true);
    await app.run(async () => {
      let preferences = app.preferences;
      let changed = false;
      if (budget) {
        if (budgetEnd < budgetStart) throw new Error('特殊日期结束不能早于开始');
        preferences = {
          ...preferences,
          specialBudgets: [
            ...preferences.specialBudgets,
            {
              start: budgetStart,
              end: budgetEnd,
              minutes: budgetMinutes,
              label: reason.slice(0, 80) || '临时安排',
            },
          ],
        };
        changed = true;
      }
      const weekly = app.weeklyReviews.find((r) => r.id === reviewId);
      if (weekly) {
        const next = format(addDays(parseISO(weekly.weekStart), 7), 'yyyy-MM-dd');
        preferences = {
          ...preferences,
          specialBudgets: [
            ...preferences.specialBudgets,
            ...weekly.nextWeekMinutes.map((minutes, i) => {
              const day = format(addDays(parseISO(next), i), 'yyyy-MM-dd');
              return { start: day, end: day, minutes, label: `周复盘预算 ${weekly.weekStart}` };
            }),
          ],
        };
        changed = true;
      }
      const caps = Object.fromEntries(
        Object.entries(limit)
          .filter(([, v]) => v !== '')
          .map(([k, v]) => [k, Number(v)]),
      );
      setProposal(
        await createSchedule(
          {
            from,
            to,
            reason,
            maxChunkMinutes: maxChunk,
            addReviews: reviews,
            subjectDailyLimits: caps,
          },
          changed ? preferences : undefined,
        ),
      );
    });
    setBusy(false);
  };
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">计划跟着你的真实节奏前进</p>
          <h1>动态排期</h1>
          <p>规则引擎在本地运行。先预览差异，只有确认后才写入。</p>
        </div>
      </div>
      {notice && !acknowledged && (
        <section className="warning-box">
          <strong>备考目标、初试日期或考试科目已变化</strong>
          <p>
            请先核对未来任务是否仍适用。共{' '}
            {
              app.tasks.filter(
                (t) =>
                  !t.deletedAt && !['completed', 'skipped'].includes(t.status) && t.date >= today(),
              ).length
            }{' '}
            项未来未完成任务；旧科目、共同知识点与真实学习记录均保留，不自动猜测新院校考试要求。
          </p>
          <details>
            <summary>查看需核对的未来任务</summary>
            {app.tasks
              .filter(
                (t) =>
                  !t.deletedAt && !['completed', 'skipped'].includes(t.status) && t.date >= today(),
              )
              .map((t) => (
                <p key={t.id}>
                  {t.date} · {t.title}
                </p>
              ))}
          </details>
          <Button
            variant="secondary"
            size="sm"
            onClick={() =>
              app.run(
                () =>
                  db.settings.update(notice.id, {
                    value: { acknowledged: true, previousValue: notice.value },
                    updatedAt: new Date().toISOString(),
                  }),
                '已记录你的核对确认',
              )
            }
          >
            我已核对未来任务适用性
          </Button>
        </section>
      )}
      <div className="segmented settings-tabs">
        <button className={tab === 'schedule' ? 'selected' : ''} onClick={() => setTab('schedule')}>
          生成调整建议
        </button>
        <button className={tab === 'history' ? 'selected' : ''} onClick={() => setTab('history')}>
          版本与撤销
        </button>
      </div>
      {tab === 'history' ? (
        <PlanHistory />
      ) : (
        <>
          <form
            className="panel settings-section"
            onSubmit={(e) => {
              e.preventDefault();
              generate();
            }}
          >
            <h2>调整范围与原因</h2>
            <div className="form-grid">
              <label>
                排期开始日期
                <input
                  type="date"
                  required
                  min={today()}
                  max={app.examTargets[0].examDate}
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                />
              </label>
              <label>
                排期结束日期
                <input
                  type="date"
                  required
                  min={from}
                  max={app.examTargets[0].examDate}
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                />
              </label>
              <label className="span-2">
                调整原因
                <textarea
                  required
                  rows={2}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="例如：下周学校考试，先保留数学基础任务"
                />
              </label>
              <label>
                单个学习片段上限（分钟）
                <input
                  type="number"
                  min={1}
                  max={240}
                  required
                  value={maxChunk}
                  onChange={(e) => setMaxChunk(Number(e.target.value))}
                />
              </label>
              <label>
                采用周复盘的下周预算
                <select
                  aria-label="采用周复盘预算"
                  value={reviewId}
                  onChange={(e) => setReviewId(e.target.value)}
                >
                  <option value="">不导入</option>
                  {app.weeklyReviews.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.weekStart} 周复盘
                    </option>
                  ))}
                </select>
              </label>
              <label className="inline-check span-2">
                <input
                  type="checkbox"
                  checked={reviews}
                  onChange={(e) => setReviews(e.target.checked)}
                />
                根据未掌握、薄弱知识点增加基础复习（按周去重）
              </label>
            </div>
            <h3>临时调整可用时间</h3>
            <label className="inline-check">
              <input
                type="checkbox"
                checked={budget}
                onChange={(e) => setBudget(e.target.checked)}
              />
              学校考试 / 假期使用特殊预算，确认方案时一起保存
            </label>
            {budget && (
              <div className="form-grid">
                <label>
                  特殊预算开始
                  <input
                    type="date"
                    required
                    value={budgetStart}
                    onChange={(e) => setBudgetStart(e.target.value)}
                  />
                </label>
                <label>
                  特殊预算结束
                  <input
                    type="date"
                    required
                    value={budgetEnd}
                    onChange={(e) => setBudgetEnd(e.target.value)}
                  />
                </label>
                <label>
                  特殊日期每日分钟
                  <input
                    type="number"
                    min={0}
                    max={1440}
                    required
                    value={budgetMinutes}
                    onChange={(e) => setBudgetMinutes(Number(e.target.value))}
                  />
                </label>
              </div>
            )}
            <h3>各科每日时间上限（可选）</h3>
            <p className="hint">
              留空时按科目优先级分配，并把空余时间再分配。填写后作为硬上限；希望增加数学、减少408时可分别填写目标分钟，总量仍不能超出当天预算。科目优先级可在设置修改。
            </p>
            <div className="form-grid">
              {app.subjects
                .filter((s) => s.active)
                .map((s) => (
                  <label key={s.id}>
                    {s.name}每日上限
                    <input
                      type="number"
                      min={0}
                      max={1440}
                      value={limit[s.id] ?? ''}
                      placeholder="自动分配"
                      onChange={(e) => setLimit({ ...limit, [s.id]: e.target.value })}
                    />
                  </label>
                ))}
            </div>
            <p className="warning-box">
              本次处理全部未完成任务及到期基础复习。已完成、跳过任务与真实计时保持原状；停用科目、缺少依赖或时间不足的内容会明确保留为未排期。
            </p>
            <Button loading={busy} disabled={busy}>
              {busy ? '计算中…' : '生成排期预览'}
            </Button>
          </form>
          <PlanHistory />
        </>
      )}
      {proposal && (
        <ProposalPreview
          proposal={proposal}
          onCancel={() => setProposal(null)}
          onModify={() => setProposal(null)}
          onApplied={() => setTab('history')}
        />
      )}
    </>
  );
}
