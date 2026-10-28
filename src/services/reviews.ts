import { z } from 'zod';
import { addDays, format, parseISO, startOfWeek } from 'date-fns';
import { db } from '@/db';
import { readCoreData } from './backup';
import { analyze, weekSuggestions } from './analytics';
import { dateSchema } from '@/schemas';
import { entity, defaults } from '@/lib/utils';
import type { Preferences } from '@/types';
const input = z.object({
  weekStart: dateSchema,
  difficulty: z.string().max(20000),
  unclear: z.string().max(20000),
  schoolExams: z.string().max(20000),
  nextWeekMinutes: z.array(z.number().int().min(0).max(1440)).length(7),
  prioritySubjectId: z.uuid(),
});
export async function saveWeeklyReview(value: z.infer<typeof input>, database = db) {
  const v = input.parse(value);
  if (format(startOfWeek(parseISO(v.weekStart), { weekStartsOn: 1 }), 'yyyy-MM-dd') !== v.weekStart)
    throw new Error('周复盘起始日期必须是周一');
  const data = await readCoreData(database);
  if (!data.subjects.some((s) => s.id === v.prioritySubjectId)) throw new Error('优先科目不存在');
  const summary = analyze(
    data,
    v.weekStart,
    format(addDays(parseISO(v.weekStart), 6), 'yyyy-MM-dd'),
  );
  const pref = (data.settings.find((s) => s.key === 'preferences')?.value ??
    defaults) as Preferences;
  const suggestions = weekSuggestions(
    summary,
    pref,
    format(addDays(parseISO(v.weekStart), 7), 'yyyy-MM-dd'),
    v.nextWeekMinutes,
    v.prioritySubjectId,
  );
  return database.transaction('rw', database.weeklyReviews, async () => {
    const before = await database.weeklyReviews.where('weekStart').equals(v.weekStart).first();
    const record = {
      ...(before ?? entity()),
      ...v,
      suggestions,
      summarySnapshot: summary,
      updatedAt: new Date().toISOString(),
    };
    await database.weeklyReviews.put(record);
    return record;
  });
}
