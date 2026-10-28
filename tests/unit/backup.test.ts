import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StarDatabase } from '@/db';
import { testDatabase, sampleTask } from './helpers';
import { createBackup, validateBackup, backupPreview, restoreBackup } from '@/services/backup';
import { entity } from '@/lib/utils';
import { startTimer } from '@/services/timer';
describe('完整 JSON 备份恢复', () => {
  let database: StarDatabase;
  beforeEach(async () => {
    database = await testDatabase();
  });
  afterEach(async () => {
    await database.delete();
  });
  it('所有核心表、错题图片及关联可往返恢复，并保留恢复前快照', async () => {
    const t = await sampleTask(database);
    await database.mistakes.add({
      ...entity(),
      subjectId: t.subjectId,
      knowledgePointIds: [],
      question: '题目',
      wrongAnswer: 'A',
      correctAnswer: 'B',
      reason: '概念混淆',
      reviewDate: '2026-11-01',
      mastery: 'weak',
      images: [new Blob(['real-image-bytes'], { type: 'image/png' })],
    });
    const b = await createBackup(database);
    expect(b.data.mistakes[0].images[0].data).toBeTruthy();
    await sampleTask(database, { title: '恢复前新任务' });
    const preview = await backupPreview(b, database);
    expect(preview.counts.find((c) => c.name === 'tasks')?.conflicts).toBe(1);
    await restoreBackup(JSON.parse(JSON.stringify(b)), database);
    expect(await database.tasks.count()).toBe(1);
    expect(await database.recoverySnapshots.count()).toBe(1);
    const image = (await database.mistakes.toCollection().first())!.images[0];
    expect(image).toBeInstanceOf(Blob);
    expect(await image.text()).toBe('real-image-bytes');
    const previous = JSON.parse((await database.recoverySnapshots.toCollection().first())!.json);
    expect(previous.data.tasks).toHaveLength(2);
  });
  it('错误格式、未知版本、无效日期、重复ID和悬空关联均拒绝', async () => {
    const t = await sampleTask(database);
    const b = await createBackup(database);
    expect(() => validateBackup({ ...b, formatVersion: 99 })).toThrow();
    expect(() =>
      validateBackup({ ...b, data: { ...b.data, tasks: [...b.data.tasks, b.data.tasks[0]] } }),
    ).toThrow('重复');
    expect(() =>
      validateBackup({
        ...b,
        data: { ...b.data, tasks: [{ ...t, subjectId: crypto.randomUUID() }] },
      }),
    ).toThrow('关联');
    expect(() =>
      validateBackup({ ...b, data: { ...b.data, tasks: [{ ...t, date: '2026-02-30' }] } }),
    ).toThrow();
    await expect(restoreBackup({ app: 'bad' }, database)).rejects.toThrow();
    expect(await database.tasks.count()).toBe(1);
  });
  it('备份冻结运行计时，恢复拒绝覆盖未结束计时', async () => {
    const t = await sampleTask(database);
    await startTimer(t.id, Date.now() - 5000, database);
    const b = await createBackup(database);
    expect(b.data.sessions[0].state).toBe('paused');
    expect(b.data.sessions[0].segments[0].endedAt).toBeTypeOf('number');
    await expect(restoreBackup(b, database)).rejects.toThrow('先结束');
    expect(await database.sessions.count()).toBe(1);
  });
  it('恢复写入失败时旧数据完整回滚', async () => {
    const t = await sampleTask(database);
    const b = await createBackup(database);
    await sampleTask(database, { title: '应保留的新任务' });
    const fail = () => {
      throw new Error('模拟存储空间不足');
    };
    database.tasks.hook('creating', fail);
    await expect(restoreBackup(b, database)).rejects.toThrow('模拟');
    database.tasks.hook('creating').unsubscribe(fail);
    expect(await database.tasks.count()).toBe(2);
    expect((await database.tasks.get(t.id))?.title).toBe(t.title);
    expect(await database.recoverySnapshots.count()).toBe(0);
  });
  it('编码图片期间有新数据写入时，恢复停止而不覆盖新记录', async () => {
    const t = await sampleTask(database);
    await database.mistakes.add({
      ...entity(),
      subjectId: t.subjectId,
      knowledgePointIds: [],
      question: 'q',
      wrongAnswer: '',
      correctAnswer: '',
      reason: '',
      reviewDate: '2026-11-01',
      mastery: 'weak',
      images: [new Blob(['image'], { type: 'image/png' })],
    });
    const backup = await createBackup(database);
    const original = Blob.prototype.arrayBuffer;
    const spy = vi.spyOn(Blob.prototype, 'arrayBuffer').mockImplementationOnce(async function (
      this: Blob,
    ) {
      await sampleTask(database, { title: '其他标签页的新任务' });
      return original.call(this);
    });
    try {
      await expect(restoreBackup(backup, database)).rejects.toThrow('其他标签页');
    } finally {
      spy.mockRestore();
    }
    expect(await database.tasks.count()).toBe(2);
    expect(await database.recoverySnapshots.count()).toBe(0);
  });
  it('科目切换后旧任务、计时和备份关联仍完整', async () => {
    const t = await sampleTask(database);
    await database.subjects.update(t.subjectId, { active: false });
    await database.subjects.add({
      ...entity(),
      name: '数学二',
      category: 'math',
      priority: 1,
      active: true,
    });
    const b = await createBackup(database);
    expect(b.data.tasks[0].subjectId).toBe(t.subjectId);
    expect(b.data.subjects.find((s) => s.id === t.subjectId)?.active).toBe(false);
    await restoreBackup(b, database);
    expect(await database.tasks.count()).toBe(1);
  });
});
