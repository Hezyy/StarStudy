import { z } from 'zod';
import { db } from '@/db';
import {
  TABLE_NAMES,
  type CoreData,
  type Preferences,
  type StudyTask,
  type PlanRevision,
} from '@/types';
import { entity, defaults, taskFingerprint, taskSeconds } from '@/lib/utils';
import { taskSchema } from '@/schemas';
import { readCoreData, preferencesValue } from './backup';
import { plannedMinutes } from './analytics';
import { budgetFor, today } from '@/lib/utils';
import { secondsOnDate } from './statistics';
import { schedule } from '@/scheduler/engine';
import type { PlanProposal, ScheduleOptions } from '@/scheduler/types';
const fields = [
  'date',
  'estimatedMinutes',
  'plannedMinutes',
  'subjectId',
  'title',
  'chapter',
  'courseName',
  'courseUrl',
  'exercises',
  'knowledgePointIds',
  'priority',
  'dueDate',
  'dependencyTaskIds',
  'deletedAt',
  'unscheduled',
  'parentTaskId',
  'scheduleKey',
] as const;
export function planFields(t: StudyTask) {
  return Object.fromEntries(fields.map((k) => [k, t[k] ?? null]));
}
const samePlan = (a: StudyTask, b: StudyTask) =>
  JSON.stringify(planFields(a)) === JSON.stringify(planFields(b));
export function stateToken(data: CoreData) {
  return JSON.stringify(
    TABLE_NAMES.map((n) => [
      n,
      data[n]
        .map((v) => ({
          id: v.id,
          updatedAt: v.updatedAt,
          ...(n === 'tasks'
            ? { plan: planFields(v as StudyTask), status: (v as StudyTask).status }
            : {}),
          ...(n === 'sessions' ? { value: v } : {}),
          ...(n === 'settings' ? { value: v } : {}),
        }))
        .sort((a, b) => a.id.localeCompare(b.id)),
    ]),
  );
}
export const getPreferences = (data: CoreData) =>
  preferencesValue(data.settings.find((s) => s.key === 'preferences')?.value ?? defaults);
export async function createSchedule(
  options: ScheduleOptions,
  preferencesAfter?: Preferences,
  database = db,
) {
  const data = await readCoreData(database),
    preferences = getPreferences(data);
  const result = schedule(
    {
      ...data,
      preferences: preferencesAfter ?? preferences,
      examDate: data.examTargets[0].examDate,
      today: today(),
    },
    { ...options, generatedAt: new Date().toISOString() },
  );
  result.stateToken = stateToken(data);
  if (preferencesAfter) {
    result.preferencesBefore = preferences;
    result.preferencesAfter = preferencesValue(preferencesAfter);
  }
  return result;
}
export function validateProposal(proposal: PlanProposal, data: CoreData) {
  const current = new Map(data.tasks.map((t) => [t.id, t])),
    ids = new Set<string>(),
    fingerprints = new Set(data.tasks.filter((t) => !t.deletedAt).map(taskFingerprint));
  const after = new Map(current);
  for (const c of proposal.changes) {
    z.uuid().parse(c.id);
    taskSchema.parse(c.after);
    if (c.id !== c.after.id || ids.has(c.id)) throw new Error('调整中存在重复或不一致的任务ID');
    ids.add(c.id);
    const old = current.get(c.id);
    if (c.before && !old) throw new Error('原任务不存在');
    if (!c.before && old) throw new Error('新任务ID已经存在');
    if (old?.status === 'completed' && !samePlan(old, c.after))
      throw new Error('已完成任务不能被计划调整覆盖');
    if (old && old.status !== c.after.status) throw new Error('计划调整不能修改学习状态');
    if (!old && c.after.status !== 'todo') throw new Error('新增计划任务必须为未完成');
    if (
      c.after.deletedAt &&
      old &&
      (data.sessions.some((s) => s.taskId === old.id) || old.status === 'completed')
    )
      throw new Error('有学习记录的任务不能被计划调整取消');
    if (!data.subjects.some((s) => s.id === c.after.subjectId)) throw new Error('任务科目不存在');
    for (const id of c.after.knowledgePointIds)
      if (!data.knowledgePoints.some((k) => k.id === id && k.subjectId === c.after.subjectId))
        throw new Error('关联知识点不存在或科目不匹配');
    if (!old) {
      const key = taskFingerprint(c.after);
      if (fingerprints.has(key)) throw new Error('新增任务与已有任务重复');
      fingerprints.add(key);
    }
    if (
      old &&
      c.after.estimatedMinutes !== old.estimatedMinutes &&
      c.after.estimatedMinutes < Math.ceil(taskSeconds(old.id, data.sessions) / 60)
    )
      throw new Error('预计时长不能少于已有真实学习时长');
    if (
      ['schedule', 'external'].includes(proposal.kind) &&
      !c.after.unscheduled &&
      !c.after.deletedAt &&
      (c.after.date < today() || c.after.date > data.examTargets[0].examDate)
    )
      throw new Error('计划日期须在今天至初试日期之间');
    after.set(c.id, c.after);
  }
  const revived = new Set(
    proposal.changes
      .filter((change) => current.get(change.id)?.deletedAt && !change.after.deletedAt)
      .map((change) => change.id),
  );
  const finalKeys = new Map<string, string>();
  for (const task of after.values()) {
    if (task.deletedAt) continue;
    const key = taskFingerprint(task);
    const existingId = finalKeys.get(key);
    if (existingId && (revived.has(task.id) || revived.has(existingId)))
      throw new Error('恢复的任务与当前计划重复，请先处理重新导入的任务');
    finalKeys.set(key, task.id);
  }
  const live = [...after.values()].filter(
    (t) => !t.deletedAt && !t.unscheduled && t.status !== 'skipped',
  );
  const pref = proposal.preferencesAfter ?? getPreferences(data);
  const affected = new Set(
    proposal.changes
      .filter((c) => !c.after.unscheduled && !c.after.deletedAt)
      .map((c) => c.after.date),
  );
  for (const date of affected) {
    const sum = live.filter((t) => t.date === date).reduce((n, t) => n + plannedMinutes(t), 0);
    const oldIds = new Set(proposal.changes.filter((c) => c.before).map((c) => c.id));
    const studied =
      secondsOnDate(
        data.sessions.filter((s) => oldIds.has(s.taskId)),
        date,
      ) / 60;
    if (
      ['schedule', 'external'].includes(proposal.kind) &&
      sum + studied > budgetFor(date, pref) + 0.01
    )
      throw new Error(`${date} 超出每日时间预算（计划${sum} + 已学习${Math.ceil(studied)}分钟）`);
  }
  for (const t of live) {
    const relevant =
      ids.has(t.id) ||
      (t.dependencyTaskIds ?? []).some((id) => ids.has(id)) ||
      t.knowledgePointIds.some((id) =>
        (data.knowledgePoints.find((k) => k.id === id)?.dependencyIds ?? []).some((dep) =>
          proposal.changes.some((c) => c.after.knowledgePointIds.includes(dep)),
        ),
      );
    if (!relevant) continue;
    if (t.deletedAt || t.unscheduled || t.status === 'completed') continue;
    for (const id of t.dependencyTaskIds ?? []) {
      const dep = after.get(id);
      if (
        !dep ||
        dep.deletedAt ||
        dep.unscheduled ||
        dep.status === 'skipped' ||
        (dep.status !== 'completed' && dep.date >= t.date)
      )
        throw new Error(`任务「${t.title}」不满足前置任务依赖`);
    }
    if (['schedule', 'external'].includes(proposal.kind))
      for (const id of t.knowledgePointIds) {
        const point = data.knowledgePoints.find((k) => k.id === id);
        for (const depId of point?.dependencyIds ?? []) {
          const dep = data.knowledgePoints.find((k) => k.id === depId);
          if (dep && ['basic', 'proficient'].includes(dep.mastery)) continue;
          if (
            !live.some(
              (p) =>
                p.id !== t.id &&
                p.knowledgePointIds.includes(depId) &&
                (p.status === 'completed' || p.date < t.date),
            )
          )
            throw new Error(`任务「${t.title}」缺少前置知识点学习安排`);
        }
      }
  }
  return after;
}
export async function applyProposal(proposal: PlanProposal, approved: boolean, database = db) {
  if (!approved) throw new Error('必须先由用户确认调整');
  if (!proposal.changes.length && !proposal.preferencesAfter)
    throw new Error('没有可应用的计划差异');
  return database.transaction(
    'rw',
    TABLE_NAMES.map((n) => database.table(n)),
    async () => {
      const data = await readCoreData(database);
      if (proposal.stateToken !== stateToken(data))
        throw new Error('预览后数据已发生变化，请重新生成方案');
      if (data.sessions.some((s) => s.state !== 'ended'))
        throw new Error('请先结束所有计时，再应用计划');
      validateProposal(proposal, data);
      const stamp = new Date().toISOString(),
        before: StudyTask[] = [],
        after: StudyTask[] = [];
      for (const change of proposal.changes) {
        const old = data.tasks.find((t) => t.id === change.id);
        if (old) before.push(old);
        const task = old
          ? {
              ...old,
              ...Object.fromEntries(fields.map((k) => [k, change.after[k]])),
              updatedAt: stamp,
            }
          : { ...change.after, createdAt: stamp, updatedAt: stamp };
        after.push(task as StudyTask);
      }
      await database.tasks.bulkPut(after);
      if (proposal.preferencesAfter) {
        const s = data.settings.find((s) => s.key === 'preferences')!;
        await database.settings.put({ ...s, value: proposal.preferencesAfter, updatedAt: stamp });
      }
      const e = entity(),
        last = await database.revisions.orderBy('planVersion').last();
      const revision: PlanRevision = {
        ...e,
        revisionId: e.id,
        planVersion: (last?.planVersion ?? 0) + 1,
        createdAt: stamp,
        updatedAt: stamp,
        approvedAt: stamp,
        kind: proposal.kind,
        reason: proposal.reason,
        changes: proposal.changes.map((c) => `${c.type}: ${c.after.title} · ${c.reason}`),
        beforeSnapshot: before,
        afterSnapshot: after,
        beforePreferences: proposal.preferencesBefore,
        afterPreferences: proposal.preferencesAfter,
        restoresRevisionId: proposal.restoresRevisionId,
      };
      await database.revisions.add(revision);
      return revision;
    },
  );
}
export async function versionProposal(
  revisionId: string,
  mode: 'undo' | 'restore',
  database = db,
): Promise<PlanProposal> {
  const data = await readCoreData(database);
  const revisions = [...data.revisions].sort((a, b) => a.planVersion - b.planVersion),
    target = revisions.find((r) => r.revisionId === revisionId);
  if (!target) throw new Error('计划版本不存在');
  const rollback =
    mode === 'undo'
      ? [target]
      : revisions.filter((r) => r.planVersion > target.planVersion).reverse();
  const desired = new Map(data.tasks.map((t) => [t.id, t]));
  const touched = new Set<string>();
  let desiredPref = getPreferences(data),
    prefTouched = false;
  for (const r of rollback) {
    for (const after of r.afterSnapshot) {
      const before = r.beforeSnapshot.find((t) => t.id === after.id);
      const working = desired.get(after.id);
      if (!working) continue;
      touched.add(after.id);
      desired.set(
        after.id,
        before
          ? ({ ...working, ...Object.fromEntries(fields.map((k) => [k, before[k]])) } as StudyTask)
          : { ...working, deletedAt: new Date().toISOString() },
      );
    }
    if (r.beforePreferences) {
      desiredPref = r.beforePreferences;
      prefTouched = true;
    }
  }
  const proposal: PlanProposal = {
    id: entity().id,
    generatedAt: new Date().toISOString(),
    reason:
      mode === 'undo'
        ? `撤销计划 v${target.planVersion}`
        : `恢复到计划 v${target.planVersion} 之后的状态`,
    kind: mode,
    stateToken: stateToken(data),
    changes: [],
    warnings: ['仅恢复计划字段；后续计时、笔记、错题复习和完成状态保留。冲突任务保持当前状态。'],
    unassigned: [],
    requiredMinutes: 0,
    availableMinutes: 0,
    from: today(),
    to: data.examTargets[0].examDate,
    restoresRevisionId: revisionId,
    conflicts: [],
  };
  for (const id of touched) {
    const current = data.tasks.find((t) => t.id === id)!,
      wanted = desired.get(id)!;
    if (samePlan(current, wanted)) continue;
    let reason = '';
    if (current.status === 'completed') reason = '调整后任务已完成，不能覆盖';
    else if (wanted.deletedAt && data.sessions.some((s) => s.taskId === id))
      reason = '新增任务已产生真实学习记录，不能取消';
    else if (wanted.estimatedMinutes < Math.ceil(taskSeconds(id, data.sessions) / 60))
      reason = '旧估时小于已记录学习时长';
    if (mode === 'undo') {
      const expected = target.afterSnapshot.find((t) => t.id === id);
      if (expected && !samePlan(current, expected)) reason = '计划字段在该版本之后又被修改';
    }
    if (reason) proposal.conflicts!.push({ taskId: id, title: current.title, reason });
    else
      proposal.changes.push({
        id,
        before: current,
        after: {
          ...wanted,
          status: current.status,
          notes: current.notes,
          completedAt: current.completedAt,
          updatedAt: proposal.generatedAt,
        },
        reason: '恢复历史计划字段',
        type: wanted.deletedAt ? 'archive' : 'update',
      });
  }
  // An import after cleanup may already contain the same plan under new UUIDs.
  // Undo must show a conflict rather than bringing a second visible copy back.
  for (const change of [...proposal.changes]) {
    const current = data.tasks.find((task) => task.id === change.id);
    if (!current?.deletedAt || change.after.deletedAt) continue;
    const final = new Map(data.tasks.map((task) => [task.id, task]));
    for (const item of proposal.changes) final.set(item.id, item.after);
    if (
      [...final.values()].some(
        (task) =>
          task.id !== change.id &&
          !task.deletedAt &&
          taskFingerprint(task) === taskFingerprint(change.after),
      )
    ) {
      proposal.changes = proposal.changes.filter((item) => item.id !== change.id);
      proposal.conflicts!.push({
        taskId: change.id,
        title: change.after.title,
        reason: '同一任务已重新导入，保留当前任务，避免恢复为重复计划',
      });
    }
  }
  let checking = true;
  while (checking) {
    checking = false;
    const final = new Map(data.tasks.map((t) => [t.id, t]));
    for (const c of proposal.changes) final.set(c.id, c.after);
    for (const t of final.values()) {
      if (t.deletedAt || t.unscheduled || ['completed', 'skipped'].includes(t.status)) continue;
      for (const depId of t.dependencyTaskIds ?? []) {
        const dep = final.get(depId),
          change = proposal.changes.find((c) => c.id === depId);
        if (
          change &&
          (!dep ||
            dep.deletedAt ||
            dep.unscheduled ||
            (dep.status !== 'completed' && dep.date >= t.date))
        ) {
          proposal.changes = proposal.changes.filter((c) => c.id !== depId);
          proposal.conflicts!.push({
            taskId: depId,
            title: change.after.title,
            reason: `会破坏后续任务「${t.title}」的依赖顺序，保留当前计划`,
          });
          checking = true;
          break;
        }
      }
      if (checking) break;
    }
  }
  if (prefTouched) {
    const current = getPreferences(data);
    const expected = mode === 'undo' ? target.afterPreferences : undefined;
    if (expected && JSON.stringify(expected) !== JSON.stringify(current))
      proposal.warnings.push('时间预算已在此版本后修改，本次保留当前预算');
    else {
      proposal.preferencesBefore = current;
      proposal.preferencesAfter = desiredPref;
    }
  }
  return proposal;
}
export function planAtVersion(data: CoreData, revisionId: string) {
  const chosen = data.revisions.find((r) => r.revisionId === revisionId);
  const state = new Map(data.tasks.map((t) => [t.id, t]));
  if (!chosen) return state;
  for (const r of [...data.revisions]
    .filter((r) => r.planVersion > chosen.planVersion)
    .sort((a, b) => b.planVersion - a.planVersion))
    for (const after of r.afterSnapshot) {
      const before = r.beforeSnapshot.find((t) => t.id === after.id);
      if (before) state.set(after.id, before);
      else state.delete(after.id);
    }
  return state;
}
export function compareVersions(data: CoreData, a: string, b: string) {
  const x = planAtVersion(data, a),
    y = planAtVersion(data, b);
  return [...new Set([...x.keys(), ...y.keys()])]
    .map((id) => ({ id, before: x.get(id), after: y.get(id) }))
    .filter((c) => !c.before || !c.after || !samePlan(c.before, c.after));
}
