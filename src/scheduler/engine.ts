import { eachDayOfInterval, format, parseISO, startOfWeek } from 'date-fns';
import type { StudyTask } from '@/types';
import { budgetFor, taskSeconds, validDate } from '@/lib/utils';
import { secondsOnDate } from '@/services/statistics';
import { plannedMinutes } from '@/services/analytics';
import { assertAcyclic } from '@/services/learning';
import { needsReview } from '@/lib/mastery';
import type { PlanProposal, ScheduleData, ScheduleOptions } from './types';
export function stableId(seed: string) {
  const bytes = new Uint8Array(16);
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  for (let i = 0; i < 16; i++) {
    h = Math.imul(h ^ (h >>> 13), 2246822507);
    bytes[i] = h & 255;
  }
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const s = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}
export function remainingMinutes(
  task: StudyTask,
  data: Pick<ScheduleData, 'sessions'>,
  now = Date.now(),
) {
  return Math.max(
    0,
    Math.ceil(task.estimatedMinutes - taskSeconds(task.id, data.sessions, now) / 60),
  );
}
export function schedule(data: ScheduleData, options: ScheduleOptions): PlanProposal {
  if (
    !validDate(options.from) ||
    !validDate(options.to) ||
    options.from < data.today ||
    options.to < options.from ||
    options.to > data.examDate
  )
    throw new Error('排期范围须在今天至初试日期之间');
  const days = eachDayOfInterval({ start: parseISO(options.from), end: parseISO(options.to) }).map(
    (d) => format(d, 'yyyy-MM-dd'),
  );
  if (days.length > 1096) throw new Error('排期范围不能超过三年');
  if (
    !Number.isInteger(options.maxChunkMinutes) ||
    options.maxChunkMinutes < 1 ||
    options.maxChunkMinutes > 240
  )
    throw new Error('拆分时长须为1–240分钟');
  for (const cap of Object.values(options.subjectDailyLimits))
    if (!Number.isInteger(cap) || cap < 0 || cap > 1440)
      throw new Error('科目每日上限须为0–1440分钟');
  assertAcyclic(data.knowledgePoints);
  const stamp = options.generatedAt ?? `${data.today}T00:00:00.000Z`,
    now = new Date(stamp).getTime();
  const live = data.tasks.filter((t) => !t.deletedAt),
    selected = new Set(
      options.taskIds ??
        live.filter((t) => !['completed', 'skipped'].includes(t.status)).map((t) => t.id),
    );
  const originals = live.filter(
    (t) => selected.has(t.id) && !['completed', 'skipped'].includes(t.status),
  );
  const candidates: StudyTask[] = originals.map((t) => ({
    ...t,
    dependencyTaskIds: [...(t.dependencyTaskIds ?? [])],
  }));
  const proposal: PlanProposal = {
    id: stableId(`proposal:${stamp}`),
    generatedAt: stamp,
    reason: options.reason || '按预算与知识点依赖重排',
    kind: 'schedule',
    stateToken: '',
    changes: [],
    unassigned: [],
    warnings: [],
    requiredMinutes: 0,
    availableMinutes: 0,
    from: options.from,
    to: options.to,
  };
  const subjects = new Map(data.subjects.map((s) => [s.id, s]));
  const points = new Map(data.knowledgePoints.map((k) => [k.id, k]));
  const added = new Set<string>();
  if (options.addReviews) {
    const keys = new Set(live.map((t) => t.scheduleKey));
    const week = format(startOfWeek(parseISO(options.from), { weekStartsOn: 1 }), 'yyyy-MM-dd');
    const needed = new Set(
      data.knowledgePoints.filter((k) => !k.archivedAt && needsReview(k.mastery)).map((k) => k.id),
    );
    for (const t of originals)
      for (const id of t.knowledgePointIds)
        for (const dep of points.get(id)?.dependencyIds ?? [])
          if (
            !['basic', 'proficient'].includes(points.get(dep)?.mastery ?? 'unlearned') &&
            !live.some(
              (t) =>
                !['completed', 'skipped'].includes(t.status) && t.knowledgePointIds.includes(dep),
            )
          )
            needed.add(dep);
    for (const id of needed) {
      const k = points.get(id)!;
      if (!subjects.get(k.subjectId)?.active) continue;
      const key = `review:kp:${id}:${week}`;
      if (keys.has(key)) continue;
      const preferred = stableId(key);
      const reviewId = data.tasks.some((t) => t.id === preferred)
        ? stableId(`${key}:${stamp}`)
        : preferred;
      const e = { id: reviewId, createdAt: stamp, updatedAt: stamp };
      const t: StudyTask = {
        ...e,
        title: `基础复习：${k.name}`,
        date: options.from,
        originDate: options.from,
        subjectId: k.subjectId,
        chapter: k.chapter ?? '',
        courseName: '',
        courseUrl: '',
        exercises: '回顾定义、重做基础例题，并主动评估掌握程度',
        estimatedMinutes: 20,
        status: 'todo',
        notes: '',
        knowledgePointIds: [id],
        priority: 1,
        scheduleKey: key,
        dependencyTaskIds: [],
      };
      candidates.push(t);
      added.add(t.id);
      keys.add(key);
    }
  }
  const byId = new Map(candidates.map((t) => [t.id, t]));
  for (const t of candidates) {
    for (const kpId of t.knowledgePointIds) {
      const k = points.get(kpId);
      if (!k) continue;
      const review = candidates.find(
        (v) =>
          v.id !== t.id &&
          v.scheduleKey?.startsWith(`review:kp:${kpId}:`) &&
          !t.scheduleKey?.startsWith('review:kp:'),
      );
      if (review) t.dependencyTaskIds!.push(review.id);
      for (const dep of k.dependencyIds) {
        if (['basic', 'proficient'].includes(points.get(dep)?.mastery ?? 'unlearned')) continue;
        const provider = candidates
          .filter((v) => v.id !== t.id && v.knowledgePointIds.includes(dep))
          .sort((a, b) => a.date.localeCompare(b.date))[0];
        if (provider) t.dependencyTaskIds!.push(provider.id);
        else t.dependencyTaskIds!.push(`missing:${dep}`);
      }
    }
    t.dependencyTaskIds = [...new Set(t.dependencyTaskIds)];
  }
  const amounts = new Map(candidates.map((t) => [t.id, remainingMinutes(t, data, now)]));
  proposal.requiredMinutes = [...amounts.values()].reduce((a, b) => a + b, 0);
  const slots = new Map<string, { date: string; minutes: number }[]>(),
    finished = new Map<string, string>(),
    blocked = new Map<string, string>();
  for (const t of candidates) {
    if (!subjects.get(t.subjectId)?.active)
      blocked.set(t.id, '科目已停用，需手动确认内容是否适用于新考试科目');
    if (data.sessions.some((s) => s.taskId === t.id && s.state !== 'ended'))
      blocked.set(t.id, '任务计时尚未结束，请结束后重新预览');
    if (t.dueDate && t.dueDate < options.from)
      blocked.set(t.id, '截止日期已过，请修改截止日期后重新规划');
    if (!amounts.get(t.id)) blocked.set(t.id, '预计时长已用完，但任务未完成；请手动补充剩余估时');
  }
  const dependencyReady = (t: StudyTask, day: string) =>
    t.dependencyTaskIds!.every((id) => {
      if (finished.has(id)) return finished.get(id)! < day;
      const fixed = live.find((t) => t.id === id);
      return (
        !byId.has(id) &&
        !!fixed &&
        (fixed.status === 'completed' ||
          (!fixed.unscheduled && fixed.date >= data.today && fixed.date < day))
      );
    });
  const fixed = live.filter((t) => !byId.has(t.id) && t.status !== 'skipped' && !t.unscheduled);
  const fixedIds = new Set(fixed.map((t) => t.id));
  const sorted = [...candidates].sort(
    (a, b) =>
      (subjects.get(a.subjectId)?.priority ?? 9) - (subjects.get(b.subjectId)?.priority ?? 9) ||
      a.priority - b.priority ||
      (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') ||
      a.date.localeCompare(b.date) ||
      a.id.localeCompare(b.id),
  );
  for (const day of days) {
    const budget = budgetFor(day, data.preferences),
      reserved = fixed.filter((t) => t.date === day).reduce((n, t) => n + plannedMinutes(t), 0),
      actual =
        secondsOnDate(
          data.sessions.filter((s) => !fixedIds.has(s.taskId)),
          day,
          now,
        ) / 60;
    let capacity = Math.max(0, Math.floor(budget - reserved - actual));
    proposal.availableMinutes += capacity;
    if (reserved + actual > budget)
      proposal.warnings.push(`${day} 已有固定任务或实际学习超出预算，不能覆盖历史`);
    const ready = sorted.filter(
      (t) =>
        !blocked.has(t.id) &&
        (amounts.get(t.id) ?? 0) > 0 &&
        (!t.dueDate || day <= t.dueDate) &&
        dependencyReady(t, day),
    );
    const subjectIds = [...new Set(ready.map((t) => t.subjectId))];
    const weights = Object.fromEntries(
      subjectIds.map((id) => [id, 1 / Math.max(1, subjects.get(id)?.priority ?? 4)]),
    );
    const weightSum = Object.values(weights).reduce((a, b) => a + b, 0);
    const used: Record<string, number> = {};
    const softCaps = Object.fromEntries(
      subjectIds.map((id) => [id, Math.max(1, Math.ceil((capacity * weights[id]) / weightSum))]),
    );
    for (const borrow of [false, true]) {
      let progress = true;
      while (capacity > 0 && progress) {
        progress = false;
        for (const t of ready) {
          const left = amounts.get(t.id) ?? 0;
          if (!left || capacity <= 0) continue;
          const explicit = options.subjectDailyLimits[t.subjectId];
          const cap = explicit ?? (borrow ? 1440 : softCaps[t.subjectId]);
          const free = Math.max(0, cap - (used[t.subjectId] ?? 0));
          const size = Math.min(left, capacity, free, options.maxChunkMinutes);
          if (size <= 0) continue;
          (slots.get(t.id) ?? (slots.set(t.id, []), slots.get(t.id)!)).push({
            date: day,
            minutes: size,
          });
          amounts.set(t.id, left - size);
          used[t.subjectId] = (used[t.subjectId] ?? 0) + size;
          capacity -= size;
          progress = true;
          if (left === size) finished.set(t.id, day);
        }
      }
    }
  }
  for (const t of candidates) {
    const portions = slots.get(t.id) ?? [],
      remaining = amounts.get(t.id) ?? 0;
    const before = originals.find((v) => v.id === t.id);
    const spent = Math.ceil(taskSeconds(t.id, data.sessions, now) / 60);
    const reason = added.has(t.id)
      ? '掌握度较弱或缺少前置基础，新增复习'
      : t.date < options.from
        ? '积压任务按可用时间重新分配'
        : '按科目优先级、截止日期与预算分配';
    if (portions.length) {
      portions.forEach((p, i) => {
        const id = i === 0 ? t.id : stableId(`split:${t.id}:${stamp}:${i}`);
        const after: StudyTask = {
          ...t,
          id,
          createdAt: i === 0 ? t.createdAt : stamp,
          updatedAt: stamp,
          date: p.date,
          plannedMinutes: p.minutes,
          estimatedMinutes: p.minutes + (i === 0 ? spent : 0),
          unscheduled: false,
          parentTaskId: i === 0 ? t.parentTaskId : t.id,
          title:
            i === 0 ? t.title : `${t.title.slice(0, 260)}（${t.originDate ?? t.date} 续 ${i + 1}）`,
          status: i === 0 ? t.status : 'todo',
          notes: i === 0 ? t.notes : '',
          sourceKey: i === 0 ? t.sourceKey : undefined,
          originDate: t.originDate ?? t.date,
          dependencyTaskIds: i === 0 ? t.dependencyTaskIds : [],
        };
        proposal.changes.push({
          id,
          before: i === 0 ? before : undefined,
          after,
          reason,
          type:
            added.has(t.id) && i === 0
              ? 'new'
              : i > 0
                ? 'split'
                : t.date !== p.date
                  ? 'move'
                  : 'update',
        });
      });
    }
    if (remaining > 0 || blocked.has(t.id)) {
      const why =
        blocked.get(t.id) ??
        (t.dependencyTaskIds!.some(
          (id) => !finished.has(id) && !live.some((t) => t.id === id && t.status === 'completed'),
        )
          ? '前置知识点/任务未安排、循环依赖或缺失依赖'
          : '时间预算、科目上限或截止日期内容量不足');
      let id = t.id;
      if (portions.length) {
        id = stableId(`remaining:${t.id}:${stamp}`);
        const after = {
          ...t,
          id,
          title: `${t.title.slice(0, 280)}（未排期余量）`,
          createdAt: stamp,
          updatedAt: stamp,
          parentTaskId: t.id,
          estimatedMinutes: remaining,
          plannedMinutes: remaining,
          unscheduled: true,
          status: 'todo' as const,
          notes: '',
          sourceKey: undefined,
          dependencyTaskIds: [],
        };
        proposal.changes.push({ id, after, reason: why, type: 'split' });
      } else if (added.has(t.id))
        proposal.changes.push({ id, after: { ...t, unscheduled: true }, reason: why, type: 'new' });
      else if (before && !before.unscheduled)
        proposal.changes.push({
          id,
          before,
          after: { ...before, unscheduled: true, updatedAt: stamp },
          reason: why,
          type: 'update',
        });
      proposal.unassigned.push({ taskId: id, title: t.title, minutes: remaining, reason: why });
    }
  }
  const lastParts = new Map<string, string>();
  for (const t of candidates) {
    const count = slots.get(t.id)?.length ?? 0;
    if (count)
      lastParts.set(t.id, count === 1 ? t.id : stableId(`split:${t.id}:${stamp}:${count - 1}`));
  }
  for (const c of proposal.changes)
    c.after.dependencyTaskIds = (c.after.dependencyTaskIds ?? []).map(
      (id) => lastParts.get(id) ?? id,
    );
  return proposal;
}
