import { it, expect } from 'vitest';
import { testDatabase, sampleTask } from './helpers';
import { changeTaskStatus } from '@/services/task-interactions';
import { startTimer, controlTimer } from '@/services/timer';
it('状态更改和撤销只改变状态，保留笔记、计划与历史计时', async () => {
  const d = await testDatabase();
  try {
    const t = await sampleTask(d, { notes: '真实笔记' });
    const s = await startTimer(t.id, Date.now() - 60000, d);
    await controlTimer(s.id, 'stop', Date.now(), d);
    const done = await changeTaskStatus(t.id, 'completed', undefined, d);
    expect(done.status).toBe('completed');
    const undone = await changeTaskStatus(t.id, 'todo', done, d);
    expect(undone.notes).toBe('真实笔记');
    expect(undone.date).toBe(t.date);
    expect(await d.sessions.count()).toBe(1);
    expect(await d.revisions.count()).toBe(3);
  } finally {
    await d.delete();
  }
});
it('撤销遇到后续编辑拒绝覆盖；正在计时的任务不能被完成', async () => {
  const d = await testDatabase();
  try {
    const t = await sampleTask(d);
    const done = await changeTaskStatus(t.id, 'completed', undefined, d);
    await d.tasks.update(t.id, {
      notes: '后续笔记',
      updatedAt: new Date(Date.now() + 1000).toISOString(),
    });
    await expect(changeTaskStatus(t.id, 'todo', done, d)).rejects.toThrow('后续修改');
    expect((await d.tasks.get(t.id))?.notes).toBe('后续笔记');
    await changeTaskStatus(t.id, 'todo', undefined, d);
    await startTimer(t.id, Date.now(), d);
    await expect(changeTaskStatus(t.id, 'completed', undefined, d)).rejects.toThrow('结束计时');
  } finally {
    await d.delete();
  }
});
