import { z } from 'zod';
import { dateSchema } from '@/schemas';
import { safeUrl } from '@/lib/utils';
import { videoLink } from '@/lib/video-link';
const id = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[\w.-]+$/, '引用标识仅允许字母、数字、点、横线和下划线');
const text = z.string().max(20000);
export const studyPlanSchema = z.strictObject({
  schemaVersion: z.literal('1.0.0'),
  planId: id,
  planName: z.string().trim().min(1).max(200),
  generatedAt: z.iso.datetime(),
  startDate: dateSchema,
  endDate: dateSchema,
  timezone: z.literal('Asia/Shanghai'),
  examTarget: z.strictObject({
    university: z.string().max(200),
    major: z.string().max(200),
    examDate: dateSchema,
  }),
  subjects: z
    .array(
      z.strictObject({
        externalId: id,
        name: z.string().min(1).max(100),
        category: z.enum(['math', 'english', 'cs', 'politics', 'custom']),
        priority: z.number().int().min(1).max(10),
      }),
    )
    .min(1)
    .max(50),
  resources: z
    .array(
      z.strictObject({
        externalId: id,
        subjectId: id,
        title: z.string().min(1).max(300),
        url: z
          .string()
          .max(2000)
          .refine(safeUrl, '资源链接必须为有效的 http/https 地址')
          .refine((v) => videoLink(v).kind !== 'invalid', '视频链接或选集参数无效'),
        teacher: z.string().max(200).default(''),
        courseName: z.string().max(300).default(''),
        chapter: z.string().max(300).default(''),
        section: z.string().max(300).default(''),
      }),
    )
    .max(10000),
  knowledgePoints: z
    .array(
      z.strictObject({
        externalId: id,
        subjectId: id,
        name: z.string().min(1).max(300),
        chapter: z.string().max(300).default(''),
        dependencyIds: z.array(id).max(100).default([]),
      }),
    )
    .max(10000),
  tasks: z
    .array(
      z.strictObject({
        externalId: id,
        date: dateSchema,
        subjectId: id,
        title: z.string().trim().min(1).max(300),
        description: text.default(''),
        estimatedMinutes: z.number().int().min(1).max(720),
        taskType: z.enum(['course', 'exercise', 'review', 'exam', 'reading', 'other']),
        priority: z.number().int().min(1).max(10),
        knowledgePointIds: z.array(id).max(100),
        resourceIds: z.array(id).max(100),
        exerciseDescription: z.string().max(2000).default(''),
        notes: text.default(''),
      }),
    )
    .min(1)
    .max(20000),
  metadata: z.strictObject({
    source: z.string().max(200).default(''),
    chunk: z.string().max(100).optional(),
    notes: z.string().max(2000).default(''),
  }),
});
export type StudyPlan = z.infer<typeof studyPlanSchema>;
export const importModeSchema = z.enum(['new', 'merge', 'replace']);
export type ImportMode = z.infer<typeof importModeSchema>;
