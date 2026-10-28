import { describe, expect, it } from 'vitest';
import Dexie from 'dexie';
import { StarDatabase } from '@/db';
import { TABLE_NAMES } from '@/types';
import { saveSettings } from '@/services/settings';
import { testDatabase, sampleTask } from './helpers';
import { defaults } from '@/lib/utils';
describe('设置与数据库升级', () => {
  it('更换科目、考试日期和时间预算保留原任务与完成记录，可重新启用旧科目', async () => {
    const database = await testDatabase();
    try {
      const task = await sampleTask(database, { status: 'completed' });
      const subjects = await database.subjects.toArray();
      const names = Object.fromEntries(subjects.map((s) => [s.category, s.name]));
      const priorities = Object.fromEntries(subjects.map((s) => [s.category, s.priority]));
      const input = {
        target: { ...(await database.examTargets.toCollection().first())!, examDate: '2027-12-20' },
        profile: (await database.userProfiles.toCollection().first())!,
        preferences: { ...defaults, weekdayMinutes: 60 },
        names: { ...names, math: '数学二' },
        priorities,
      };
      await saveSettings(input, database);
      expect((await database.tasks.get(task.id))?.status).toBe('completed');
      expect((await database.subjects.get(task.subjectId))?.active).toBe(false);
      expect((await database.examTargets.toCollection().first())?.examDate).toBe('2027-12-20');
      await saveSettings({ ...input, names }, database);
      expect((await database.subjects.get(task.subjectId))?.active).toBe(true);
      expect(await database.subjects.count()).toBe(5);
    } finally {
      await database.delete();
    }
  });
  it('无效预算与科目优先级不会写入任何设置', async () => {
    const database = await testDatabase();
    try {
      const subjects = await database.subjects.toArray();
      const input = {
        target: (await database.examTargets.toCollection().first())!,
        profile: (await database.userProfiles.toCollection().first())!,
        preferences: { ...defaults, weekdayMinutes: -5 },
        names: Object.fromEntries(subjects.map((s) => [s.category, s.name])),
        priorities: Object.fromEntries(subjects.map((s) => [s.category, s.priority])),
      };
      await expect(saveSettings(input, database)).rejects.toThrow();
      expect((await database.settings.where('key').equals('preferences').first())?.value).toEqual(
        defaults,
      );
    } finally {
      await database.delete();
    }
  });
  it('v1 升级到 v3 保留历史数据并补齐关联数组', async () => {
    const source = await testDatabase(),
      name = `migration-${crypto.randomUUID()}`;
    const legacy = new Dexie(name);
    legacy.version(1).stores({
      userProfiles: 'id',
      examTargets: 'id, examDate',
      subjects: 'id, category',
      knowledgePoints: 'id, subjectId, parentId, mastery',
      resources: 'id, subjectId',
      tasks: 'id, date, subjectId, status, sourceKey, [date+subjectId], *knowledgePointIds',
      taskResources: 'id, taskId, resourceId',
      sessions: 'id, taskId, state',
      mistakes: 'id, subjectId, reviewDate, mastery',
      mistakeReviews: 'id, mistakeId',
      weeklyReviews: 'id, &weekStart',
      revisions: 'id, &revisionId, planVersion, createdAt',
      settings: 'id, &key',
    });
    const next = new StarDatabase(name);
    try {
      const task = await sampleTask(source);
      for (const n of TABLE_NAMES) await legacy.table(n).bulkAdd(await source.table(n).toArray());
      await legacy.table('tasks').update(task.id, { knowledgePointIds: undefined });
      legacy.close();
      await next.open();
      expect(next.verno).toBe(3);
      expect((await next.tasks.get(task.id))?.knowledgePointIds).toEqual([]);
      expect(await next.tasks.count()).toBe(1);
      expect(await next.recoverySnapshots.count()).toBe(0);
    } finally {
      legacy.close();
      await next.delete();
      await source.delete();
    }
  });
});
