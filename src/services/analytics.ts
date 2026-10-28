import {
  addDays,
  differenceInCalendarDays,
  eachDayOfInterval,
  format,
  parseISO,
  startOfWeek,
  subDays,
} from 'date-fns';
import type { CoreData, Preferences, StudyTask } from '@/types';
import { budgetFor, validDate } from '@/lib/utils';
import { secondsOnDate, streak, plannedMinutes } from './statistics';
import { needsReview, masteryValues, masteryLabels } from '@/lib/mastery';
export { plannedMinutes } from './statistics';
export function analyze(data: CoreData, from: string, to: string, now = Date.now()) {
  if (
    !validDate(from) ||
    !validDate(to) ||
    to < from ||
    differenceInCalendarDays(parseISO(to), parseISO(from)) > 1095
  )
    throw new Error('统计范围须为有效日期且不超过三年');
  const sessions = [...new Map(data.sessions.map((s) => [s.id, s])).values()];
  const localDate = (stamp: string) => format(parseISO(stamp), 'yyyy-MM-dd');
  const cutoff = [to, format(new Date(now), 'yyyy-MM-dd')].sort()[0];
  const inRange = (date: string) => date >= from && date <= to;
  const tasks = data.tasks.filter((t) => !t.deletedAt && inRange(t.date));
  const firstPlans = new Map<string, StudyTask>();
  for (const r of [...data.revisions].sort((a, b) => a.planVersion - b.planVersion))
    for (const t of [...r.beforeSnapshot, ...r.afterSnapshot])
      if (!firstPlans.has(t.id)) firstPlans.set(t.id, t);
  const originalPlanned = data.tasks
    .filter((t) => !t.parentTaskId && inRange(t.originDate ?? t.date))
    .reduce((n, t) => n + (firstPlans.get(t.id)?.estimatedMinutes ?? t.estimatedMinutes), 0);
  const days = eachDayOfInterval({ start: parseISO(from), end: parseISO(to) }).map((d) => {
    const date = format(d, 'yyyy-MM-dd');
    const local = data.tasks.filter((t) => !t.deletedAt && t.date === date);
    return {
      date,
      label: date.slice(5),
      planned: local.reduce((n, t) => n + plannedMinutes(t), 0),
      actual: secondsOnDate(sessions, date, now) / 60,
      completed: local.filter((t) => t.status === 'completed').length,
      total: local.length,
      backlog: data.tasks.filter((t) => {
        const original = t.originDate ?? t.date;
        if (original >= date || (t.deletedAt && localDate(t.deletedAt) <= date)) return false;
        if (t.status === 'skipped') return false;
        if (t.status === 'completed') {
          return !!t.completedAt && localDate(t.completedAt) > date;
        }
        return true;
      }).length,
    };
  });
  const groups = (kind: 'week' | 'month') => {
    const map = new Map<string, { date: string; planned: number; actual: number }>();
    for (const d of days) {
      const key =
        kind === 'week'
          ? format(startOfWeek(parseISO(d.date), { weekStartsOn: 1 }), 'yyyy-MM-dd')
          : d.date.slice(0, 7);
      const v = map.get(key) ?? { date: key, planned: 0, actual: 0 };
      v.planned += d.planned;
      v.actual += d.actual;
      map.set(key, v);
    }
    return [...map.values()];
  };
  const subjects = data.subjects.map((s) => {
    const subTasks = tasks.filter((t) => t.subjectId === s.id),
      ids = new Set(data.tasks.filter((t) => t.subjectId === s.id).map((t) => t.id));
    return {
      id: s.id,
      name: s.name,
      category: s.category,
      active: s.active,
      planned: subTasks.reduce((n, t) => n + plannedMinutes(t), 0),
      actual: days.reduce(
        (n, d) =>
          n +
          secondsOnDate(
            sessions.filter((v) => ids.has(v.taskId)),
            d.date,
            now,
          ) /
            60,
        0,
      ),
      completed: subTasks.filter((t) => t.status === 'completed').length,
      total: subTasks.length,
    };
  });
  const pending = data.tasks
    .filter(
      (t) =>
        !t.deletedAt &&
        !['completed', 'skipped'].includes(t.status) &&
        (t.originDate ?? t.date) < cutoff &&
        from <= cutoff,
    )
    .map((t) => ({
      ...t,
      ageDays: Math.max(
        0,
        differenceInCalendarDays(parseISO(cutoff), parseISO(t.originDate ?? t.date)),
      ),
    }));
  const weak = data.knowledgePoints.filter((k) => !k.archivedAt && needsReview(k.mastery));
  const mistakes = data.mistakes.filter((m) => !m.archivedAt),
    due = mistakes.filter((m) => m.reviewDate <= cutoff && from <= cutoff),
    reviews = data.mistakeReviews.filter((r) => inRange(localDate(r.reviewedAt)));
  const totalPlanned = days.reduce((n, d) => n + d.planned, 0),
    totalActual = days.reduce((n, d) => n + d.actual, 0),
    completed = tasks.filter((t) => t.status === 'completed').length;
  return {
    from,
    to,
    days,
    weeks: groups('week'),
    months: groups('month'),
    subjects,
    pending,
    weak,
    due,
    mistakeCount: mistakes.length,
    reviewCount: reviews.length,
    planned: totalPlanned,
    originalPlanned,
    actual: totalActual,
    completed,
    total: tasks.length,
    completionRate: tasks.length ? completed / tasks.length : null,
    streak: streak(sessions, cutoff),
    mastery: masteryValues.map((v) => ({
      state: v,
      name: masteryLabels[v],
      count: data.knowledgePoints.filter((k) => !k.archivedAt && k.mastery === v).length,
    })),
    hasTimeData: totalActual > 0,
    unknownCompletionDates: data.tasks.filter((t) => t.status === 'completed' && !t.completedAt)
      .length,
  };
}
export function weekSuggestions(
  summary: ReturnType<typeof analyze>,
  preferences: Preferences,
  nextStart: string,
  nextMinutes?: number[],
  prioritySubjectId?: string,
) {
  const suggestions: string[] = [];
  if (!summary.total && !summary.hasTimeData)
    suggestions.push('数据不足：本周尚无任务或计时记录，先建立少量可完成任务，再评估学习负荷。');
  if (summary.total && !summary.hasTimeData)
    suggestions.push('本周尚无实际计时数据，完成状态只能代表自报进度；下周请记录专注时间。');
  if (summary.pending.length)
    suggestions.push(
      `先处理 ${summary.pending.length} 项积压任务，最长已积压 ${Math.max(...summary.pending.map((t) => t.ageDays))} 天；不要把全部积压挤到同一天。`,
    );
  if (summary.weak.length)
    suggestions.push(
      `有 ${summary.weak.length} 个未掌握或薄弱知识点，先补基础，再安排依赖这些概念的后续章节。`,
    );
  if (summary.due.length)
    suggestions.push(
      `有 ${summary.due.length} 道到期错题，建议每天安排小段重做，并手动评估掌握度。`,
    );
  const math = summary.subjects
    .filter((s) => s.category === 'math')
    .reduce((n, s) => n + s.actual, 0);
  if (math === 0) suggestions.push('数学默认优先：下周先为数学基础和针对性练习保留固定时间。');
  const available = Array.from(
    { length: 7 },
    (_, i) =>
      nextMinutes?.[i] ??
      budgetFor(format(addDays(parseISO(nextStart), i), 'yyyy-MM-dd'), preferences),
  ).reduce((n, v) => n + v, 0);
  suggestions.push(`下周可用时间合计 ${available} 分钟；排期预览会检查任务总量与时间缺口。`);
  if (prioritySubjectId) {
    const s = summary.subjects.find((s) => s.id === prioritySubjectId);
    if (s)
      suggestions.push(`用户希望优先提高：${s.name}。这是一项偏好，仍需遵守总预算和知识点依赖。`);
  }
  if (summary.actual > summary.planned && summary.planned > 0)
    suggestions.push('实际学习时长高于计划，请复核任务估时，给复习和休息留出余量。');
  return suggestions;
}
export function recentSummary(data: CoreData, days: number, to: string, now = Date.now()) {
  return analyze(data, format(subDays(parseISO(to), days - 1), 'yyyy-MM-dd'), to, now);
}
