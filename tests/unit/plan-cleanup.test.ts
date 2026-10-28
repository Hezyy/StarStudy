import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { StarDatabase } from '@/db';
import { entity } from '@/lib/utils';
import { buildPlanCleanup, createPlanCleanup } from '@/services/plan-cleanup';
import { applyProposal, versionProposal } from '@/services/plans';
import { readCoreData } from '@/services/backup';
import { saveTask } from '@/services/tasks';
import { sampleTask, testDatabase } from './helpers';

describe('计划批量清理', () => {
  let database: StarDatabase;
  beforeEach(async () => {
    database = await testDatabase();
  });
  afterEach(async () => {
    await database.delete();
  });

  it('预览和取消不写库，未确认不能清理', async () => {
    const task = await sampleTask(database);
    const before = await readCoreData(database);
    const preview = buildPlanCleanup(before, {});
    expect(preview.proposal.changes.map((change) => change.id)).toEqual([task.id]);
    expect(await readCoreData(database)).toEqual(before);
    await expect(applyProposal(preview.proposal, false, database)).rejects.toThrow('确认');
    expect((await database.tasks.get(task.id))?.deletedAt).toBeUndefined();
  });

  it('按日期与科目清理，保留原任务/笔记/资料，并可撤销', async () => {
    const task = await sampleTask(database, { date: '2027-01-01', notes: '原有笔记保留' });
    const later = await sampleTask(database, { date: '2027-01-02' });
    const english = await database.subjects.where('category').equals('english').first();
    const other = await sampleTask(database, { date: '2027-01-01', subjectId: english!.id });
    const preview = await createPlanCleanup(
      { from: '2027-01-01', to: '2027-01-01', subjectId: task.subjectId },
      database,
    );
    const revision = await applyProposal(preview.proposal, true, database);
    expect(revision.kind).toBe('manual');
    expect(revision.beforeSnapshot).toHaveLength(1);
    expect((await database.tasks.get(task.id))?.deletedAt).toBeTruthy();
    expect((await database.tasks.get(task.id))?.notes).toBe('原有笔记保留');
    expect((await database.tasks.get(later.id))?.deletedAt).toBeUndefined();
    expect((await database.tasks.get(other.id))?.deletedAt).toBeUndefined();
    const undo = await versionProposal(revision.revisionId, 'undo', database);
    expect(undo.conflicts).toEqual([]);
    await applyProposal(undo, true, database);
    expect((await database.tasks.get(task.id))?.deletedAt).toBeUndefined();
    expect((await database.tasks.get(task.id))?.notes).toBe('原有笔记保留');
  });

  it('完成、进度、跳过、计时和观看记录受保护，不改变真实记录', async () => {
    const pending = await sampleTask(database, { title: '待清理' });
    await sampleTask(database, { title: '完成', status: 'completed' });
    await sampleTask(database, { title: '部分', status: 'partial' });
    await sampleTask(database, { title: '进行中', status: 'in_progress' });
    await sampleTask(database, { title: '跳过', status: 'skipped' });
    const timed = await sampleTask(database, { title: '有计时' });
    await database.sessions.add({
      ...entity(),
      taskId: timed.id,
      state: 'ended',
      segments: [{ startedAt: 1000, endedAt: 61000 }],
    });
    const watched = await sampleTask(database, { title: '看过课程' });
    const resource = {
      ...entity(),
      subjectId: watched.subjectId,
      name: '自填课程',
      teacher: '',
      url: '',
      chapter: '',
      episodes: '',
      textbook: '',
      exercises: '',
      verification: 'pending' as const,
    };
    await database.resources.add(resource);
    await database.taskResources.add({
      ...entity(),
      taskId: watched.id,
      resourceId: resource.id,
      watchedAt: new Date().toISOString(),
    });
    const before = await readCoreData(database);
    const preview = buildPlanCleanup(before, {});
    expect(preview.matchedCount).toBe(7);
    expect(preview.protectedTasks).toHaveLength(6);
    expect(preview.proposal.changes.map((change) => change.id)).toEqual([pending.id]);
    await applyProposal(preview.proposal, true, database);
    const after = await readCoreData(database);
    expect(after.sessions).toEqual(before.sessions);
    expect(after.taskResources).toEqual(before.taskResources);
    expect(after.resources).toEqual(before.resources);
    expect(after.tasks.filter((task) => task.deletedAt)).toHaveLength(1);
  });

  it('保留范围外任务依赖的前置任务，递归保护整个依赖链', async () => {
    const first = await sampleTask(database, { date: '2027-01-01', title: '前置一' });
    const second = await sampleTask(database, {
      date: '2027-01-02',
      title: '前置二',
      dependencyTaskIds: [first.id],
    });
    await sampleTask(database, {
      date: '2027-01-03',
      title: '范围外后续',
      dependencyTaskIds: [second.id],
    });
    const preview = await createPlanCleanup({ to: '2027-01-02' }, database);
    expect(preview.proposal.changes).toHaveLength(0);
    expect(preview.protectedTasks.map((item) => item.task.id).sort()).toEqual(
      [first.id, second.id].sort(),
    );
    const all = await createPlanCleanup({}, database);
    expect(all.proposal.changes).toHaveLength(3);
    await applyProposal(all.proposal, true, database);
    expect((await database.tasks.toArray()).every((task) => task.deletedAt)).toBe(true);
  });

  it('预览之后发生的编辑或完成会阻止旧确认', async () => {
    const task = await sampleTask(database);
    const preview = await createPlanCleanup({}, database);
    await saveTask({ ...task, status: 'completed' }, task.id, database);
    await expect(applyProposal(preview.proposal, true, database)).rejects.toThrow('数据已发生变化');
    expect((await database.tasks.get(task.id))?.status).toBe('completed');
    expect((await database.tasks.get(task.id))?.deletedAt).toBeUndefined();
  });

  it('清空后已有另一ID的相同任务，撤销预览阻止生成重复计划', async () => {
    const task = await sampleTask(database);
    const preview = await createPlanCleanup({}, database);
    const revision = await applyProposal(preview.proposal, true, database);
    await sampleTask(database);
    const undo = await versionProposal(revision.revisionId, 'undo', database);
    expect(undo.changes).toHaveLength(0);
    expect(undo.conflicts).toHaveLength(1);
    expect(undo.conflicts![0].reason).toContain('重复');
    expect((await database.tasks.get(task.id))?.deletedAt).toBeTruthy();
  });

  it('校验日期范围，且写入版本失败会整批回滚', async () => {
    const task = await sampleTask(database);
    const data = await readCoreData(database);
    expect(() => buildPlanCleanup(data, { from: '2027-02-30' })).toThrow('有效');
    expect(() => buildPlanCleanup(data, { from: '' })).toThrow('有效');
    expect(() => buildPlanCleanup(data, { subjectId: '' })).toThrow('科目');
    expect(() => buildPlanCleanup(data, { from: '2027-02-01', to: '2027-01-01' })).toThrow('早于');
    const preview = buildPlanCleanup(data, {});
    const fail = () => {
      throw new Error('模拟版本保存失败');
    };
    database.revisions.hook('creating', fail);
    await expect(applyProposal(preview.proposal, true, database)).rejects.toThrow(
      '模拟版本保存失败',
    );
    database.revisions.hook('creating').unsubscribe(fail);
    expect((await database.tasks.get(task.id))?.deletedAt).toBeUndefined();
  });
});
