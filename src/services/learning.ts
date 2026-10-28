import { z } from 'zod';
import { addDays, format, parseISO } from 'date-fns';
import { db } from '@/db';
import { dateSchema, masterySchema } from '@/schemas';
import { entity, safeUrl, today } from '@/lib/utils';
import { reviewInterval } from '@/lib/mastery';
import type { Mastery, Mistake, KnowledgePoint, Resource } from '@/types';
import { record } from './tasks';
import { videoLink } from '@/lib/video-link';
const knowledgeSchema = z.object({
  subjectId: z.uuid(),
  name: z.string().trim().min(1).max(200),
  chapter: z.string().max(300).default(''),
  mastery: masterySchema,
  dependencyIds: z.array(z.uuid()),
  parentId: z.uuid().optional(),
});
export function assertAcyclic(points: Pick<KnowledgePoint, 'id' | 'dependencyIds' | 'parentId'>[]) {
  const map = new Map(points.map((p) => [p.id, p])),
    done = new Set<string>(),
    visiting = new Set<string>();
  const visit = (id: string) => {
    if (visiting.has(id)) throw new Error('知识点依赖存在循环');
    if (done.has(id)) return;
    const p = map.get(id);
    if (!p) throw new Error('依赖知识点不存在');
    visiting.add(id);
    for (const d of [...p.dependencyIds, ...(p.parentId ? [p.parentId] : [])]) visit(d);
    visiting.delete(id);
    done.add(id);
  };
  for (const p of points) visit(p.id);
}
export async function saveKnowledge(
  input: z.input<typeof knowledgeSchema>,
  id?: string,
  database = db,
) {
  const v = knowledgeSchema.parse(input);
  return database.transaction('rw', [database.knowledgePoints, database.subjects], async () => {
    if (!(await database.subjects.get(v.subjectId))) throw new Error('科目不存在');
    const before = id ? await database.knowledgePoints.get(id) : undefined;
    if (id && !before) throw new Error('知识点不存在');
    const p: KnowledgePoint = {
      ...(before ?? entity()),
      ...v,
      updatedAt: new Date().toISOString(),
      history: [
        ...(before?.history ?? []),
        ...(!before || before.mastery !== v.mastery
          ? [{ mastery: v.mastery, changedAt: new Date().toISOString(), note: '用户手动评估' }]
          : []),
      ],
    };
    const all = (await database.knowledgePoints.toArray()).filter((k) => k.id !== p.id);
    assertAcyclic([...all, p]);
    for (const dep of v.dependencyIds)
      if (all.find((k) => k.id === dep)?.subjectId !== v.subjectId)
        throw new Error('知识点依赖须属于同一科目');
    await database.knowledgePoints.put(p);
    return p;
  });
}
export async function archiveKnowledge(id: string, archived: boolean, database = db) {
  await database.knowledgePoints.update(id, {
    archivedAt: archived ? new Date().toISOString() : undefined,
    updatedAt: new Date().toISOString(),
  });
}
const mistakeSchema = z.object({
  subjectId: z.uuid(),
  question: z.string().trim().min(1).max(30000),
  wrongAnswer: z.string().max(30000),
  correctAnswer: z.string().max(30000),
  reason: z.string().max(30000),
  explanation: z.string().max(30000).default(''),
  chapter: z.string().max(500).default(''),
  knowledgePointIds: z.array(z.uuid()),
  taskIds: z.array(z.uuid()).default([]),
  reviewDate: dateSchema,
  mastery: masterySchema,
});
export async function saveMistake(
  input: z.input<typeof mistakeSchema> & { images: Blob[] },
  id?: string,
  database = db,
) {
  const v = mistakeSchema.parse(input);
  if (
    input.images.length > 10 ||
    input.images.some(
      (b) =>
        !(b instanceof Blob) ||
        !/^image\/(png|jpeg|webp|gif)$/.test(b.type) ||
        b.size > 10 * 1024 * 1024,
    )
  )
    throw new Error('最多10张图片，每张不超过10MB，支持PNG/JPEG/WebP/GIF');
  const images = await Promise.all(
    input.images.map(async (b) =>
      typeof File !== 'undefined' && b instanceof File
        ? new Blob([await b.arrayBuffer()], { type: b.type })
        : b,
    ),
  );
  return database.transaction(
    'rw',
    [database.mistakes, database.subjects, database.knowledgePoints, database.tasks],
    async () => {
      if (!(await database.subjects.get(v.subjectId))) throw new Error('科目不存在');
      for (const k of v.knowledgePointIds)
        if ((await database.knowledgePoints.get(k))?.subjectId !== v.subjectId)
          throw new Error('关联知识点科目不匹配');
      for (const t of v.taskIds)
        if ((await database.tasks.get(t))?.subjectId !== v.subjectId)
          throw new Error('关联任务科目不匹配');
      const before = id ? await database.mistakes.get(id) : undefined;
      if (id && !before) throw new Error('错题不存在');
      const m: Mistake = {
        ...(before ?? entity()),
        ...v,
        images,
        updatedAt: new Date().toISOString(),
      };
      await database.mistakes.put(m);
      return m;
    },
  );
}
export async function archiveMistake(id: string, archived: boolean, database = db) {
  await database.mistakes.update(id, {
    archivedAt: archived ? new Date().toISOString() : undefined,
    updatedAt: new Date().toISOString(),
  });
}
export async function reviewMistake(
  id: string,
  mastery: Mastery,
  notes: string,
  nextDate?: string,
  updateKnowledge = false,
  database = db,
) {
  masterySchema.parse(mastery);
  if (nextDate) dateSchema.parse(nextDate);
  return database.transaction(
    'rw',
    [database.mistakes, database.mistakeReviews, database.knowledgePoints],
    async () => {
      const m = await database.mistakes.get(id);
      if (!m || m.archivedAt) throw new Error('错题不存在或已归档');
      const stamp = new Date().toISOString();
      await database.mistakeReviews.add({
        ...entity(),
        mistakeId: id,
        mastery,
        notes,
        reviewedAt: stamp,
      });
      await database.mistakes.update(id, {
        mastery,
        reviewDate:
          nextDate ?? format(addDays(parseISO(today()), reviewInterval(mastery)), 'yyyy-MM-dd'),
        updatedAt: stamp,
      });
      if (updateKnowledge)
        for (const key of m.knowledgePointIds) {
          const k = await database.knowledgePoints.get(key);
          if (k)
            await database.knowledgePoints.update(key, {
              mastery,
              history: [
                ...(k.history ?? []),
                { mastery, changedAt: stamp, note: '用户确认错题复习评估' },
              ],
              updatedAt: stamp,
            });
        }
    },
  );
}
export async function mistakeToTask(id: string, date: string, minutes: number, database = db) {
  dateSchema.parse(date);
  z.number().int().min(1).max(1440).parse(minutes);
  return database.transaction(
    'rw',
    [database.mistakes, database.tasks, database.revisions],
    async () => {
      const m = await database.mistakes.get(id);
      if (!m || m.archivedAt) throw new Error('错题不存在或已归档');
      const key = `mistake:${id}:${date}`;
      if (
        await database.tasks
          .where('scheduleKey')
          .equals(key)
          .filter((t) => !t.deletedAt)
          .count()
      )
        throw new Error('该日已有这道错题的复习任务');
      const t = {
        ...entity(),
        title: `错题复习：${m.question.slice(0, 70)}`,
        subjectId: m.subjectId,
        date,
        originDate: date,
        chapter: m.chapter ?? '',
        courseName: '',
        courseUrl: '',
        exercises: '重做错题并说明错误原因',
        estimatedMinutes: minutes,
        status: 'todo' as const,
        notes: '',
        knowledgePointIds: m.knowledgePointIds,
        priority: 1,
        mistakeId: id,
        scheduleKey: key,
      };
      await database.tasks.add(t);
      await record(database, [], [t], '从错题创建复习任务');
      return t;
    },
  );
}
const resourceSchema = z.object({
  platform: z.string().max(100).optional(),
  courseName: z.string().max(300).optional(),
  section: z.string().max(300).optional(),
  subjectId: z.uuid(),
  name: z.string().trim().min(1).max(200),
  teacher: z.string(),
  url: z.string().refine(safeUrl).refine(v=>videoLink(v).kind!=='invalid','链接格式或视频选集参数无效'),
  chapter: z.string(),
  episodes: z.string(),
  textbook: z.string(),
  exercises: z.string(),
  verification: z.enum(['pending', 'verified']),
  progress: z.number().min(0).max(100),
  mastery: masterySchema,
  knowledgePointIds: z.array(z.uuid()),
});
export async function saveResource(
  input: z.input<typeof resourceSchema>,
  id?: string,
  database = db,
) {
  const v = resourceSchema.parse(input);
  return database.transaction(
    'rw',
    [database.resources, database.subjects, database.knowledgePoints],
    async () => {
      if (!(await database.subjects.get(v.subjectId))) throw new Error('科目不存在');
      for (const k of v.knowledgePointIds)
        if ((await database.knowledgePoints.get(k))?.subjectId !== v.subjectId)
          throw new Error('知识点科目不匹配');
      const old = id ? await database.resources.get(id) : undefined;
      if (id && !old) throw new Error('资料不存在');
      const r: Resource = { ...(old ?? entity()), ...v, updatedAt: new Date().toISOString() };
      await database.resources.put(r);
      return r;
    },
  );
}
export async function archiveResource(id: string, archived: boolean, database = db) {
  await database.resources.update(id, {
    archivedAt: archived ? new Date().toISOString() : undefined,
    updatedAt: new Date().toISOString(),
  });
}
export async function linkResourceTask(resourceId: string, taskId: string, database = db) {
  await database.transaction(
    'rw',
    [database.resources, database.tasks, database.taskResources],
    async () => {
      const r = await database.resources.get(resourceId),
        t = await database.tasks.get(taskId);
      if (!r || !t || r.subjectId !== t.subjectId) throw new Error('资料与任务须属于同一科目');
      if (
        !(await database.taskResources
          .filter((v) => v.resourceId === resourceId && v.taskId === taskId)
          .count())
      )
        await database.taskResources.add({ ...entity(), resourceId, taskId });
    },
  );
}
