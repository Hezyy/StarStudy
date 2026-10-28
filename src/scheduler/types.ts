import type { CoreData, Preferences, StudyTask } from '@/types';
export interface TaskChange {
  id: string;
  before?: StudyTask;
  after: StudyTask;
  reason: string;
  type: 'new' | 'move' | 'split' | 'update' | 'archive';
}
export interface Unscheduled {
  taskId: string;
  title: string;
  minutes: number;
  reason: string;
}
export interface PlanProposal {
  id: string;
  generatedAt: string;
  reason: string;
  kind: 'manual' | 'schedule' | 'undo' | 'restore' | 'external';
  stateToken: string;
  changes: TaskChange[];
  unassigned: Unscheduled[];
  warnings: string[];
  requiredMinutes: number;
  availableMinutes: number;
  from: string;
  to: string;
  preferencesBefore?: Preferences;
  preferencesAfter?: Preferences;
  restoresRevisionId?: string;
  conflicts?: { taskId: string; title: string; reason: string }[];
}
export interface ScheduleOptions {
  from: string;
  to: string;
  reason: string;
  maxChunkMinutes: number;
  addReviews: boolean;
  subjectDailyLimits: Record<string, number>;
  taskIds?: string[];
  generatedAt?: string;
}
export type ScheduleData = CoreData & { preferences: Preferences; examDate: string; today: string };
