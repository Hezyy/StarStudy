import type { StudySession, StudyTask, TaskResource } from '@/types';

/** Shared by plan cleanup and re-import: a learning record is never an empty plan placeholder. */
export function taskProtectionReason(
  task: StudyTask,
  sessions: readonly Pick<StudySession, 'taskId'>[] = [],
  resources: readonly Pick<TaskResource, 'taskId' | 'watchedAt'>[] = [],
): string | undefined {
  if (task.status === 'completed' || task.completedAt) return '已完成或有完成记录';
  if (task.status !== 'todo') return '已有学习进度或跳过状态';
  if (sessions.some((session) => session.taskId === task.id)) return '已有学习计时记录';
  if (resources.some((resource) => resource.taskId === task.id && resource.watchedAt))
    return '已有课程观看记录';
  return undefined;
}
