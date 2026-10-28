import type { Mastery } from '@/types';
export const masteryLabels: Record<Mastery, string> = {
  unlearned: '未学习',
  unmastered: '未掌握',
  weak: '薄弱',
  basic: '基本掌握',
  proficient: '熟练掌握',
};
export const masteryValues = Object.keys(masteryLabels) as Mastery[];
export const needsReview = (v: Mastery) => v === 'unmastered' || v === 'weak';
export const reviewInterval = (v: Mastery) =>
  ({ unlearned: 1, unmastered: 1, weak: 3, basic: 7, proficient: 21 })[v];
