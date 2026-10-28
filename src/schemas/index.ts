import { z } from 'zod';
import { validDate, safeUrl } from '@/lib/utils';
export const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, '日期须为YYYY-MM-DD')
  .refine(validDate, '请输入有效日期（YYYY-MM-DD）');
export const masterySchema = z.enum(['unlearned', 'unmastered', 'weak', 'basic', 'proficient']);
export const taskSchema = z.object({
  date: dateSchema,
  subjectId: z.uuid(),
  title: z.string().trim().min(1, '请填写任务名称').max(300),
  description: z.string().max(20000).optional(),
  chapter: z.string().max(500),
  courseName: z.string().max(500),
  courseUrl: z.string().refine(safeUrl, '网课链接须为 http 或 https 地址'),
  exercises: z.string().max(2000),
  estimatedMinutes: z.number().int().min(1).max(1440),
  status: z.enum(['todo', 'in_progress', 'partial', 'completed', 'skipped']),
  notes: z.string().max(20000),
  knowledgePointIds: z.array(z.uuid()),
  priority: z.number().int().min(1).max(10),
  dueDate: dateSchema.optional(),
  dependencyTaskIds: z.array(z.uuid()).optional(),
});
export type TaskInput = z.infer<typeof taskSchema>;
