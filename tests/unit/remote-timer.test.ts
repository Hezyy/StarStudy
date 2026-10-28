import { it, expect } from 'vitest';
import { testDatabase, sampleTask } from './helpers';
import { entity } from '@/lib/utils';
import { createBackup, restoreBackup, backupPreview } from '@/services/backup';
it('仅未改动的远端计时可收敛，普通恢复和已封闭片段仍受保护', async () => {
  const db = await testDatabase();
  try {
    const task = await sampleTask(db),
      session = {
        ...entity(),
        taskId: task.id,
        state: 'running' as const,
        segments: [{ startedAt: 1000 }],
      };
    await db.sessions.add(session);
    const remote = await createBackup(db);
    remote.data.sessions[0].state = 'ended';
    remote.data.sessions[0].segments[0].endedAt = 4000;
    await expect(restoreBackup(remote, db)).rejects.toThrow('结束');
    const guard = await backupPreview(remote, db);
    await restoreBackup(remote, db, guard.currentSignature, { matchingRemoteSessions: true });
    expect((await db.sessions.get(session.id))?.state).toBe('ended');
    await db.sessions.update(session.id, { state: 'paused' });
    const wrong = structuredClone(remote);
    wrong.data.sessions[0].segments[0].startedAt = 2000;
    await expect(
      restoreBackup(wrong, db, undefined, { matchingRemoteSessions: true }),
    ).rejects.toThrow('结束');
  } finally {
    await db.delete();
  }
});
