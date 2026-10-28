import { StarDatabase, initialize } from '@/db';
import { saveTask } from '@/services/tasks';
import { today } from '@/lib/utils';
export async function testDatabase() {
  const database = new StarDatabase(`test-${crypto.randomUUID()}`);
  await initialize(database);
  return database;
}
export async function sampleTask(database: StarDatabase, overrides: Record<string, unknown> = {}) {
  const subject = await database.subjects.where('category').equals('math').first();
  return saveTask(
    {
      date: today(),
      subjectId: subject!.id,
      title: '函数与极限',
      chapter: '第一章',
      courseName: '',
      courseUrl: '',
      exercises: '复习概念',
      estimatedMinutes: 30,
      status: 'todo',
      notes: '',
      knowledgePointIds: [],
      priority: 1,
      ...overrides,
    },
    undefined,
    database,
  );
}
