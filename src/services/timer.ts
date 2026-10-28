import { db } from '@/db';
import { entity } from '@/lib/utils';
export async function startTimer(taskId: string, now = Date.now(), database = db) {
  return database.transaction('rw', [database.tasks, database.sessions], async () => {
    if (await database.sessions.filter((s) => s.state !== 'ended').count())
      throw new Error('已有计时任务，请先暂停或结束当前计时');
    const task = await database.tasks.get(taskId);
    if (!task || task.deletedAt) throw new Error('任务不存在');
    if (task.status === 'completed') throw new Error('已完成任务请先设为部分完成再计时');
    const s = { ...entity(), taskId, state: 'running' as const, segments: [{ startedAt: now }] };
    await database.sessions.add(s);
    await database.tasks.update(taskId, {
      status: 'in_progress',
      updatedAt: new Date().toISOString(),
    });
    return s;
  });
}
export async function controlTimer(
  id: string,
  action: 'pause' | 'resume' | 'stop',
  now = Date.now(),
  database = db,
) {
  await database.transaction('rw', database.sessions, async () => {
    const s = await database.sessions.get(id);
    if (!s || s.state === 'ended') throw new Error('计时已结束');
    const segments = s.segments.map((v) => ({ ...v }));
    if (action === 'pause' && s.state === 'running') {
      const last = segments.at(-1)!;
      last.endedAt = Math.max(last.startedAt, now);
    } else if (action === 'resume' && s.state === 'paused') segments.push({ startedAt: now });
    else if (action === 'stop') {
      if (s.state === 'running') {
        const last = segments.at(-1)!;
        last.endedAt = Math.max(last.startedAt, now);
      }
    } else return;
    await database.sessions.update(id, {
      segments,
      state: action === 'stop' ? 'ended' : action === 'pause' ? 'paused' : 'running',
      updatedAt: new Date().toISOString(),
    });
  });
}
