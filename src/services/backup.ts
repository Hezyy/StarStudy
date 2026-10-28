import { z } from 'zod';
import { db } from '@/db';
import { TABLE_NAMES, type CoreData, type TableName, type StudySession } from '@/types';
import { dateSchema, taskSchema } from '@/schemas';
import { entity, safeUrl, defaults } from '@/lib/utils';

const base = z.object({ id: z.uuid(), createdAt: z.iso.datetime(), updatedAt: z.iso.datetime() });
const mastery = z.enum(['unlearned', 'unmastered', 'weak', 'basic', 'proficient']);
const task = base.extend(taskSchema.shape).extend({
  taskType: z.enum(['course', 'exercise', 'review', 'exam', 'reading', 'other']).optional(),
  sourceKey: z.string().optional(),
  rawImport: z.record(z.string(), z.string()).optional(),
  deletedAt: z.iso.datetime().optional(),
  parentTaskId: z.uuid().optional(),
  plannedMinutes: z.number().int().min(0).max(1440).optional(),
  originDate: dateSchema.optional(),
  completedAt: z.iso.datetime().optional(),
  unscheduled: z.boolean().optional(),
  mistakeId: z.uuid().optional(),
  scheduleKey: z.string().optional(),
});
const pref = z.object({
  weekdayMinutes: z.number().int().min(0).max(1440),
  weekendMinutes: z.number().int().min(0).max(1440),
  vacationMinutes: z.number().int().min(0).max(1440),
  theme: z.enum(['light', 'dark', 'system']),
  specialBudgets: z.array(
    z
      .object({
        start: dateSchema,
        end: dateSchema,
        minutes: z.number().int().min(0).max(1440),
        label: z.string(),
      })
      .refine((v) => v.end >= v.start),
  ),
});
const schemas = {
  userProfiles: base.extend({
    name: z.string(),
    university: z.string(),
    major: z.string(),
    graduationDate: dateSchema,
  }),
  examTargets: base.extend({
    university: z.string(),
    major: z.string(),
    backupUniversity: z.string(),
    examDate: dateSchema,
  }),
  subjects: base.extend({
    name: z.string().min(1),
    category: z.enum(['math', 'english', 'cs', 'politics', 'custom']),
    priority: z.number().int().min(1).max(10),
    active: z.boolean(),
  }),
  knowledgePoints: base.extend({
    subjectId: z.uuid(),
    name: z.string(),
    parentId: z.uuid().optional(),
    dependencyIds: z.array(z.uuid()),
    mastery,
    chapter: z.string().optional(),
    history: z
      .array(z.object({ mastery, changedAt: z.iso.datetime(), note: z.string() }))
      .optional(),
    archivedAt: z.iso.datetime().optional(),
  }),
  resources: base.extend({
    platform: z.string().optional(),
    courseName: z.string().optional(),
    section: z.string().optional(),
    subjectId: z.uuid(),
    name: z.string(),
    teacher: z.string(),
    url: z.string().refine(safeUrl),
    chapter: z.string(),
    episodes: z.string(),
    textbook: z.string(),
    exercises: z.string(),
    verification: z.enum(['pending', 'verified']),
    progress: z.number().min(0).max(100).optional(),
    mastery: mastery.optional(),
    knowledgePointIds: z.array(z.uuid()).optional(),
    archivedAt: z.iso.datetime().optional(),
  }),
  tasks: task,
  taskResources: base.extend({
    taskId: z.uuid(),
    resourceId: z.uuid(),
    watchedAt: z.iso.datetime().optional(),
  }),
  sessions: base.extend({
    taskId: z.uuid(),
    state: z.enum(['running', 'paused', 'ended']),
    segments: z
      .array(
        z.object({
          startedAt: z.number().finite().nonnegative(),
          endedAt: z.number().finite().nonnegative().optional(),
        }),
      )
      .min(1),
  }),
  mistakes: base.extend({
    subjectId: z.uuid(),
    knowledgePointIds: z.array(z.uuid()),
    question: z.string(),
    wrongAnswer: z.string(),
    correctAnswer: z.string(),
    reason: z.string(),
    reviewDate: dateSchema,
    mastery,
    chapter: z.string().optional(),
    explanation: z.string().optional(),
    taskIds: z.array(z.uuid()).optional(),
    archivedAt: z.iso.datetime().optional(),
    images: z.array(
      z.object({
        type: z.enum(['image/png', 'image/jpeg', 'image/webp', 'image/gif']),
        data: z
          .string()
          .max(14_000_000)
          .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),
      }),
    ),
  }),
  mistakeReviews: base.extend({
    mistakeId: z.uuid(),
    mastery,
    notes: z.string(),
    reviewedAt: z.iso.datetime(),
  }),
  weeklyReviews: base.extend({
    weekStart: dateSchema,
    difficulty: z.string(),
    unclear: z.string(),
    schoolExams: z.string(),
    nextWeekMinutes: z.array(z.number().min(0).max(1440)).length(7),
    prioritySubjectId: z.uuid(),
    suggestions: z.array(z.string()).optional(),
    summarySnapshot: z.unknown().optional(),
  }),
  revisions: base.extend({
    revisionId: z.uuid(),
    planVersion: z.number().int().positive(),
    reason: z.string(),
    changes: z.array(z.string()),
    beforeSnapshot: z.array(task),
    afterSnapshot: z.array(task),
    approvedAt: z.iso.datetime(),
    revertedAt: z.iso.datetime().optional(),
    kind: z.enum(['manual', 'schedule', 'undo', 'restore', 'external']).optional(),
    restoresRevisionId: z.uuid().optional(),
    beforePreferences: pref.optional(),
    afterPreferences: pref.optional(),
  }),
  settings: base.extend({ key: z.string(), value: z.unknown() }),
};
const dataSchema = z.object(
  Object.fromEntries(TABLE_NAMES.map((name) => [name, z.array(schemas[name])])) as {
    [K in TableName]: z.ZodArray<(typeof schemas)[K]>;
  },
);
export const backupSchema = z.object({
  app: z.literal('星研'),
  formatVersion: z.union([z.literal(1), z.literal(2)]),
  databaseVersion: z.union([z.literal(2), z.literal(3)]),
  exportedAt: z.iso.datetime(),
  data: dataSchema,
});
export type Backup = z.infer<typeof backupSchema>;
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
export function validateBackup(input: unknown): Backup {
  const b = backupSchema.parse(input);
  const d = b.data;
  for (const name of TABLE_NAMES) {
    const ids = d[name].map((v) => v.id);
    assert(new Set(ids).size === ids.length, `${name} 存在重复 ID`);
  }
  assert(
    d.userProfiles.length === 1 && d.examTargets.length === 1,
    '备份必须包含一个用户和一个考试目标',
  );
  assert(new Set(d.settings.map((s) => s.key)).size === d.settings.length, '设置键重复');
  const p = d.settings.find((s) => s.key === 'preferences');
  assert(p, '缺少时间预算设置');
  pref.parse(p.value);
  const reminder = d.settings.find((s) => s.key === 'reminders');
  if (reminder)
    z.object({
      enabled: z.boolean(),
      hour: z.number().int().min(0).max(23),
      minute: z.number().int().min(0).max(59),
      lastNotified: dateSchema.optional(),
    }).parse(reminder.value);
  assert(
    new Set(d.revisions.map((s) => s.revisionId)).size === d.revisions.length,
    '计划版本标识重复',
  );
  assert(
    new Set(d.weeklyReviews.map((s) => s.weekStart)).size === d.weeklyReviews.length,
    '周复盘日期重复',
  );
  const sets = Object.fromEntries(
    TABLE_NAMES.map((n) => [n, new Set(d[n].map((v) => v.id))]),
  ) as Record<TableName, Set<string>>;
  const ref = (table: TableName, id: string) =>
    assert(sets[table].has(id), `关联数据丢失：${table}/${id}`);
  for (const t of d.tasks) {
    ref('subjects', t.subjectId);
    t.knowledgePointIds.forEach((id) => ref('knowledgePoints', id));
    if (t.parentTaskId) ref('tasks', t.parentTaskId);
    (t.dependencyTaskIds ?? []).forEach((id) => ref('tasks', id));
    if (t.mistakeId) ref('mistakes', t.mistakeId);
  }
  for (const k of d.knowledgePoints) {
    ref('subjects', k.subjectId);
    if (k.parentId) ref('knowledgePoints', k.parentId);
    k.dependencyIds.forEach((id) => ref('knowledgePoints', id));
  }
  const visited = new Set<string>(),
    visiting = new Set<string>();
  const visit = (id: string) => {
    if (visiting.has(id)) throw new Error('备份中的知识点依赖存在循环');
    if (visited.has(id)) return;
    visiting.add(id);
    const k = d.knowledgePoints.find((k) => k.id === id)!;
    for (const dep of [...k.dependencyIds, ...(k.parentId ? [k.parentId] : [])]) visit(dep);
    visiting.delete(id);
    visited.add(id);
  };
  for (const k of d.knowledgePoints) visit(k.id);
  for (const r of d.resources) {
    ref('subjects', r.subjectId);
    (r.knowledgePointIds ?? []).forEach((id) => ref('knowledgePoints', id));
  }
  for (const r of d.taskResources) {
    ref('tasks', r.taskId);
    ref('resources', r.resourceId);
  }
  assert(d.sessions.filter((s) => s.state !== 'ended').length <= 1, '存在多个未结束计时');
  for (const s of d.sessions) {
    ref('tasks', s.taskId);
    let previous = 0;
    s.segments.forEach((v, i) => {
      assert(v.startedAt >= previous, '计时片段重叠');
      assert(v.endedAt === undefined || v.endedAt >= v.startedAt, '计时结束早于开始');
      assert(
        v.endedAt !== undefined || (s.state === 'running' && i === s.segments.length - 1),
        '未封闭的计时片段',
      );
      previous = v.endedAt ?? Infinity;
    });
  }
  for (const m of d.mistakes) {
    ref('subjects', m.subjectId);
    m.knowledgePointIds.forEach((id) => ref('knowledgePoints', id));
    (m.taskIds ?? []).forEach((id) => ref('tasks', id));
  }
  for (const r of d.mistakeReviews) ref('mistakes', r.mistakeId);
  for (const r of d.weeklyReviews) ref('subjects', r.prioritySubjectId);
  return b;
}
function freezeSession(s: StudySession, now: number): StudySession {
  return s.state === 'running'
    ? {
        ...s,
        state: 'paused',
        segments: s.segments.map((v) =>
          v.endedAt === undefined ? { ...v, endedAt: Math.max(now, v.startedAt) } : v,
        ),
      }
    : s;
}
async function encodeBlob(blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192)
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return { type: blob.type || 'image/png', data: btoa(binary) };
}
export async function readCoreData(database = db): Promise<CoreData> {
  return database.transaction(
    'r',
    TABLE_NAMES.map((n) => database.table(n)),
    async () => {
      const result: Record<string, unknown> = {};
      for (const n of TABLE_NAMES) result[n] = await database.table(n).toArray();
      return result as unknown as CoreData;
    },
  );
}
export async function encodeData(data: CoreData, freeze = true): Promise<Backup> {
  const now = Date.now();
  const serialized = {
    ...data,
    sessions: freeze ? data.sessions.map((s) => freezeSession(s, now)) : data.sessions,
    mistakes: await Promise.all(
      data.mistakes.map(async (m) => ({
        ...m,
        images: await Promise.all(m.images.map(encodeBlob)),
      })),
    ),
  };
  return validateBackup({
    app: '星研',
    formatVersion: 2,
    databaseVersion: 3,
    exportedAt: new Date(now).toISOString(),
    data: serialized,
  });
}
export async function createBackup(database = db): Promise<Backup> {
  return encodeData(await readCoreData(database));
}
function signature(data: CoreData) {
  return JSON.stringify(data, (_key, value) =>
    value instanceof Blob ? { size: value.size, type: value.type } : value,
  );
}
export async function backupPreview(input: unknown, database = db) {
  const b = validateBackup(input);
  const currentSignature = signature(await readCoreData(database));
  const counts = await Promise.all(
    TABLE_NAMES.map(async (name) => ({
      name,
      incoming: b.data[name].length,
      current: await database.table(name).count(),
      conflicts: (await database.table(name).bulkGet(b.data[name].map((v) => v.id))).filter(Boolean)
        .length,
    })),
  );
  return { backup: b, counts, currentSignature };
}
export async function restoreBackup(
  input: unknown,
  database = db,
  expectedSignature?: string,
  options?: { matchingRemoteSessions?: boolean },
) {
  const b = validateBackup(input);
  const active = await database.sessions.filter((s) => s.state !== 'ended').toArray();
  const remoteContinuesActive =
    options?.matchingRemoteSessions === true &&
    active.every((local) => {
      const remote = b.data.sessions.find((s) => s.id === local.id && s.taskId === local.taskId);
      return (
        !!remote &&
        remote.segments.length >= local.segments.length &&
        local.segments.every((segment, i) => {
          const next = remote.segments[i];
          return (
            segment.startedAt === next.startedAt &&
            (segment.endedAt === undefined || segment.endedAt === next.endedAt)
          );
        })
      );
    });
  if (active.length && !remoteContinuesActive) throw new Error('请先结束当前计时，再恢复数据');
  // Serialize outside IndexedDB transaction: Blob promises must never close the transaction early.
  const original = await readCoreData(database);
  if (expectedSignature && signature(original) !== expectedSignature)
    throw new Error('恢复预览后数据已变化，请重新预览');
  const before = await encodeData(original);
  const decoded = {
    ...b.data,
    mistakes: b.data.mistakes.map((m) => ({
      ...m,
      images: m.images.map(
        (v) => new Blob([Uint8Array.from(atob(v.data), (c) => c.charCodeAt(0))], { type: v.type }),
      ),
    })),
  };
  await database.transaction(
    'rw',
    [...TABLE_NAMES.map((n) => database.table(n)), database.recoverySnapshots],
    async () => {
      if (
        (await database.sessions.filter((s) => s.state !== 'ended').count()) &&
        !remoteContinuesActive
      )
        throw new Error('另一标签页开始了计时，请先结束');
      const current = await readCoreData(database);
      if (signature(current) !== signature(original))
        throw new Error('数据已在其他标签页发生变化，请重新预览再恢复');
      // A successful restore retains the exact pre-restore snapshot in a separate store; failed writes roll back everything.
      await database.recoverySnapshots.add({ ...entity(), json: JSON.stringify(before) });
      for (const n of TABLE_NAMES) {
        await database.table(n).clear();
        await database.table(n).bulkAdd(decoded[n]);
      }
      for (const n of TABLE_NAMES)
        assert((await database.table(n).count()) === decoded[n].length, `恢复完整性检查失败：${n}`);
    },
  );
}
export function preferencesValue(value: unknown) {
  return pref.parse(value ?? defaults);
}
