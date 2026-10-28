import { z } from 'zod';
import { db } from '@/db';
import { entity, validDate, today } from '@/lib/utils';
import { preferencesValue } from './backup';
import type { ExamTarget, Preferences, UserProfile } from '@/types';

const categories = ['math', 'english', 'cs', 'politics'] as const;
export async function saveSettings(
  input: {
    target: ExamTarget;
    profile: UserProfile;
    preferences: Preferences;
    names: Record<string, string>;
    priorities: Record<string, number>;
  },
  database = db,
) {
  const { target, profile, names, priorities } = input;
  const preferences = preferencesValue(input.preferences);
  if (!validDate(target.examDate) || !validDate(profile.graduationDate))
    throw new Error('考试或毕业日期无效');
  z.string().trim().min(1).max(200).parse(target.university);
  z.string().trim().max(200).parse(target.major);
  for (const c of categories) {
    z.string().trim().min(1).max(80).parse(names[c]);
    z.number().int().min(1).max(10).parse(priorities[c]);
  }
  await database.transaction(
    'rw',
    [
      database.examTargets,
      database.userProfiles,
      database.settings,
      database.subjects,
      database.tasks,
    ],
    async () => {
      const now = new Date().toISOString();
      const subjects = await database.subjects.toArray();
      const previous = await database.examTargets.get(target.id);
      const changed =
        (previous &&
          (previous.university !== target.university ||
            previous.major !== target.major ||
            previous.examDate !== target.examDate)) ||
        categories.some(
          (c) => subjects.find((s) => s.active && s.category === c)?.name !== names[c].trim(),
        );
      if (changed) {
        const pending = await database.tasks
          .filter(
            (t) =>
              !t.deletedAt && !['completed', 'skipped'].includes(t.status) && t.date >= today(),
          )
          .toArray();
        const oldNotice = await database.settings.where('key').equals('plan-review-notice').first();
        await database.settings.put({
          ...(oldNotice ?? entity()),
          key: 'plan-review-notice',
          value: {
            acknowledged: false,
            changedAt: now,
            previousTarget: previous,
            previousSubjects: subjects,
            taskIds: pending.map((t) => t.id),
          },
          updatedAt: now,
        });
      }
      const setting = await database.settings.where('key').equals('preferences').first();
      if (!setting) throw new Error('应用设置不存在，请重新打开应用');
      await database.examTargets.put({ ...target, updatedAt: now });
      await database.userProfiles.put({ ...profile, updatedAt: now });
      await database.settings.put({ ...setting, value: preferences, updatedAt: now });
      for (const category of categories) {
        const name = names[category].trim();
        const matching = subjects.find((s) => s.category === category && s.name === name);
        for (const s of subjects.filter((s) => s.category === category))
          await database.subjects.update(s.id, { active: s.id === matching?.id, updatedAt: now });
        if (matching)
          await database.subjects.update(matching.id, {
            active: true,
            priority: priorities[category],
            updatedAt: now,
          });
        else
          await database.subjects.add({
            ...entity(),
            category,
            name,
            priority: priorities[category],
            active: true,
          });
      }
    },
  );
}
