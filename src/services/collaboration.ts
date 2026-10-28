import { z } from 'zod';
import { format, parseISO, subDays } from 'date-fns';
import type { CoreData, StudyTask } from '@/types';
import { db } from '@/db';
import { dateSchema } from '@/schemas';
import { entity, today, safeUrl } from '@/lib/utils';
import { needsReview, masteryLabels } from '@/lib/mastery';
import { analyze } from './analytics';
import { readCoreData } from './backup';
import { getPreferences, stateToken, validateProposal } from './plans';
import type { PlanProposal } from '@/scheduler/types';
const planningFields = z
  .object({
    date: dateSchema,
    estimatedMinutes: z.number().int().min(1).max(1440),
    title: z.string().trim().min(1).max(300).optional(),
    subjectId: z.uuid().optional(),
    chapter: z.string().max(500).optional(),
    courseName: z.string().max(500).optional(),
    courseUrl: z.string().refine(safeUrl).optional(),
    exercises: z.string().max(2000).optional(),
    knowledgePointIds: z.array(z.uuid()).optional(),
    dependencyTaskIds: z.array(z.uuid()).optional(),
    dueDate: dateSchema.optional(),
    priority: z.number().int().min(1).max(10).optional(),
  })
  .strict();
export const externalPlanSchema = z
  .object({
    app: z.literal('星研'),
    kind: z.literal('plan-adjustment'),
    schemaVersion: z.literal(1),
    basePlanVersion: z.number().int().nonnegative(),
    reason: z.string().trim().min(1).max(2000),
    changes: z
      .array(
        z.discriminatedUnion('operation', [
          z
            .object({ operation: z.literal('update'), taskId: z.uuid(), plan: planningFields })
            .strict(),
          z
            .object({
              operation: z.literal('create'),
              taskId: z.uuid(),
              plan: planningFields.extend({
                title: z.string().trim().min(1).max(300),
                subjectId: z.uuid(),
              }),
            })
            .strict(),
          z.object({ operation: z.literal('archive'), taskId: z.uuid() }).strict(),
        ]),
      )
      .min(1)
      .max(5000),
  })
  .strict();
export async function previewExternalPlan(input: unknown, database = db): Promise<PlanProposal> {
  const file = externalPlanSchema.parse(input),
    data = await readCoreData(database);
  const version = Math.max(0, ...data.revisions.map((r) => r.planVersion));
  if (file.basePlanVersion !== version)
    throw new Error(
      `方案基于 v${file.basePlanVersion}，当前为 v${version}，请重新导出报告生成方案`,
    );
  const stamp = new Date().toISOString(),
    ids = new Set<string>();
  const proposal: PlanProposal = {
    id: entity().id,
    generatedAt: stamp,
    reason: file.reason,
    kind: 'external',
    stateToken: stateToken(data),
    changes: [],
    unassigned: [],
    warnings: [],
    requiredMinutes: 0,
    availableMinutes: 0,
    from: today(),
    to: data.examTargets[0].examDate,
  };
  for (const change of file.changes) {
    if (ids.has(change.taskId)) throw new Error('调整方案包含重复任务ID');
    ids.add(change.taskId);
    const old = data.tasks.find((t) => t.id === change.taskId);
    if (change.operation === 'create') {
      if (old) throw new Error('新增任务ID已存在');
      const t: StudyTask = {
        ...entity(),
        id: change.taskId,
        originDate: change.plan.date,
        chapter: '',
        courseName: '',
        courseUrl: '',
        exercises: '',
        plannedMinutes: change.plan.estimatedMinutes,
        status: 'todo',
        notes: '',
        knowledgePointIds: [],
        priority: 3,
        ...change.plan,
      };
      proposal.changes.push({ id: t.id, after: t, reason: file.reason, type: 'new' });
    } else {
      if (!old || old.deletedAt) throw new Error('方案引用的任务ID不存在或已归档');
      if (old.status === 'completed') throw new Error('外部方案不能修改已完成任务');
      if (change.operation === 'archive')
        proposal.changes.push({
          id: old.id,
          before: old,
          after: { ...old, deletedAt: stamp, updatedAt: stamp },
          reason: file.reason,
          type: 'archive',
        });
      else {
        const t = {
          ...old,
          ...change.plan,
          plannedMinutes: change.plan.estimatedMinutes,
          unscheduled: false,
          updatedAt: stamp,
        };
        proposal.changes.push({
          id: t.id,
          before: old,
          after: t,
          reason: file.reason,
          type: old.date !== t.date ? 'move' : 'update',
        });
      }
    }
  }
  for (const c of proposal.changes)
    if (!c.after.deletedAt && !data.subjects.some((s) => s.id === c.after.subjectId && s.active))
      throw new Error('方案安排了已停用的考试科目，请明确切换科目');
  validateProposal(proposal, data);
  return proposal;
}
export interface ReportOptions {
  days: 7 | 30;
  from?: string;
  to?: string;
  includeFuture: boolean;
  includeNotes: boolean;
  includeMistakeText: boolean;
  request: string;
}
export function learningReport(data: CoreData, options: ReportOptions) {
  const end = options.to ?? today(),
    from = options.from ?? format(subDays(parseISO(end), options.days - 1), 'yyyy-MM-dd');
  const summary = analyze(data, from, end);
  const taskView = (t: StudyTask) => ({
    id: t.id,
    title: t.title,
    date: t.date,
    originDate: t.originDate ?? t.date,
    subjectId: t.subjectId,
    estimatedMinutes: t.estimatedMinutes,
    plannedMinutes: t.plannedMinutes,
    status: t.status,
    chapter: t.chapter,
    knowledgePointIds: t.knowledgePointIds,
    dependencyTaskIds: t.dependencyTaskIds ?? [],
    dueDate: t.dueDate,
    priority: t.priority,
    unscheduled: t.unscheduled ?? false,
    ...(options.includeNotes ? { notes: t.notes } : {}),
  });
  return {
    app: '星研',
    kind: 'study-report',
    schemaVersion: 1,
    appVersion: '0.4.0',
    generatedAt: new Date().toISOString(),
    currentDate: today(),
    basePlanVersion: Math.max(0, ...data.revisions.map((r) => r.planVersion)),
    target: data.examTargets[0],
    subjects: data.subjects.map((s) => ({
      id: s.id,
      name: s.name,
      active: s.active,
      category: s.category,
      priority: s.priority,
    })),
    preferences: getPreferences(data),
    range: { from, to: end },
    summary: {
      planned: summary.planned,
      actual: summary.actual,
      completed: summary.completed,
      total: summary.total,
      subjects: summary.subjects,
      streak: summary.streak,
    },
    recent7: analyze(data, format(subDays(parseISO(end), 6), 'yyyy-MM-dd'), end).days,
    recent30: analyze(data, format(subDays(parseISO(end), 29), 'yyyy-MM-dd'), end).days,
    records: data.tasks
      .filter((t) => !t.deletedAt && t.date >= from && t.date <= end)
      .map(taskView),
    unfinished: data.tasks
      .filter(
        (t) =>
          !t.deletedAt &&
          !['completed', 'skipped'].includes(t.status) &&
          (options.includeFuture || t.date <= end),
      )
      .map(taskView),
    knowledgePoints: data.knowledgePoints
      .filter((k) => !k.archivedAt)
      .map((k) => ({
        id: k.id,
        name: k.name,
        subjectId: k.subjectId,
        mastery: k.mastery,
        dependencyIds: k.dependencyIds,
      })),
    weakKnowledgePoints: data.knowledgePoints
      .filter((k) => !k.archivedAt && needsReview(k.mastery))
      .map((k) => ({ id: k.id, name: k.name, mastery: k.mastery })),
    mistakes: {
      count: summary.mistakeCount,
      due: summary.due.length,
      reviewCount: summary.reviewCount,
      ...(options.includeMistakeText
        ? {
            items: data.mistakes
              .filter((m) => !m.archivedAt)
              .map((m) => ({
                id: m.id,
                subjectId: m.subjectId,
                question: m.question,
                reason: m.reason,
                mastery: m.mastery,
                reviewDate: m.reviewDate,
              })),
          }
        : {}),
    },
    ...(options.includeFuture
      ? { future: data.tasks.filter((t) => !t.deletedAt && t.date > end).map(taskView) }
      : {}),
    request: options.request,
    privacy: {
      notes: options.includeNotes,
      mistakeText: options.includeMistakeText,
      images: false,
    },
    adjustmentContract:
      '返回 kind=plan-adjustment、schemaVersion=1 的 JSON。保留稳定任务ID，先校验依赖与预算，再由用户确认。',
  };
}
export function reportMarkdown(report: ReturnType<typeof learningReport>) {
  return `# 星研学习报告\n\n导出时间：${report.generatedAt}\n\n目标：${report.target.university} ${report.target.major}\n初试：${report.target.examDate}\n计划版本：v${report.basePlanVersion}\n范围：${report.range.from} 至 ${report.range.to}\n\n## 汇总\n计划 ${report.summary.planned} 分钟，实际 ${Math.floor(report.summary.actual)} 分钟；任务完成 ${report.summary.completed}/${report.summary.total}。\n\n## 用户调整要求\n${report.request || '无'}\n\n## 各科\n${report.summary.subjects.map((s) => `- ${s.name}：实际 ${Math.floor(s.actual)} 分钟，任务 ${s.completed}/${s.total}`).join('\n')}\n\n## 薄弱知识点\n${report.weakKnowledgePoints.map((k) => `- ${k.name}（${masteryLabels[k.mastery]}）`).join('\n') || '暂无已记录的薄弱点'}\n\n## 可供调整的结构化上下文\n\`\`\`json\n${JSON.stringify(report, null, 2)}\n\`\`\`\n\n不含图片。未勾选时不包含学习笔记与错题文本。请使用配套方案模板，所有调整都需要应用内预览确认。`;
}
export function planTemplate(data: CoreData) {
  const t = data.tasks.find((t) => !t.deletedAt && !['completed', 'skipped'].includes(t.status));
  return {
    app: '星研',
    kind: 'plan-adjustment',
    schemaVersion: 1,
    basePlanVersion: Math.max(0, ...data.revisions.map((r) => r.planVersion)),
    reason: '请填写调整原因',
    changes: t
      ? [
          {
            operation: 'update',
            taskId: t.id,
            plan: {
              date: t.date < today() ? today() : t.date,
              estimatedMinutes: t.estimatedMinutes,
            },
          },
        ]
      : [
          {
            operation: 'create',
            taskId: entity().id,
            plan: {
              title: '请替换为实际学习任务',
              subjectId: data.subjects.find((s) => s.active)!.id,
              date: today(),
              estimatedMinutes: 20,
            },
          },
        ],
  };
}
