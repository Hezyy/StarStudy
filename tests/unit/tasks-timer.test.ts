import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { StarDatabase } from '@/db';
import { testDatabase, sampleTask } from './helpers';
import { deleteTask, saveTask, shiftTasks, splitTask } from '@/services/tasks';
import { startTimer, controlTimer } from '@/services/timer';
import { sessionSeconds, budgetFor, defaults } from '@/lib/utils';
import { secondsOnDate, streak } from '@/services/statistics';
describe('任务与学习计时', () => {
  let database: StarDatabase;
  beforeEach(async () => {
    database = await testDatabase();
  });
  afterEach(async () => {
    await database.delete();
  });
  it('首次使用不伪造任务或学习记录，重开数据库保留任务', async () => {
    expect(await database.tasks.count()).toBe(0);
    expect(await database.sessions.count()).toBe(0);
    const t = await sampleTask(database);
    database.close();
    await database.open();
    expect((await database.tasks.get(t.id))?.title).toBe(t.title);
  });
  it('暂停、重复暂停、恢复、停止只累计一次，跨页面不依赖 interval', async () => {
    const t = await sampleTask(database);
    const s = await startTimer(t.id, 1000, database);
    await controlTimer(s.id, 'pause', 11000, database);
    await controlTimer(s.id, 'pause', 13000, database);
    expect(sessionSeconds((await database.sessions.get(s.id))!, 999999)).toBe(10);
    await controlTimer(s.id, 'resume', 21000, database);
    await controlTimer(s.id, 'resume', 23000, database);
    await controlTimer(s.id, 'stop', 31000, database);
    expect(sessionSeconds((await database.sessions.get(s.id))!, 999999)).toBe(20);
  });
  it('并发开始计时只允许一条未结束记录', async () => {
    const a = await sampleTask(database),
      b = await sampleTask(database, { title: '线性代数' });
    const results = await Promise.allSettled([
      startTimer(a.id, 1000, database),
      startTimer(b.id, 1000, database),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await database.sessions.count()).toBe(1);
  });
  it('已有计时的任务不能直接设为完成，停止后才可完成', async () => {
    const t = await sampleTask(database);
    const s = await startTimer(t.id, 1000, database);
    await expect(saveTask({ ...t, status: 'completed' }, t.id, database)).rejects.toThrow('先结束');
    await controlTimer(s.id, 'stop', 2000, database);
    await saveTask({ ...t, status: 'completed' }, t.id, database);
    expect((await database.tasks.get(t.id))?.status).toBe('completed');
  });
  it('完成任务受保护；普通任务删除为软删除，历史计时仍存在', async () => {
    const t = await sampleTask(database);
    await saveTask({ ...t, status: 'completed' }, t.id, database);
    await expect(shiftTasks([t.id], '2027-01-01', database)).rejects.toThrow('已完成');
    await expect(deleteTask(t.id, database)).rejects.toThrow('已完成');
    const second = await sampleTask(database, { title: '未完成任务' });
    const s = await startTimer(second.id, 1000, database);
    await controlTimer(s.id, 'stop', 2000, database);
    await deleteTask(second.id, database);
    expect((await database.tasks.get(second.id))?.deletedAt).toBeTruthy();
    expect(await database.sessions.count()).toBe(1);
  });
  it('调整日期记录前后快照；拆分保持总时长', async () => {
    const t = await sampleTask(database);
    await shiftTasks([t.id], '2027-02-02', database);
    const r = await database.revisions.orderBy('planVersion').last();
    expect(r?.beforeSnapshot[0].date).toBe(t.date);
    expect(r?.afterSnapshot[0].date).toBe('2027-02-02');
    await splitTask(t.id, 10, database);
    const tasks = await database.tasks.toArray();
    expect(tasks).toHaveLength(2);
    expect(tasks.reduce((n, t) => n + t.estimatedMinutes, 0)).toBe(30);
    expect(tasks.reduce((n, t) => n + (t.plannedMinutes ?? t.estimatedMinutes), 0)).toBe(30);
  });
  it('跨午夜计时按实际日期分配，连续打卡来自计时而非完成标记', async () => {
    const t = await sampleTask(database);
    const start = new Date(2026, 10, 1, 23, 59, 0).getTime();
    const s = await startTimer(t.id, start, database);
    await controlTimer(s.id, 'stop', start + 120000, database);
    const sessions = await database.sessions.toArray();
    expect(secondsOnDate(sessions, '2026-11-01')).toBe(60);
    expect(secondsOnDate(sessions, '2026-11-02')).toBe(60);
    expect(streak(sessions, '2026-11-02')).toBe(2);
  });
  it('特殊预算优先，允许考试周降至30分钟', () => {
    expect(
      budgetFor('2026-11-02', {
        ...defaults,
        specialBudgets: [{ start: '2026-11-01', end: '2026-11-07', minutes: 30, label: '考试周' }],
      }),
    ).toBe(30);
    expect(budgetFor('2026-11-08', defaults)).toBe(120);
  });
});
