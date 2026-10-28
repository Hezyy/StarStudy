import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { StarDatabase } from '@/db';
import { testDatabase, sampleTask } from './helpers';
import {
  saveKnowledge,
  saveMistake,
  reviewMistake,
  archiveMistake,
  mistakeToTask,
  saveResource,
  linkResourceTask,
} from '@/services/learning';
import { createBackup, restoreBackup } from '@/services/backup';
describe('学习管理', () => {
  let d: StarDatabase;
  let subjectId: string;
  beforeEach(async () => {
    d = await testDatabase();
    subjectId = (await d.subjects.where('category').equals('math').first())!.id;
  });
  afterEach(async () => {
    await d.delete();
  });
  it('知识点评估保留历史，循环依赖拒绝，不由打卡自动升级', async () => {
    const a = await saveKnowledge(
      { subjectId, name: '矩阵', mastery: 'weak', dependencyIds: [] },
      undefined,
      d,
    );
    const b = await saveKnowledge(
      { subjectId, name: '逆矩阵', mastery: 'unlearned', dependencyIds: [a.id] },
      undefined,
      d,
    );
    await expect(saveKnowledge({ ...a, dependencyIds: [b.id] }, a.id, d)).rejects.toThrow('循环');
    await sampleTask(d, { knowledgePointIds: [a.id], status: 'completed' });
    expect((await d.knowledgePoints.get(a.id))?.mastery).toBe('weak');
    await saveKnowledge({ ...a, mastery: 'basic' }, a.id, d);
    expect((await d.knowledgePoints.get(a.id))?.history).toHaveLength(2);
  });
  it('错题图片刷新和新旧格式备份恢复完整，复习需主动同步掌握度', async () => {
    const k = await saveKnowledge(
      { subjectId, name: '极限', mastery: 'weak', dependencyIds: [] },
      undefined,
      d,
    );
    const m = await saveMistake(
      {
        subjectId,
        question: '求极限',
        wrongAnswer: '0',
        correctAnswer: '1',
        reason: '混淆',
        explanation: '定义',
        chapter: '极限',
        knowledgePointIds: [k.id],
        reviewDate: '2026-11-01',
        mastery: 'unmastered',
        images: [new Blob(['image'], { type: 'image/png' })],
      },
      undefined,
      d,
    );
    d.close();
    await d.open();
    expect(await (await d.mistakes.get(m.id))!.images[0].text()).toBe('image');
    await reviewMistake(m.id, 'basic', '理解了', '2026-11-08', false, d);
    expect((await d.knowledgePoints.get(k.id))?.mastery).toBe('weak');
    await reviewMistake(m.id, 'proficient', '确认', '2026-12-01', true, d);
    expect((await d.knowledgePoints.get(k.id))?.mastery).toBe('proficient');
    const backup = await createBackup(d);
    await restoreBackup(backup, d);
    expect((await d.mistakes.get(m.id))?.explanation).toBe('定义');
    expect(await (await d.mistakes.get(m.id))!.images[0].text()).toBe('image');
    expect(await d.mistakeReviews.count()).toBe(2);
  });
  it('错题复习任务防重复；归档保留图片和复习记录', async () => {
    const m = await saveMistake(
      {
        subjectId,
        question: '测试',
        wrongAnswer: '',
        correctAnswer: '',
        reason: '',
        knowledgePointIds: [],
        reviewDate: '2026-11-01',
        mastery: 'weak',
        images: [],
      },
      undefined,
      d,
    );
    await mistakeToTask(m.id, '2026-11-01', 20, d);
    await expect(mistakeToTask(m.id, '2026-11-01', 20, d)).rejects.toThrow('已有');
    await archiveMistake(m.id, true, d);
    expect(await d.mistakes.count()).toBe(1);
  });
  it('真实课程可保存进度并关联任务，不自动核实课程', async () => {
    const t = await sampleTask(d);
    const r = await saveResource(
      {
        subjectId,
        name: '自选课程',
        teacher: '',
        url: '',
        chapter: '高等数学',
        episodes: '',
        textbook: '',
        exercises: '',
        verification: 'pending',
        progress: 20,
        mastery: 'weak',
        knowledgePointIds: [],
      },
      undefined,
      d,
    );
    await linkResourceTask(r.id, t.id, d);
    await linkResourceTask(r.id, t.id, d);
    expect(await d.taskResources.count()).toBe(1);
    expect((await d.resources.get(r.id))?.verification).toBe('pending');
  });
});
