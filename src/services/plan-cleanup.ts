import { db } from '@/db';
import { entity, today, validDate } from '@/lib/utils';
import { taskProtectionReason } from '@/lib/task-protection';
import type { CoreData, StudyTask } from '@/types';
import type { PlanProposal } from '@/scheduler/types';
import { readCoreData } from './backup';
import { stateToken } from './plans';
import { plannedMinutes } from './analytics';

export interface CleanupScope {
  from?: string;
  to?: string;
  subjectId?: string;
}
export interface CleanupPreview {
  proposal: PlanProposal;
  protectedTasks: { task: StudyTask; reason: string }[];
  matchedCount: number;
}

/** Preview only. applyProposal performs fresh validation and the transactional, approved write. */
export function buildPlanCleanup(data: CoreData, scope: CleanupScope): CleanupPreview {
  if (
    (scope.from !== undefined && !validDate(scope.from)) ||
    (scope.to !== undefined && !validDate(scope.to))
  )
    throw new Error('请选择有效的清理日期');
  if (scope.from && scope.to && scope.from > scope.to) throw new Error('结束日期不能早于开始日期');
  if (
    scope.subjectId !== undefined &&
    !data.subjects.some((subject) => subject.id === scope.subjectId)
  )
    throw new Error('所选科目不存在，请重新选择');
  const live = data.tasks.filter((task) => !task.deletedAt);
  const matched = live.filter(
    (task) =>
      (!scope.from || task.date >= scope.from) &&
      (!scope.to || task.date <= scope.to) &&
      (!scope.subjectId || task.subjectId === scope.subjectId),
  );
  const removable = new Set<string>();
  const protectedReasons = new Map<string, string>();
  for (const task of matched) {
    const reason = taskProtectionReason(task, data.sessions, data.taskResources);
    if (reason) protectedReasons.set(task.id, reason);
    else removable.add(task.id);
  }
  // Keep every prerequisite still needed by an untouched task, transitively.
  let changed = true;
  while (changed) {
    changed = false;
    for (const task of live) {
      if (removable.has(task.id) || ['completed', 'skipped'].includes(task.status)) continue;
      for (const id of task.dependencyTaskIds ?? []) {
        if (!removable.delete(id)) continue;
        protectedReasons.set(id, `仍被未清理任务「${task.title}」依赖`);
        changed = true;
      }
    }
  }
  const targets = matched.filter((task) => removable.has(task.id));
  const protectedTasks = matched
    .filter((task) => protectedReasons.has(task.id))
    .map((task) => ({ task, reason: protectedReasons.get(task.id)! }));
  const stamp = new Date().toISOString();
  const dates = matched.map((task) => task.date).sort();
  const subject = data.subjects.find((item) => item.id === scope.subjectId)?.name ?? '全部科目';
  const range =
    scope.from || scope.to ? `${scope.from ?? '最早'}至${scope.to ?? '最晚'}` : '全部日期';
  return {
    matchedCount: matched.length,
    protectedTasks,
    proposal: {
      id: entity().id,
      generatedAt: stamp,
      kind: 'manual',
      stateToken: stateToken(data),
      from: scope.from ?? dates[0] ?? today(),
      to: scope.to ?? dates.at(-1) ?? today(),
      reason: `清空未开始计划（${range} · ${subject}，用户确认；保留任务历史与笔记）`,
      changes: targets.map((task) => ({
        id: task.id,
        before: task,
        after: { ...task, deletedAt: stamp, updatedAt: stamp },
        reason: '从计划移除未开始任务，原内容保留并可撤销',
        type: 'archive',
      })),
      unassigned: [],
      requiredMinutes: targets.reduce((sum, task) => sum + plannedMinutes(task), 0),
      availableMinutes: 0,
      warnings: [
        '仅清理未开始且没有学习记录的任务。已完成、有进度、有计时或观看记录的任务自动保留。',
        ...(protectedTasks.length ? [`本次保留${protectedTasks.length}项受保护任务。`] : []),
      ],
    },
  };
}

export async function createPlanCleanup(scope: CleanupScope, database = db) {
  return buildPlanCleanup(await readCoreData(database), scope);
}
