import { db } from '@/db';
import { saveTask } from './tasks';
import type { StudyTask } from '@/types';
export async function changeTaskStatus(
  id: string,
  status: StudyTask['status'],
  expected?: Pick<StudyTask, 'status' | 'updatedAt'>,
  database = db,
) {
  return database.transaction(
    'rw',
    [
      database.tasks,
      database.sessions,
      database.subjects,
      database.revisions,
      database.knowledgePoints,
    ],
    async () => {
      const current = await database.tasks.get(id);
      if (!current || current.deletedAt) throw new Error('任务已不存在，请重新查看');
      if (
        expected &&
        (current.updatedAt !== expected.updatedAt || current.status !== expected.status)
      )
        throw new Error('任务已有后续修改，请检查后再手动调整状态');
      return saveTask({ ...current, status }, id, database);
    },
  );
}
