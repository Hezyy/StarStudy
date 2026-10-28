import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { StarDatabase } from '@/db';
import { testDatabase, sampleTask } from './helpers';
import { learningReport, previewExternalPlan } from '@/services/collaboration';
import { readCoreData, createBackup, backupPreview, restoreBackup } from '@/services/backup';
import { applyProposal } from '@/services/plans';
import { today } from '@/lib/utils';
import { pushSnapshot, syncDecision, SyncConflict, type SnapshotStore } from '@/services/cloud';
import { aiResponse, integrationConfig } from '../../scripts/api.mjs';
describe('外部方案与隐私', () => {
  let d: StarDatabase;
  beforeEach(async () => {
    d = await testDatabase();
  });
  afterEach(async () => {
    await d.delete();
  });
  const file = (version: number, id: string, plan: Record<string, unknown>) => ({
    app: '星研',
    kind: 'plan-adjustment',
    schemaVersion: 1,
    basePlanVersion: version,
    reason: '调整数学复习',
    changes: [{ operation: 'update', taskId: id, plan }],
  });
  it('外部方案必须匹配版本、ID、日期、时长和严格结构', async () => {
    const t = await sampleTask(d);
    await expect(
      previewExternalPlan(
        { ...file(1, t.id, { date: today(), estimatedMinutes: 20 }), schemaVersion: 99 },
        d,
      ),
    ).rejects.toThrow();
    await expect(
      previewExternalPlan(file(0, t.id, { date: today(), estimatedMinutes: 20 }), d),
    ).rejects.toThrow('当前');
    await expect(
      previewExternalPlan(file(1, crypto.randomUUID(), { date: today(), estimatedMinutes: 20 }), d),
    ).rejects.toThrow('不存在');
    await expect(
      previewExternalPlan(file(1, t.id, { date: 'bad', estimatedMinutes: 20 }), d),
    ).rejects.toThrow();
    await expect(
      previewExternalPlan(
        { ...file(1, t.id, { date: today(), estimatedMinutes: 20 }), code: 'delete database' },
        d,
      ),
    ).rejects.toThrow();
  });
  it('预算超额、重复任务ID及未满足依赖拒绝；预览不写库', async () => {
    const t = await sampleTask(d);
    await expect(
      previewExternalPlan(file(1, t.id, { date: today(), estimatedMinutes: 1440 }), d),
    ).rejects.toThrow('预算');
    const f = file(1, t.id, { date: today(), estimatedMinutes: 20 });
    await expect(
      previewExternalPlan({ ...f, changes: [...f.changes, ...f.changes] }, d),
    ).rejects.toThrow('重复');
    await expect(
      previewExternalPlan(
        file(1, t.id, {
          date: today(),
          estimatedMinutes: 20,
          dependencyTaskIds: [crypto.randomUUID()],
        }),
        d,
      ),
    ).rejects.toThrow('依赖');
    const p = await previewExternalPlan(f, d);
    expect((await d.tasks.get(t.id))?.estimatedMinutes).toBe(30);
    await applyProposal(p, true, d);
    expect((await d.tasks.get(t.id))?.estimatedMinutes).toBe(20);
  });
  it('外部应用写入失败回滚，不影响原任务与历史', async () => {
    const t = await sampleTask(d);
    const p = await previewExternalPlan(file(1, t.id, { date: today(), estimatedMinutes: 20 }), d);
    const fail = () => {
      throw new Error('磁盘异常');
    };
    d.revisions.hook('creating', fail);
    await expect(applyProposal(p, true, d)).rejects.toThrow('磁盘');
    d.revisions.hook('creating').unsubscribe(fail);
    expect((await d.tasks.get(t.id))?.estimatedMinutes).toBe(30);
    expect(await d.revisions.count()).toBe(1);
  });
  it('报告默认不含私人笔记、错题文本、图片或未选未来计划', async () => {
    await sampleTask(d, { notes: 'PRIVATE_NOTE' });
    const data = await readCoreData(d);
    const r = learningReport(data, {
      days: 7,
      includeNotes: false,
      includeMistakeText: false,
      includeFuture: false,
      request: '数学优先',
    });
    const text = JSON.stringify(r);
    expect(text).not.toContain('PRIVATE_NOTE');
    expect(r.privacy.images).toBe(false);
    expect(r).not.toHaveProperty('future');
  });
  it('恢复预览后新数据出现时拒绝替换', async () => {
    const backup = await createBackup(d);
    const preview = await backupPreview(backup, d);
    await sampleTask(d);
    await expect(restoreBackup(backup, d, preview.currentSignature)).rejects.toThrow('预览后');
    expect(await d.tasks.count()).toBe(1);
  });
});
describe('可选云协议与AI网关', () => {
  it('云快照只允许匹配期望版本的上传，冲突不会写入', async () => {
    const d = await testDatabase();
    try {
      const b = await createBackup(d),
        write = vi.fn();
      const store: SnapshotStore = {
        read: async () => ({ revision: 3, payload: b, updatedAt: new Date().toISOString() }),
        write,
      };
      await expect(pushSnapshot(store, b, 2)).rejects.toBeInstanceOf(SyncConflict);
      expect(write).not.toHaveBeenCalled();
      expect(
        syncDecision(
          'new',
          { revision: 2, dataHash: 'old', queued: true },
          { revision: 3, payload: b, updatedAt: '' },
        ),
      ).toBe('conflict');
    } finally {
      await d.delete();
    }
  });
  it('未配置AI明确报错，不返回模拟文本', async () => {
    expect(integrationConfig({}).ai.configured).toBe(false);
    await expect(aiResponse({ kind: 'plan', context: {} }, {}, vi.fn())).rejects.toThrow(
      '尚未配置',
    );
  });
  it('AI仅服务端发送密钥，解析真实协议；上游错误不伪装成功', async () => {
    const env = {
      OPENAI_API_KEY: 'unit-test-only',
      OPENAI_MODEL: 'unit-test-model',
      STAR_STUDY_AI_TOKEN: 'unit-test-access',
    };
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        output: [{ content: [{ type: 'output_text', text: '按预算安排复习' }] }],
      }),
    });
    const r = await aiResponse({ kind: 'plan', context: { request: '复习' } }, env, fetcher);
    expect(r.text).toBe('按预算安排复习');
    expect(JSON.parse(fetcher.mock.calls[0][1].body).store).toBe(false);
    await expect(
      aiResponse(
        { kind: 'plan', context: {} },
        env,
        vi.fn().mockResolvedValue({ ok: false, status: 401 }),
      ),
    ).rejects.toThrow('401');
  });
});
