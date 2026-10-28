import { it, expect } from 'vitest';
import Dexie from 'dexie';
import { StarDatabase } from '@/db';
import { TABLE_NAMES } from '@/types';
import { testDatabase, sampleTask } from './helpers';
import { entity } from '@/lib/utils';
it('v2到v3升级后错题Blob字节与关联记录保留', async () => {
  const source = await testDatabase(),
    name = `image-migration-${crypto.randomUUID()}`,
    legacy = new Dexie(name);
  legacy.version(2).stores({
    userProfiles: 'id',
    examTargets: 'id, examDate',
    subjects: 'id, category',
    knowledgePoints: 'id, subjectId, parentId, mastery',
    resources: 'id, subjectId',
    tasks:
      'id, date, subjectId, status, sourceKey, [date+subjectId], *knowledgePointIds, deletedAt',
    taskResources: 'id, taskId, resourceId',
    sessions: 'id, taskId, state',
    mistakes: 'id, subjectId, reviewDate, mastery',
    mistakeReviews: 'id, mistakeId',
    weeklyReviews: 'id, &weekStart',
    revisions: 'id, &revisionId, planVersion, createdAt',
    settings: 'id, &key',
    recoverySnapshots: 'id, createdAt',
  });
  const next = new StarDatabase(name);
  try {
    const t = await sampleTask(source),
      id = entity().id;
    await source.mistakes.add({
      ...entity(),
      id,
      subjectId: t.subjectId,
      question: '升级保留图片',
      wrongAnswer: '',
      correctAnswer: '',
      reason: '',
      reviewDate: '2026-11-01',
      mastery: 'weak',
      knowledgePointIds: [],
      images: [new Blob(['persistent-image-bytes'], { type: 'image/png' })],
    });
    for (const table of TABLE_NAMES)
      await legacy.table(table).bulkAdd(await source.table(table).toArray());
    legacy.close();
    await next.open();
    const m = await next.mistakes.get(id);
    expect(next.verno).toBe(3);
    expect(await m!.images[0].text()).toBe('persistent-image-bytes');
    expect(m!.chapter).toBe('');
    expect(await next.tasks.count()).toBe(1);
  } finally {
    legacy.close();
    await next.delete();
    await source.delete();
  }
});
