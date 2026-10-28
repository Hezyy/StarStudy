import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { Database } from './database';
import { validateBackup, type Backup } from '../src/services/backup';
import { TABLE_NAMES } from '../src/types';
import { HttpError } from './security';
export function initialBackup(): Backup {
  const stamp = new Date().toISOString(),
    year = new Date().getFullYear(),
    entity = () => ({ id: randomUUID(), createdAt: stamp, updatedAt: stamp });
  return validateBackup({
    app: '星研',
    formatVersion: 2,
    databaseVersion: 3,
    exportedAt: stamp,
    data: {
      userProfiles: [
        {
          ...entity(),
          name: '研途同行者',
          university: '',
          major: '',
          graduationDate: `${year + 2}-06-30`,
        },
      ],
      examTargets: [
        {
          ...entity(),
          university: '待设置目标院校',
          major: '',
          backupUniversity: '',
          examDate: `${year + 1}-12-25`,
        },
      ],
      subjects: [
        { ...entity(), name: '数学一', category: 'math', priority: 1, active: true },
        { ...entity(), name: '英语一', category: 'english', priority: 2, active: true },
        { ...entity(), name: '408', category: 'cs', priority: 3, active: true },
        { ...entity(), name: '思想政治理论', category: 'politics', priority: 4, active: true },
      ],
      knowledgePoints: [],
      resources: [],
      tasks: [],
      taskResources: [],
      sessions: [],
      mistakes: [],
      mistakeReviews: [],
      weeklyReviews: [],
      revisions: [],
      settings: [
        {
          ...entity(),
          key: 'preferences',
          value: {
            weekdayMinutes: 90,
            weekendMinutes: 120,
            vacationMinutes: 240,
            specialBudgets: [],
            theme: 'system',
          },
        },
      ],
    },
  });
}
export async function readData(
  db: Database,
  owner: string,
  lock = false,
): Promise<{ version: number; backup: Backup }> {
  // Read version and records under the same owner lock; separate READ COMMITTED statements could otherwise disagree.
  if (!lock) return db.transaction((tx) => readData(tx, owner, true));
  const rows = await db.query(
    sql`select version,updated_at from data_versions where owner_id=${owner} ${lock ? sql`for update` : sql``}`,
  );
  if (!rows.length) throw new HttpError(404, '账号数据尚未初始化');
  const records = await db.query(
    sql`select kind,payload from study_records where owner_id=${owner} order by kind,id`,
  );
  const data = Object.fromEntries(
    TABLE_NAMES.map((n) => [n, records.filter((r) => r.kind === n).map((r) => r.payload)]),
  );
  return {
    version: Number(rows[0].version),
    backup: validateBackup({
      app: '星研',
      formatVersion: 2,
      databaseVersion: 3,
      exportedAt: new Date().toISOString(),
      data,
    }),
  };
}
export async function writeData(
  db: Database,
  owner: string,
  input: unknown,
  baseVersion: number,
  protect = true,
) {
  let backup: Backup;
  try {
    backup = validateBackup(input);
  } catch (error) {
    throw new HttpError(
      400,
      error instanceof Error
        ? `备份数据不完整或格式不正确：${error.message.slice(0, 600)}`
        : '备份数据格式不正确',
    );
  }
  const current = await readData(db, owner, true);
  if (current.version !== baseVersion)
    throw new HttpError(409, '其他设备已更新数据。请先解决同步冲突，当前设备的修改仍保留。');
  if (protect) {
    const incomingSessions = new Map(backup.data.sessions.map((s) => [s.id, s]));
    for (const session of current.backup.data.sessions) {
      const incoming = incomingSessions.get(session.id);
      if (!incoming) throw new HttpError(409, '同步不能删除真实学习记录，请使用明确确认的备份恢复');
      if (
        incoming.taskId !== session.taskId ||
        incoming.createdAt !== session.createdAt ||
        incoming.segments.length < session.segments.length ||
        (session.state === 'ended' && incoming.state !== 'ended')
      )
        throw new HttpError(409, '同步不能覆盖已经发生的学习计时记录');
      for (const [index, segment] of session.segments.entries()) {
        const next = incoming.segments[index];
        if (
          next.startedAt !== segment.startedAt ||
          (segment.endedAt !== undefined && next.endedAt !== segment.endedAt)
        )
          throw new HttpError(409, '同步不能修改已经记录的计时片段');
      }
      if (session.state === 'ended' && incoming.segments.length !== session.segments.length)
        throw new HttpError(409, '已经结束的计时不能追加学习片段，请开始新的计时');
    }
    for (const task of current.backup.data.tasks.filter((t) => t.status === 'completed'))
      if (!backup.data.tasks.some((t) => t.id === task.id))
        throw new HttpError(409, '同步不能删除已完成任务');
  }
  await db.query(
    sql`insert into recovery_copies(id,owner_id,payload) values(${randomUUID()},${owner},${JSON.stringify(current.backup)}::jsonb)`,
  );
  await db.query(sql`delete from study_records where owner_id=${owner}`);
  // Bounded batches avoid PG parameter limits for 500-day plans.
  for (const kind of TABLE_NAMES)
    for (let start = 0; start < backup.data[kind].length; start += 100) {
      const values = backup.data[kind]
        .slice(start, start + 100)
        .map((record) => sql`(${owner},${kind},${record.id},${JSON.stringify(record)}::jsonb)`);
      if (values.length)
        await db.query(
          sql`insert into study_records(owner_id,kind,id,payload) values ${sql.join(values, sql`,`)}`,
        );
    }
  await db.query(
    sql`update data_versions set version=version+1,updated_at=now() where owner_id=${owner}`,
  );
  // Retain recent recovery copies; deployment backups retain full history independently.
  await db.query(
    sql`delete from recovery_copies where owner_id=${owner} and id not in (select id from recovery_copies where owner_id=${owner} order by created_at desc limit 10)`,
  );
  return { version: current.version + 1 };
}
export async function seedData(db: Database, owner: string) {
  await db.query(sql`insert into data_versions(owner_id,version) values(${owner},0)`);
  const backup = initialBackup();
  for (const kind of TABLE_NAMES)
    for (const record of backup.data[kind])
      await db.query(
        sql`insert into study_records(owner_id,kind,id,payload) values(${owner},${kind},${record.id},${JSON.stringify(record)}::jsonb)`,
      );
}
