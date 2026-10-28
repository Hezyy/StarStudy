import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { initialBackup } from '../../server/store';
import { parsePlanText, previewStudyPlan } from '@/services/study-plan';
import { validateBackup } from '@/services/backup';
const example = () =>
  parsePlanText(readFileSync('public/templates/study-plan.minimal.json', 'utf8'));
describe('计划导入冲突边界', () => {
  it('长学习说明独立保存且可通过备份校验，不挤入500字章节字段', () => {
    const plan = example();
    plan.tasks[0].description = '完整学习说明。'.repeat(300);
    const preview = previewStudyPlan(plan, initialBackup(), 'merge', randomUUID);
    expect(preview.errors).toEqual([]);
    expect(preview.after.data.tasks[0].description).toBe(plan.tasks[0].description);
    expect(preview.after.data.tasks[0].chapter).toBe('');
    expect(() => validateBackup(preview.after)).not.toThrow();
    expect(previewStudyPlan(plan, preview.after, 'merge', randomUUID).duplicates).toHaveLength(1);
  });
  it.each(['merge', 'replace'] as const)(
    '相同外部任务标识内容变化在%s时明确冲突或预览变更，不能静默当重复跳过',
    (mode) => {
      const plan = example(),
        first = previewStudyPlan(plan, initialBackup(), 'merge', randomUUID);
      const changed = structuredClone(plan);
      changed.tasks[0].estimatedMinutes = 45;
      changed.tasks[0].title = '修改后的任务';
      const preview = previewStudyPlan(changed, first.after, mode, randomUUID),
        task = preview.after.data.tasks.find((t) => t.id === first.after.data.tasks[0].id)!;
      expect(
        preview.errors.length > 0 ||
          (task.estimatedMinutes === 45 && task.title === '修改后的任务'),
      ).toBe(true);
    },
  );
  it('不同科目的知识点和资源不能被任务误关联', () => {
    const plan = example();
    plan.subjects.push({ externalId: 'english', name: '英语一', category: 'english', priority: 2 });
    plan.knowledgePoints.push({
      externalId: 'english-kp',
      subjectId: 'english',
      name: '阅读',
      chapter: '阅读',
      dependencyIds: [],
    });
    plan.resources.push({
      externalId: 'english-resource',
      subjectId: 'english',
      title: '阅读课程',
      url: '',
      teacher: '',
      courseName: '',
      chapter: '阅读',
      section: '',
    });
    plan.tasks[0].knowledgePointIds = ['english-kp'];
    plan.tasks[0].resourceIds = ['english-resource'];
    const preview = previewStudyPlan(plan, initialBackup(), 'merge', randomUUID);
    expect(preview.errors.length).toBeGreaterThan(0);
  });
  it('同一外部科目标识被改名时先提示冲突，不能生成重复内部UUID后让确认导入才失败', () => {
    const plan = example();
    plan.subjects = [
      { externalId: 'custom', name: '自定义专业课A', category: 'custom', priority: 3 },
    ];
    plan.tasks[0].subjectId = 'custom';
    const first = previewStudyPlan(plan, initialBackup(), 'merge', randomUUID),
      changed = structuredClone(plan);
    changed.subjects[0].name = '自定义专业课B';
    changed.tasks[0].externalId = 'another-task';
    changed.tasks[0].title = '新任务';
    const preview = previewStudyPlan(changed, first.after, 'merge', randomUUID);
    expect(
      preview.errors.length > 0 ||
        new Set(preview.after.data.subjects.map((s) => s.id)).size ===
          preview.after.data.subjects.length,
    ).toBe(true);
    if (!preview.errors.length) expect(() => validateBackup(preview.after)).not.toThrow();
  });
});
