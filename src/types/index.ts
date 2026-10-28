export interface Entity {
  id: string;
  createdAt: string;
  updatedAt: string;
}
export type TaskStatus = 'todo' | 'in_progress' | 'partial' | 'completed' | 'skipped';
export type Mastery = 'unlearned' | 'unmastered' | 'weak' | 'basic' | 'proficient';
export interface MasteryEvent {
  mastery: Mastery;
  changedAt: string;
  note: string;
}
export interface UserProfile extends Entity {
  name: string;
  university: string;
  major: string;
  graduationDate: string;
}
export interface ExamTarget extends Entity {
  university: string;
  major: string;
  backupUniversity: string;
  examDate: string;
}
export interface Subject extends Entity {
  name: string;
  category: 'math' | 'english' | 'cs' | 'politics' | 'custom';
  priority: number;
  active: boolean;
}
export interface KnowledgePoint extends Entity {
  subjectId: string;
  name: string;
  parentId?: string;
  dependencyIds: string[];
  mastery: Mastery;
  chapter?: string;
  history?: MasteryEvent[];
  archivedAt?: string;
}
export interface Resource extends Entity {
  platform?: string;
  courseName?: string;
  section?: string;
  subjectId: string;
  name: string;
  teacher: string;
  url: string;
  chapter: string;
  episodes: string;
  textbook: string;
  exercises: string;
  verification: 'pending' | 'verified';
  progress?: number;
  mastery?: Mastery;
  knowledgePointIds?: string[];
  archivedAt?: string;
}
export interface StudyTask extends Entity {
  description?: string;
  taskType?: 'course' | 'exercise' | 'review' | 'exam' | 'reading' | 'other';
  date: string;
  subjectId: string;
  title: string;
  chapter: string;
  courseName: string;
  courseUrl: string;
  exercises: string;
  estimatedMinutes: number;
  status: TaskStatus;
  notes: string;
  knowledgePointIds: string[];
  priority: number;
  sourceKey?: string;
  rawImport?: Record<string, string>;
  deletedAt?: string;
  parentTaskId?: string;
  dueDate?: string;
  dependencyTaskIds?: string[];
  plannedMinutes?: number;
  originDate?: string;
  completedAt?: string;
  unscheduled?: boolean;
  mistakeId?: string;
  scheduleKey?: string;
}
export interface TaskResource extends Entity {
  watchedAt?: string;
  taskId: string;
  resourceId: string;
}
export interface TimeSegment {
  startedAt: number;
  endedAt?: number;
}
export interface StudySession extends Entity {
  taskId: string;
  state: 'running' | 'paused' | 'ended';
  segments: TimeSegment[];
}
export interface Mistake extends Entity {
  subjectId: string;
  knowledgePointIds: string[];
  question: string;
  wrongAnswer: string;
  correctAnswer: string;
  reason: string;
  reviewDate: string;
  mastery: Mastery;
  images: Blob[];
  chapter?: string;
  explanation?: string;
  taskIds?: string[];
  archivedAt?: string;
}
export interface MistakeReview extends Entity {
  mistakeId: string;
  mastery: Mastery;
  notes: string;
  reviewedAt: string;
}
export interface WeeklyReview extends Entity {
  weekStart: string;
  difficulty: string;
  unclear: string;
  schoolExams: string;
  nextWeekMinutes: number[];
  prioritySubjectId: string;
  suggestions?: string[];
  summarySnapshot?: unknown;
}
export interface PlanRevision extends Entity {
  revisionId: string;
  planVersion: number;
  reason: string;
  changes: string[];
  beforeSnapshot: StudyTask[];
  afterSnapshot: StudyTask[];
  approvedAt: string;
  revertedAt?: string;
  kind?: 'manual' | 'schedule' | 'undo' | 'restore' | 'external';
  restoresRevisionId?: string;
  beforePreferences?: Preferences;
  afterPreferences?: Preferences;
}
export interface SpecialBudget {
  start: string;
  end: string;
  minutes: number;
  label: string;
}
export interface Preferences {
  weekdayMinutes: number;
  weekendMinutes: number;
  vacationMinutes: number;
  specialBudgets: SpecialBudget[];
  theme: 'light' | 'dark' | 'system';
}
export interface AppSetting extends Entity {
  key: string;
  value: unknown;
}
export interface RecoverySnapshot extends Entity {
  json: string;
}
export interface CoreData {
  userProfiles: UserProfile[];
  examTargets: ExamTarget[];
  subjects: Subject[];
  knowledgePoints: KnowledgePoint[];
  resources: Resource[];
  tasks: StudyTask[];
  taskResources: TaskResource[];
  sessions: StudySession[];
  mistakes: Mistake[];
  mistakeReviews: MistakeReview[];
  weeklyReviews: WeeklyReview[];
  revisions: PlanRevision[];
  settings: AppSetting[];
}
export const TABLE_NAMES = [
  'userProfiles',
  'examTargets',
  'subjects',
  'knowledgePoints',
  'resources',
  'tasks',
  'taskResources',
  'sessions',
  'mistakes',
  'mistakeReviews',
  'weeklyReviews',
  'revisions',
  'settings',
] as const;
export type TableName = (typeof TABLE_NAMES)[number];
