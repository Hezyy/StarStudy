import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { format, addDays, parseISO } from 'date-fns';
import { testDatabase, sampleTask } from './helpers';
import type { StarDatabase } from '@/db';
import { readCoreData } from '@/services/backup';
import {
  createSchedule,
  applyProposal,
  versionProposal,
  getPreferences,
  planAtVersion,
  compareVersions,
} from '@/services/plans';
import { shiftTasks } from '@/services/tasks';
import { schedule } from '@/scheduler/engine';
import { saveKnowledge } from '@/services/learning';
import { startTimer, controlTimer } from '@/services/timer';
import { today, defaults } from '@/lib/utils';
import { analyze } from '@/services/analytics';
import { saveWeeklyReview } from '@/services/reviews';
import { weekData } from '@/services/statistics';
const day = today(),
  later = (n: number) => format(addDays(parseISO(day), n), 'yyyy-MM-dd');
const options = () => ({
  from: day,
  to: later(6),
  reason: '考试周每天30分钟',
  maxChunkMinutes: 30,
  addReviews: false,
  subjectDailyLimits: {},
});
describe('规则排期与安全计划版本', () => {
  let d: StarDatabase;
  beforeEach(async () => {
    d = await testDatabase();
  });
  afterEach(async () => {
    await d.delete();
  });
  it('数学优先、长任务拆分、每日预算与总工作量不变', async () => {
    const m = await sampleTask(d, { estimatedMinutes: 80 }),
      cs = (await d.subjects.where('category').equals('cs').first())!;
    await sampleTask(d, { title: '数据结构', subjectId: cs.id, estimatedMinutes: 40 });
    const data = await readCoreData(d);
    const p = schedule(
      {
        ...data,
        today: day,
        examDate: later(20),
        preferences: { ...defaults, weekdayMinutes: 30, weekendMinutes: 30 },
      },
      options(),
    );
    expect(p.unassigned).toHaveLength(0);
    expect(p.changes.reduce((n, c) => n + c.after.estimatedMinutes, 0)).toBe(120);
    for (const date of new Set(p.changes.map((c) => c.after.date)))
      expect(
        p.changes
          .filter((c) => c.after.date === date)
          .reduce((n, c) => n + (c.after.plannedMinutes ?? 0), 0),
      ).toBeLessThanOrEqual(30);
    expect(p.changes.find((c) => c.id === m.id)?.after.date).toBe(day);
  });
  it('依赖前置任务的所有拆分部分完成后才安排后续', async () => {
    const a = await sampleTask(d, { title: '前置', estimatedMinutes: 50 });
    const b = await sampleTask(d, {
      title: '后续',
      dependencyTaskIds: [a.id],
      estimatedMinutes: 20,
    });
    const data = await readCoreData(d);
    const p = schedule(
      {
        ...data,
        today: day,
        examDate: later(20),
        preferences: { ...defaults, weekdayMinutes: 30, weekendMinutes: 30 },
      },
      options(),
    );
    const allA = p.changes.filter((c) => c.id === a.id || c.after.parentTaskId === a.id);
    const assignedB = p.changes.find((c) => c.id === b.id)!;
    expect(
      assignedB.after.date >
        allA
          .map((c) => c.after.date)
          .sort()
          .at(-1)!,
    ).toBe(true);
  });
  it('弱知识点生成复习，循环依赖拒绝，未排期余量保持可见', async () => {
    const subject = (await d.subjects.where('category').equals('math').first())!;
    const k = await saveKnowledge(
      { subjectId: subject.id, name: '基础', dependencyIds: [], mastery: 'weak' },
      undefined,
      d,
    );
    await sampleTask(d, { estimatedMinutes: 200, knowledgePointIds: [k.id] });
    const data = await readCoreData(d);
    const p = schedule(
      {
        ...data,
        today: day,
        examDate: later(20),
        preferences: { ...defaults, weekdayMinutes: 30, weekendMinutes: 30 },
      },
      { ...options(), to: day, addReviews: true },
    );
    expect(p.changes.some((c) => c.after.scheduleKey?.startsWith('review:kp:'))).toBe(true);
    expect(p.unassigned.length).toBeGreaterThan(0);
    expect(p.changes.some((c) => c.after.unscheduled)).toBe(true);
  });
  it('科目停用或截止日期过期会明确列为未安排，不删除已完成', async () => {
    const a = await sampleTask(d, { status: 'completed' });
    const b = await sampleTask(d, {
      title: '过期',
      dueDate: format(addDays(parseISO(day), -1), 'yyyy-MM-dd'),
    });
    const p = await createSchedule(options(), undefined, d);
    expect(p.changes.some((c) => c.id === a.id)).toBe(false);
    expect(p.unassigned.find((c) => c.taskId === b.id)?.reason).toContain('截止');
  });
  it('未确认预览不写库；确认原子应用；过期预览拒绝', async () => {
    const t = await sampleTask(d, { estimatedMinutes: 120 });
    const p = await createSchedule(options(), undefined, d);
    await expect(applyProposal(p, false, d)).rejects.toThrow('确认');
    expect((await d.tasks.get(t.id))?.estimatedMinutes).toBe(120);
    await applyProposal(p, true, d);
    expect(await d.revisions.count()).toBe(2);
    await expect(applyProposal(p, true, d)).rejects.toThrow('发生变化');
  });
  it('撤销只还原计划，后续计时与笔记保留；新增学习记录产生冲突', async () => {
    const t = await sampleTask(d, { estimatedMinutes: 100 });
    const p = await createSchedule({ ...options(), maxChunkMinutes: 30 }, undefined, d);
    const revision = await applyProposal(p, true, d);
    const child = (await d.tasks.toArray()).find((t) => t.parentTaskId)!;
    const session = await startTimer(child.id, Date.now() - 60000, d);
    await controlTimer(session.id, 'stop', Date.now(), d);
    await d.tasks.update(t.id, { notes: '后续真实笔记' });
    const undo = await versionProposal(revision.revisionId, 'undo', d);
    expect(undo.conflicts?.some((c) => c.taskId === child.id)).toBe(true);
    await applyProposal(undo, true, d);
    expect(await d.sessions.count()).toBe(1);
    expect((await d.tasks.get(t.id))?.notes).toBe('后续真实笔记');
    expect((await d.tasks.get(child.id))?.deletedAt).toBeUndefined();
  });
  it('预算调整仅在确认时生效，撤销可恢复预算', async () => {
    await sampleTask(d);
    const pref = { ...defaults, weekdayMinutes: 30, weekendMinutes: 30 };
    const p = await createSchedule(options(), pref, d);
    expect(getPreferences(await readCoreData(d)).weekdayMinutes).toBe(90);
    const r = await applyProposal(p, true, d);
    expect(getPreferences(await readCoreData(d)).weekdayMinutes).toBe(30);
    const undo = await versionProposal(r.revisionId, 'undo', d);
    await applyProposal(undo, true, d);
    expect(getPreferences(await readCoreData(d)).weekdayMinutes).toBe(90);
  });
  it('知识点前置课程的全部拆分片段必须早于后续课程', async () => {
    const subject = (await d.subjects.where('category').equals('math').first())!;
    const a = await saveKnowledge(
      { subjectId: subject.id, name: '矩阵基础', dependencyIds: [], mastery: 'unlearned' },
      undefined,
      d,
    );
    const b = await saveKnowledge(
      { subjectId: subject.id, name: '矩阵的秩', dependencyIds: [a.id], mastery: 'unlearned' },
      undefined,
      d,
    );
    const first = await sampleTask(d, {
      title: '基础课',
      estimatedMinutes: 50,
      knowledgePointIds: [a.id],
    });
    const next = await sampleTask(d, {
      title: '后续课',
      estimatedMinutes: 20,
      knowledgePointIds: [b.id],
    });
    const data = await readCoreData(d);
    const p = schedule(
      {
        ...data,
        today: day,
        examDate: later(20),
        preferences: { ...defaults, weekdayMinutes: 30, weekendMinutes: 30 },
      },
      options(),
    );
    const base = p.changes.filter((c) => c.id === first.id || c.after.parentTaskId === first.id);
    expect(base).toHaveLength(2);
    expect(
      p.changes.find((c) => c.id === next.id)!.after.date >
        base
          .map((c) => c.after.date)
          .sort()
          .at(-1)!,
    ).toBe(true);
    expect(p.unassigned).toHaveLength(0);
  });
  it('特殊日期和各科硬上限共同生效，无法安排的时间不丢失', async () => {
    const math = (await d.subjects.where('category').equals('math').first())!;
    const cs = (await d.subjects.where('category').equals('cs').first())!;
    await sampleTask(d, { title: '数学强化', estimatedMinutes: 40 });
    await sampleTask(d, { title: '408强化', subjectId: cs.id, estimatedMinutes: 40 });
    const data = await readCoreData(d);
    const p = schedule(
      {
        ...data,
        today: day,
        examDate: later(20),
        preferences: {
          ...defaults,
          weekdayMinutes: 90,
          weekendMinutes: 90,
          specialBudgets: [
            { start: day, end: day, minutes: 30, label: '考试' },
            { start: later(1), end: later(1), minutes: 0, label: '休息' },
          ],
        },
      },
      {
        ...options(),
        to: later(2),
        maxChunkMinutes: 20,
        subjectDailyLimits: { [math.id]: 20, [cs.id]: 10 },
      },
    );
    const assigned = p.changes.filter((c) => !c.after.unscheduled);
    expect(assigned.some((c) => c.after.date === later(1))).toBe(false);
    for (const date of [day, later(2)])
      for (const [id, max] of [
        [math.id, 20],
        [cs.id, 10],
      ] as const)
        expect(
          assigned
            .filter((c) => c.after.date === date && c.after.subjectId === id)
            .reduce((n, c) => n + (c.after.plannedMinutes ?? c.after.estimatedMinutes), 0),
        ).toBeLessThanOrEqual(max);
    expect(
      assigned.reduce((n, c) => n + (c.after.plannedMinutes ?? c.after.estimatedMinutes), 0) +
        p.unassigned.reduce((n, u) => n + u.minutes, 0),
    ).toBe(80);
    expect(p.unassigned.reduce((n, u) => n + u.minutes, 0)).toBe(20);
  });
  it('比较完整历史版本并恢复到选中版本，后续计时和完成冲突受保护', async () => {
    const t = await sampleTask(d);
    const initial = (await d.revisions.orderBy('planVersion').last())!;
    await shiftTasks([t.id], later(2), d);
    const selected = (await d.revisions.orderBy('planVersion').last())!;
    await shiftTasks([t.id], later(4), d);
    const latest = (await d.revisions.orderBy('planVersion').last())!;
    const s = await startTimer(t.id, Date.now() - 60000, d);
    await controlTimer(s.id, 'stop', Date.now(), d);
    await d.tasks.update(t.id, { notes: '恢复时仍需保留' });
    const data = await readCoreData(d);
    expect(planAtVersion(data, initial.revisionId).get(t.id)?.date).toBe(day);
    expect(planAtVersion(data, selected.revisionId).get(t.id)?.date).toBe(later(2));
    expect(compareVersions(data, initial.revisionId, latest.revisionId)).toHaveLength(1);
    const p = await versionProposal(selected.revisionId, 'restore', d);
    expect(p.conflicts).toHaveLength(0);
    await applyProposal(p, true, d);
    expect(await d.tasks.get(t.id)).toMatchObject({ date: later(2), notes: '恢复时仍需保留' });
    expect(await d.sessions.count()).toBe(1);
    await d.tasks.update(t.id, { status: 'completed', completedAt: new Date().toISOString() });
    const blocked = await versionProposal(initial.revisionId, 'restore', d);
    expect(blocked.conflicts?.find((c) => c.taskId === t.id)?.reason).toContain('已完成');
    expect(blocked.changes).toHaveLength(0);
    expect((await d.tasks.get(t.id))?.status).toBe('completed');
  });
});
describe('统计与复盘边界', () => {
  it('首页周概况与统计页按当日分配量计算，未排期余量不重复计入预算', async () => {
    const d = await testDatabase();
    try {
      const assigned = await sampleTask(d, { estimatedMinutes: 100 });
      const waiting = await sampleTask(d, { title: '尚未安排的剩余内容', estimatedMinutes: 60 });
      await d.tasks.update(assigned.id, { plannedMinutes: 30 });
      await d.tasks.update(waiting.id, { unscheduled: true });
      const data = await readCoreData(d);
      expect(weekData(data.tasks, data.sessions, day).reduce((n, v) => n + v.planned, 0)).toBe(30);
      expect(analyze(data, day, day).planned).toBe(30);
    } finally {
      await d.delete();
    }
  });
  it('跨午夜按实际日期统计，改期与重复会话输入不重复计时', async () => {
    const d = await testDatabase();
    try {
      const t = await sampleTask(d, { date: '2026-11-10' });
      const start = new Date(2026, 10, 1, 23, 59).getTime();
      const s = await startTimer(t.id, start, d);
      await controlTimer(s.id, 'stop', start + 120000, d);
      const data = await readCoreData(d);
      data.sessions.push(data.sessions[0]);
      const result = analyze(data, '2026-11-01', '2026-11-02', start + 120000);
      expect(result.actual).toBe(2);
      expect(result.subjects.reduce((n, s) => n + s.actual, 0)).toBe(2);
      expect(result.days.map((d) => d.actual)).toEqual([1, 1]);
    } finally {
      await d.delete();
    }
  });
  it('无数据时完成率为null，复盘不修改计划与预算并保存历史', async () => {
    const d = await testDatabase();
    try {
      const data = await readCoreData(d),
        summary = analyze(data, '2026-11-02', '2026-11-08');
      expect(summary.completionRate).toBe(null);
      const s = data.subjects[0];
      const r = await saveWeeklyReview(
        {
          weekStart: '2026-11-02',
          difficulty: '学校考试',
          unclear: '矩阵',
          schoolExams: '周三',
          nextWeekMinutes: [30, 30, 30, 30, 30, 60, 60],
          prioritySubjectId: s.id,
        },
        d,
      );
      expect(r.suggestions?.some((s) => s.includes('数据不足'))).toBe(true);
      expect(await d.tasks.count()).toBe(0);
      expect(getPreferences(await readCoreData(d)).weekdayMinutes).toBe(90);
    } finally {
      await d.delete();
    }
  });
});
