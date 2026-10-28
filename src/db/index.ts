import Dexie, { type EntityTable } from 'dexie';
import type {
  UserProfile,
  ExamTarget,
  Subject,
  KnowledgePoint,
  Resource,
  StudyTask,
  TaskResource,
  StudySession,
  Mistake,
  MistakeReview,
  WeeklyReview,
  PlanRevision,
  AppSetting,
  RecoverySnapshot,
} from '@/types';
import { entity, defaults } from '@/lib/utils';
export class StarDatabase extends Dexie {
  userProfiles!: EntityTable<UserProfile, 'id'>;
  examTargets!: EntityTable<ExamTarget, 'id'>;
  subjects!: EntityTable<Subject, 'id'>;
  knowledgePoints!: EntityTable<KnowledgePoint, 'id'>;
  resources!: EntityTable<Resource, 'id'>;
  tasks!: EntityTable<StudyTask, 'id'>;
  taskResources!: EntityTable<TaskResource, 'id'>;
  sessions!: EntityTable<StudySession, 'id'>;
  mistakes!: EntityTable<Mistake, 'id'>;
  mistakeReviews!: EntityTable<MistakeReview, 'id'>;
  weeklyReviews!: EntityTable<WeeklyReview, 'id'>;
  revisions!: EntityTable<PlanRevision, 'id'>;
  settings!: EntityTable<AppSetting, 'id'>;
  recoverySnapshots!: EntityTable<RecoverySnapshot, 'id'>;
  constructor(name = 'star-study') {
    super(name);
    this.version(1).stores({
      userProfiles: 'id',
      examTargets: 'id, examDate',
      subjects: 'id, category',
      knowledgePoints: 'id, subjectId, parentId, mastery',
      resources: 'id, subjectId',
      tasks: 'id, date, subjectId, status, sourceKey, [date+subjectId], *knowledgePointIds',
      taskResources: 'id, taskId, resourceId',
      sessions: 'id, taskId, state',
      mistakes: 'id, subjectId, reviewDate, mastery',
      mistakeReviews: 'id, mistakeId',
      weeklyReviews: 'id, &weekStart',
      revisions: 'id, &revisionId, planVersion, createdAt',
      settings: 'id, &key',
    });
    this.version(2)
      .stores({
        tasks:
          'id, date, subjectId, status, sourceKey, [date+subjectId], *knowledgePointIds, deletedAt',
        recoverySnapshots: 'id, createdAt',
      })
      .upgrade(async (tx) => {
        // v2 adds soft deletion and isolated restore safety snapshots; study history is retained.
        await tx
          .table('tasks')
          .toCollection()
          .modify((task) => {
            task.knowledgePointIds ??= [];
          });
      });
    this.version(3)
      .stores({
        tasks:
          'id, date, subjectId, status, sourceKey, [date+subjectId], *knowledgePointIds, deletedAt, dueDate, scheduleKey, mistakeId, originDate',
        mistakes: 'id, subjectId, reviewDate, mastery, chapter, archivedAt, *knowledgePointIds',
        knowledgePoints: 'id, subjectId, parentId, mastery, chapter, archivedAt',
        resources: 'id, subjectId, chapter, archivedAt',
      })
      .upgrade(async (tx) => {
        await tx
          .table('tasks')
          .toCollection()
          .modify((task) => {
            task.originDate ??= task.date;
          });
        await tx
          .table('mistakes')
          .toCollection()
          .modify((m) => {
            m.chapter ??= '';
            m.explanation ??= '';
            m.taskIds ??= [];
          });
        await tx
          .table('knowledgePoints')
          .toCollection()
          .modify((k) => {
            k.chapter ??= '';
            k.history ??= [];
          });
      });
  }
}
export let db = new StarDatabase();
export function selectDatabase(accountId?: string) {
  const name = accountId ? `star-study-account-${accountId}` : 'star-study';
  if (db.name !== name) { db.close(); db = new StarDatabase(name); }
  return db;
}
export async function initialize(database = db) {
  await database.transaction(
    'rw',
    [database.userProfiles, database.examTargets, database.subjects, database.settings],
    async () => {
      if (await database.userProfiles.count()) return;
      await database.userProfiles.add({
        ...entity(),
        name: '研途同行者',
        university: '',
        major: '',
        graduationDate: `${new Date().getFullYear() + 2}-06-30`,
      });
      await database.examTargets.add({
        ...entity(),
        university: '待设置目标院校',
        major: '',
        backupUniversity: '',
        examDate: `${new Date().getFullYear() + 1}-12-25`,
      });
      await database.subjects.bulkAdd([
        { ...entity(), name: '数学一', category: 'math', priority: 1, active: true },
        { ...entity(), name: '英语一', category: 'english', priority: 2, active: true },
        { ...entity(), name: '408', category: 'cs', priority: 3, active: true },
        { ...entity(), name: '思想政治理论', category: 'politics', priority: 4, active: true },
      ]);
      await database.settings.add({ ...entity(), key: 'preferences', value: defaults });
    },
  );
}
