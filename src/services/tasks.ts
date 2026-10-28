import { db, type StarDatabase } from '@/db';
import { entity, taskSeconds } from '@/lib/utils';
import { taskSchema, type TaskInput } from '@/schemas';
import type { StudyTask } from '@/types';
export async function record(
  database: StarDatabase,
  before: StudyTask[],
  after: StudyTask[],
  reason: string,
) {
  const e = entity();
  const last = await database.revisions.orderBy('planVersion').last();
  await database.revisions.add({
    ...e,
    revisionId: e.id,
    planVersion: (last?.planVersion ?? 0) + 1,
    reason,
    changes: after.map((t) => t.title),
    beforeSnapshot: before,
    afterSnapshot: after,
    approvedAt: e.createdAt,
    kind: 'manual',
  });
}
export async function saveTask(input: TaskInput, id?: string, database = db) {
  const value = taskSchema.parse(input);
  return database.transaction(
    'rw',
    [
      database.tasks,
      database.subjects,
      database.revisions,
      database.sessions,
      database.knowledgePoints,
    ],
    async () => {
      if (!(await database.subjects.get(value.subjectId))) throw new Error('科目不存在');
      for (const kp of value.knowledgePointIds)
        if (!(await database.knowledgePoints.get(kp))) throw new Error('知识点不存在');
      const before = id ? await database.tasks.get(id) : undefined;
      if (id && (!before || before.deletedAt)) throw new Error('任务不存在或已删除');
      if (
        id &&
        (value.status === 'completed' || value.status === 'skipped') &&
        (await database.sessions
          .where('taskId')
          .equals(id)
          .filter((s) => s.state !== 'ended')
          .count())
      )
        throw new Error('请先结束计时，再标记完成或跳过');
      if (
        before?.status === 'completed' &&
        (before.date !== value.date ||
          before.estimatedMinutes !== value.estimatedMinutes ||
          before.subjectId !== value.subjectId)
      )
        throw new Error('已完成任务的计划日期、时长和科目已锁定，历史记录会保留');
      const task: StudyTask = {
        ...(before ?? entity()),
        ...value,
        updatedAt: new Date().toISOString(),
        originDate: before?.originDate ?? value.date,
        completedAt:
          value.status === 'completed'
            ? (before?.completedAt ?? new Date().toISOString())
            : undefined,
      };
      if (
        before &&
        (before.estimatedMinutes !== value.estimatedMinutes || before.date !== value.date)
      ) {
        const sessions = await database.sessions.where('taskId').equals(before.id).toArray();
        const remaining = Math.max(
          0,
          Math.ceil(value.estimatedMinutes - taskSeconds(before.id, sessions) / 60),
        );
        task.plannedMinutes = remaining;
        task.unscheduled = remaining === 0;
      }
      const current = await database.tasks.toArray();
      const graph = new Map(
        [...current.filter((t) => t.id !== task.id), task].map((t) => [t.id, t]),
      );
      const visiting = new Set<string>(),
        done = new Set<string>();
      const visit = (id: string) => {
        if (visiting.has(id)) throw new Error('任务依赖存在循环');
        if (done.has(id)) return;
        const t = graph.get(id);
        if (!t || t.deletedAt) throw new Error('前置任务不存在或已归档');
        visiting.add(id);
        for (const dep of t.dependencyTaskIds ?? []) visit(dep);
        visiting.delete(id);
        done.add(id);
      };
      visit(task.id);
      await database.tasks.put(task);
      await record(
        database,
        before ? [before] : [],
        [task],
        before ? '编辑任务（用户确认）' : '创建任务',
      );
      return task;
    },
  );
}
export async function deleteTask(id: string, database = db) {
  await database.transaction(
    'rw',
    [database.tasks, database.sessions, database.revisions],
    async () => {
      const task = await database.tasks.get(id);
      if (!task) throw new Error('任务不存在');
      if (task.status === 'completed') throw new Error('已完成任务不能删除');
      if (
        await database.sessions
          .where('taskId')
          .equals(id)
          .filter((s) => s.state !== 'ended')
          .count()
      )
        throw new Error('请先结束该任务的计时');
      const after = {
        ...task,
        deletedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await database.tasks.put(after);
      await record(database, [task], [after], '删除任务（保留历史）');
    },
  );
}
export async function shiftTasks(ids: string[], date: string, database = db) {
  const { dateSchema } = await import('@/schemas');
  dateSchema.parse(date);
  await database.transaction(
    'rw',
    [database.tasks, database.sessions, database.revisions],
    async () => {
      const tasks = (await database.tasks.bulkGet(ids)).filter(
        (t): t is StudyTask => !!t && !t.deletedAt,
      );
      if (tasks.length !== ids.length || tasks.some((t) => t.status === 'completed'))
        throw new Error('任务已变化，已完成任务不能调整日期');
      const active = await database.sessions
        .filter((s) => ids.includes(s.taskId) && s.state !== 'ended')
        .count();
      if (active) throw new Error('请先结束受影响任务的计时');
      const sessions = await database.sessions.toArray();
      const after = tasks.map((t) => ({
        ...t,
        date,
        plannedMinutes: Math.max(
          0,
          Math.ceil(t.estimatedMinutes - taskSeconds(t.id, sessions) / 60),
        ),
        unscheduled: false,
        updatedAt: new Date().toISOString(),
      }));
      await database.tasks.bulkPut(after);
      await record(database, tasks, after, '手动调整日期（预览后确认）');
    },
  );
}
export async function splitTask(id: string, firstMinutes: number, database = db) {
  await database.transaction(
    'rw',
    [database.tasks, database.sessions, database.revisions],
    async () => {
      const t = await database.tasks.get(id);
      if (
        !t ||
        t.deletedAt ||
        t.status === 'completed' ||
        firstMinutes < 1 ||
        firstMinutes >= t.estimatedMinutes
      )
        throw new Error('拆分时长须小于原任务时长，且任务未完成');
      if (await database.sessions.where('taskId').equals(id).count())
        throw new Error('已有学习记录的任务请另建剩余任务，避免改变历史');
      const after = [
        {
          ...t,
          estimatedMinutes: firstMinutes,
          plannedMinutes: firstMinutes,
          updatedAt: new Date().toISOString(),
        },
        {
          ...t,
          ...entity(),
          title: `${t.title.slice(0, 280)}（续）`,
          estimatedMinutes: t.estimatedMinutes - firstMinutes,
          plannedMinutes: t.estimatedMinutes - firstMinutes,
          parentTaskId: t.id,
          sourceKey: undefined,
        },
      ];
      await database.tasks.bulkPut(after);
      await record(database, [t], after, '拆分任务（用户确认）');
    },
  );
}
