import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { initialBackup } from '../../server/store';
import { parsePlanText, previewStudyPlan } from '@/services/study-plan';
import { createBackup, restoreBackup, validateBackup, type Backup } from '@/services/backup';
import { buildPlanCleanup, createPlanCleanup } from '@/services/plan-cleanup';
import { applyProposal } from '@/services/plans';
import { testDatabase } from './helpers';
import type { CoreData, TaskStatus } from '@/types';

const stamp = '2026-10-28T12:00:00.000Z';
const example = () =>
  parsePlanText(readFileSync('public/templates/study-plan.minimal.json', 'utf8'));
function withResources() {
  const plan = example();
  plan.resources.push({
    externalId: 'course',
    subjectId: 'math',
    title: '合成课程',
    url: '',
    teacher: '',
    courseName: '',
    chapter: '',
    section: '',
  });
  plan.tasks[0].resourceIds = ['course'];
  return plan;
}
function archiveEmptyPlans(backup: Backup) {
  const copy = structuredClone(backup);
  const core: CoreData = { ...backup.data, mistakes: [] };
  const cleanup = buildPlanCleanup(core, {});
  for (const change of cleanup.proposal.changes)
    copy.data.tasks[copy.data.tasks.findIndex((task) => task.id === change.id)] = change.after;
  return copy;
}

describe('安全清空后的标准AI计划重导', () => {
  it('实际清空确认后原ID可预览恢复，确认前数据库不变，再次导入只跳过重复', async () => {
    const database = await testDatabase();
    try {
      const plan = withResources();
      const first = previewStudyPlan(plan, await createBackup(database), 'merge', randomUUID);
      await restoreBackup(first.after, database);
      const original = (await database.tasks.toArray())[0];
      await database.tasks.update(original.id, {
        notes: '自己记录的原笔记',
        rawImport: { originalField: '原始内容' },
      });
      const cleanup = await createPlanCleanup({}, database);
      await applyProposal(cleanup.proposal, true, database);
      const archived = await createBackup(database);
      const preview = previewStudyPlan(plan, archived, 'merge', randomUUID);
      expect(preview.errors).toEqual([]);
      expect(preview.added).toBe(0);
      expect(preview.restored).toBe(1);
      expect(preview.changes.some((change) => change.startsWith('恢复：'))).toBe(true);
      expect((await database.tasks.get(original.id))?.deletedAt).toBeTruthy();
      const recovered = preview.after.data.tasks[0];
      expect(recovered.id).toBe(original.id);
      expect(recovered.createdAt).toBe(original.createdAt);
      expect(recovered.notes).toBe('自己记录的原笔记');
      expect(recovered.rawImport?.originalField).toBe('原始内容');
      expect(preview.after.data.taskResources).toEqual(archived.data.taskResources);
      expect(preview.after.data.revisions.slice(0, archived.data.revisions.length)).toEqual(
        archived.data.revisions,
      );
      expect(preview.after.data.revisions.at(-1)?.beforeSnapshot[0].deletedAt).toBeTruthy();
      expect(() => validateBackup(preview.after)).not.toThrow();
      await restoreBackup(preview.after, database);
      const repeat = previewStudyPlan(plan, await createBackup(database), 'merge', randomUUID);
      expect(repeat.errors).toEqual([]);
      expect(repeat.restored).toBe(0);
      expect(repeat.added).toBe(0);
      expect(repeat.duplicates).toHaveLength(1);
      expect(await database.tasks.count()).toBe(1);
      expect((await database.tasks.get(original.id))?.notes).toBe('自己记录的原笔记');
    } finally {
      await database.delete();
    }
  });

  it.each(['merge', 'replace'] as const)(
    '安全归档任务在%s中可恢复新定义，同时保留原笔记和最初日期',
    (mode) => {
      const plan = example();
      plan.tasks[0].notes = 'AI原始备注';
      const first = previewStudyPlan(plan, initialBackup(), 'merge', randomUUID);
      const original = first.after.data.tasks[0];
      original.notes = '真实的私人笔记';
      original.plannedMinutes = 10;
      original.unscheduled = true;
      const archived = archiveEmptyPlans(first.after);
      const changed = structuredClone(plan);
      changed.tasks[0].title = '新的复习安排';
      changed.tasks[0].date = '2027-01-02';
      changed.tasks[0].estimatedMinutes = 40;
      const preview = previewStudyPlan(changed, archived, mode, randomUUID);
      expect(preview.errors).toEqual([]);
      expect(preview.restored).toBe(1);
      expect(preview.added).toBe(0);
      expect(preview.after.data.tasks[0]).toMatchObject({
        id: original.id,
        title: '新的复习安排',
        date: '2027-01-02',
        originDate: original.originDate,
        notes: '真实的私人笔记',
        plannedMinutes: 40,
        unscheduled: false,
      });
      expect(preview.after.data.tasks[0].deletedAt).toBeUndefined();
      expect(archived.data.tasks[0].deletedAt).toBeTruthy();
      const repeat = previewStudyPlan(changed, preview.after, 'merge', randomUUID);
      expect(repeat.errors).toEqual([]);
      expect(repeat.duplicates).toHaveLength(1);
      const newChange = structuredClone(changed);
      newChange.tasks[0].estimatedMinutes = 41;
      expect(
        previewStudyPlan(newChange, preview.after, 'merge', randomUUID).errors.some((message) =>
          message.includes('标识已存在'),
        ),
      ).toBe(true);
    },
  );

  it.each(['completed', 'partial', 'in_progress', 'skipped'] satisfies TaskStatus[])(
    '归档任务已有%s状态时不能自动恢复、改写或生成新ID',
    (status) => {
      const plan = example();
      const first = previewStudyPlan(plan, initialBackup(), 'merge', randomUUID);
      const original = first.after.data.tasks[0];
      original.status = status;
      original.deletedAt = stamp;
      original.notes = '必须保留';
      const before = structuredClone(first.after.data.tasks);
      const preview = previewStudyPlan(plan, first.after, 'merge', randomUUID);
      expect(preview.errors.some((error) => error.includes('不能自动恢复或覆盖'))).toBe(true);
      expect(preview.restored).toBe(0);
      expect(preview.added).toBe(0);
      expect(preview.after.data.tasks).toEqual(before);
    },
  );

  it.each(['session', 'watch', 'completion'] as const)(
    'todo归档任务存在%s记录时仍保护真实历史',
    (kind) => {
      const plan = withResources();
      const first = previewStudyPlan(plan, initialBackup(), 'merge', randomUUID);
      const original = first.after.data.tasks[0];
      original.deletedAt = stamp;
      if (kind === 'session')
        first.after.data.sessions.push({
          id: randomUUID(),
          createdAt: stamp,
          updatedAt: stamp,
          taskId: original.id,
          state: 'ended',
          segments: [{ startedAt: 1000, endedAt: 1000 }],
        });
      if (kind === 'watch') first.after.data.taskResources[0].watchedAt = stamp;
      if (kind === 'completion') original.completedAt = stamp;
      const before = structuredClone(first.after);
      const preview = previewStudyPlan(plan, first.after, 'merge', randomUUID);
      expect(preview.errors.length).toBeGreaterThan(0);
      expect(preview.restored).toBe(0);
      expect(preview.after.data.tasks).toEqual(before.data.tasks);
      expect(preview.after.data.sessions).toEqual(before.data.sessions);
      expect(preview.after.data.taskResources).toEqual(before.data.taskResources);
      const differentId = structuredClone(plan);
      differentId.tasks[0].externalId = 'different-import-id';
      expect(previewStudyPlan(differentId, first.after, 'merge', randomUUID).added).toBe(0);
    },
  );

  it('replace保留有状态、计时和观看的原任务，仅归档真正未开始的行', () => {
    const plan = withResources();
    plan.tasks = Array.from({ length: 7 }, (_, index) => ({
      ...plan.tasks[0],
      externalId: `original-${index}`,
      title: `原任务${index}`,
      estimatedMinutes: 10,
    }));
    const first = previewStudyPlan(plan, initialBackup(), 'merge', randomUUID);
    (['partial', 'in_progress', 'skipped', 'completed'] as const).forEach((status, index) => {
      first.after.data.tasks[index + 1].status = status;
    });
    first.after.data.taskResources.find(
      (link) => link.taskId === first.after.data.tasks[5].id,
    )!.watchedAt = stamp;
    first.after.data.sessions.push({
      id: randomUUID(),
      createdAt: stamp,
      updatedAt: stamp,
      taskId: first.after.data.tasks[6].id,
      state: 'ended',
      segments: [{ startedAt: 1000, endedAt: 2000 }],
    });
    const replacement = withResources();
    replacement.tasks[0].externalId = 'new-task';
    const preview = previewStudyPlan(replacement, first.after, 'replace', randomUUID);
    expect(preview.errors).toEqual([]);
    expect(preview.after.data.tasks[0].deletedAt).toBeTruthy();
    expect(preview.after.data.tasks.slice(1, 7)).toEqual(first.after.data.tasks.slice(1, 7));
    expect(preview.after.data.sessions).toEqual(first.after.data.sessions);
    expect(preview.after.data.taskResources.slice(0, 7)).toEqual(first.after.data.taskResources);
    expect(preview.added).toBe(1);
  });

  it('恢复仍受每日预算和知识点依赖约束，预览报错不会改变归档输入', () => {
    const plan = example();
    const first = previewStudyPlan(plan, initialBackup(), 'merge', randomUUID);
    const archived = archiveEmptyPlans(first.after);
    archived.data.tasks.push({
      ...archived.data.tasks[0],
      id: randomUUID(),
      sourceKey: undefined,
      title: '同日其他任务',
      estimatedMinutes: 70,
      deletedAt: undefined,
    });
    expect(
      previewStudyPlan(plan, archived, 'merge', randomUUID).errors.some((error) =>
        error.includes('超过可用时间'),
      ),
    ).toBe(true);
    expect(archived.data.tasks[0].deletedAt).toBeTruthy();
    const dependent = example();
    dependent.knowledgePoints = [
      { externalId: 'base', subjectId: 'math', name: '基础', chapter: '', dependencyIds: [] },
      { externalId: 'next', subjectId: 'math', name: '后续', chapter: '', dependencyIds: ['base'] },
    ];
    dependent.tasks = [
      { ...dependent.tasks[0], externalId: 'base-task', knowledgePointIds: ['base'] },
      {
        ...dependent.tasks[0],
        externalId: 'next-task',
        title: '后续学习',
        date: '2027-01-02',
        knowledgePointIds: ['next'],
      },
    ];
    const two = previewStudyPlan(dependent, initialBackup(), 'merge', randomUUID);
    expect(two.errors).toEqual([]);
    const cleared = archiveEmptyPlans(two.after);
    dependent.tasks = [dependent.tasks[1]];
    expect(
      previewStudyPlan(dependent, cleared, 'merge', randomUUID).errors.some((error) =>
        error.includes('缺少在先'),
      ),
    ).toBe(true);
  });

  it('保留原手动任务依赖，不能只恢复后续任务而遗漏其归档前置任务', () => {
    const plan = example();
    plan.tasks.push({
      ...plan.tasks[0],
      externalId: 'next-task',
      title: '后续任务',
      date: '2027-01-02',
    });
    const first = previewStudyPlan(plan, initialBackup(), 'merge', randomUUID);
    first.after.data.tasks[1].dependencyTaskIds = [first.after.data.tasks[0].id];
    const cleared = archiveEmptyPlans(first.after);
    plan.tasks = [plan.tasks[1]];
    expect(
      previewStudyPlan(plan, cleared, 'merge', randomUUID).errors.some((error) =>
        error.includes('前置任务顺序'),
      ),
    ).toBe(true);
  });

  it('丢失单个registry映射时通过sourceKey恢复原ID；同日不同任务仍合法', () => {
    const plan = example();
    const first = previewStudyPlan(plan, initialBackup(), 'merge', randomUUID);
    const cleared = archiveEmptyPlans(first.after);
    const registry = cleared.data.settings.find(
      (setting) => setting.key === 'plan-import-registry',
    )!.value as Record<string, string>;
    delete registry[`${plan.planId}/tasks/${plan.tasks[0].externalId}`];
    const preview = previewStudyPlan(plan, cleared, 'merge', randomUUID);
    expect(preview.errors).toEqual([]);
    expect(preview.restored).toBe(1);
    expect(preview.after.data.tasks[0].id).toBe(first.after.data.tasks[0].id);
    expect(preview.after.data.tasks).toHaveLength(1);
    const two = example();
    two.tasks.push({
      ...two.tasks[0],
      externalId: 'same-day-another-task',
      title: '另一项同日学习',
    });
    const sameDay = previewStudyPlan(two, initialBackup(), 'merge', randomUUID);
    expect(sameDay.errors).toEqual([]);
    expect(sameDay.added).toBe(2);
  });
});
