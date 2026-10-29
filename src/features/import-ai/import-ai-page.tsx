'use client';
import { appUrl, appStorageKey } from '@/lib/app-path';
import { useState } from 'react';
import { useApp } from '@/components/provider';
import { usePlatform } from '@/features/platform/platform';
import { Button } from '@/components/ui/button';
import { ImportPanel } from '@/features/import/import-panel';
import {
  parsePlanText,
  previewStudyPlan,
  planPrompt,
  type PlanPreview,
} from '@/services/study-plan';
import {
  createBackup,
  restoreBackup,
  readCoreData,
  encodeData,
  type Backup,
} from '@/services/backup';
import { dataHash } from '@/lib/data-hash';
import { csvRows, markdownRows, tablePlan } from '@/services/plan-tables';
import { today, download, uuid } from '@/lib/utils';
import { studyPlanSchema, type ImportMode, type StudyPlan } from '@/schemas/study-plan';
import { accountOperation } from '@/services/account-lock';
import { backupPreview } from '@/services/backup';
import { db } from '@/db';
type View = Omit<PlanPreview, 'after'> & { previewId?: string; baseVersion?: number };
export function ImportAiPage() {
  const app = useApp(),
    p = usePlatform(),
    target = app.examTargets[0];
  const [step, setStep] = useState(1),
    [goal, setGoal] = useState({
      university: target.university,
      major: target.major,
      examDate: target.examDate,
      start: today(),
      end: today(),
      weekday: app.preferences.weekdayMinutes,
      weekend: app.preferences.weekendMinutes,
      subjects: app.subjects
        .filter((s) => s.active)
        .map((s) => s.name)
        .join('、'),
      foundation: String(
        app.settings.find((s) => s.key === 'foundation')?.value ?? '请按实际基础补充',
      ),
    }),
    [text, setText] = useState(''),
    [format, setFormat] = useState('json'),
    [mode, setMode] = useState<ImportMode>('merge'),
    [preview, setPreview] = useState<View | null>(null),
    [localAfter, setLocalAfter] = useState<Backup | null>(null),
    [baseline, setBaseline] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [planId, setPlanId] = useState(`plan-${today()}`);
  const example: StudyPlan = {
    schemaVersion: '1.0.0',
    planId,
    planName: '我的考研计划',
    generatedAt: new Date().toISOString(),
    startDate: goal.start,
    endDate: goal.end,
    timezone: 'Asia/Shanghai',
    examTarget: { university: goal.university, major: goal.major, examDate: goal.examDate },
    subjects: app.subjects
      .filter((s) => s.active)
      .map((s, i) => ({
        externalId: `s${i + 1}`,
        name: s.name,
        category: s.category,
        priority: s.priority,
      })),
    resources: [],
    knowledgePoints: [],
    tasks: [
      {
        externalId: `${goal.start}-1`,
        date: goal.start,
        subjectId: 's1',
        title: '基础巩固与练习（示例，请替换）',
        description: '',
        estimatedMinutes: 30,
        taskType: 'review',
        priority: 1,
        knowledgePointIds: [],
        resourceIds: [],
        exerciseDescription: '自行补充',
        notes: '',
      },
    ],
    metadata: { source: '外部AI', notes: '科目及课程待本人核实' },
  };
  const prompt = planPrompt(goal, example);
  const check = async () => {
    const database = db;
    setBusy(true);
    setError('');
    setPreview(null);
    try {
      if (app.sessions.some((s) => s.state !== 'ended'))
        throw new Error('请先结束计时，再校验和导入计划');
      const plan =
        format === 'json'
          ? parsePlanText(text)
          : tablePlan(format === 'csv' ? csvRows(text) : markdownRows(text), example);
      if (p.enabled) {
        await accountOperation(p.user!.id, async () => {
          // Flush the exact local snapshot with CAS before asking server for an authoritative preview.
          const key = appStorageKey(`star-sync:${p.user!.id}`),
            cursor = JSON.parse(localStorage.getItem(key) ?? 'null') as {
              version: number;
              hash: string;
            } | null;
          if (!cursor) throw new Error('账户尚未完成首次同步，请处理上方同步提示');
          const backup = await encodeData(await readCoreData(database), false),
            hash = await dataHash(backup);
          if (cursor.hash !== hash) {
            const saved = await p.request<{ version: number }>('/data', 'PUT', {
              baseVersion: cursor.version,
              backup,
            });
            localStorage.setItem(key, JSON.stringify({ version: saved.version, hash }));
          }
          setBaseline(hash);
          setPreview(await p.request<View>('/plans/preview', 'POST', { plan, mode }));
        });
      } else {
        const backup = await createBackup(database);
        const result = previewStudyPlan(plan, backup, mode, uuid);
        setBaseline(await dataHash(backup));
        setPreview(result);
        setLocalAfter(result.after);
      }
      setStep(4);
    } catch (e) {
      setError(e instanceof Error ? e.message : '校验失败');
    } finally {
      setBusy(false);
    }
  };
  const apply = async () => {
    const database = db;
    if (!preview || preview.errors.length) return;
    await app.run(async () => {
      if ((await dataHash(await createBackup(database))) !== baseline)
        throw new Error('预览后学习数据已变化，请重新校验');
      if (p.enabled) {
        await accountOperation(p.user!.id, async () => {
          if ((await dataHash(await createBackup(database))) !== baseline)
            throw new Error('预览后学习数据已变化，请重新校验');
          const guard = await backupPreview(await createBackup(database), database);
          await p.request('/plans/apply', 'POST', {
            previewId: preview.previewId,
            confirmed: true,
          });
          const remote = await p.request<{ backup: Backup; version: number }>('/data');
          try {
            await restoreBackup(remote.backup, database, guard.currentSignature);
          } catch {
            throw new Error(
              '计划已写入服务器；本机在确认期间发生新修改，已保留本机内容。请处理同步冲突后查看。',
            );
          }
          localStorage.setItem(
            appStorageKey(`star-sync:${p.user!.id}`),
            JSON.stringify({ version: remote.version, hash: await dataHash(remote.backup) }),
          );
        });
      } else {
        if (!localAfter) throw new Error('预览已失效');
        const stamp = new Date().toISOString();
        const existing = new Set(app.revisions.map((r) => r.id));
        for (const revision of localAfter.data.revisions)
          if (!existing.has(revision.id)) {
            revision.approvedAt = stamp;
            revision.updatedAt = stamp;
          }
        await restoreBackup(localAfter, database);
      }
      setPreview(null);
      setLocalAfter(null);
      setStep(5);
    }, '计划已导入，已完成任务和实际学习记录均已保留');
  };
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">把自己的目标，变成每天的一小步</p>
          <h1>AI计划导入</h1>
          <p>无需API也可使用。先校验、预览，由你确认后导入。</p>
        </div>
      </div>
      <ol className="wizard-steps" aria-label="导入步骤">
        {['填写目标', '生成提示词', '粘贴计划', '预览确认', '完成'].map((label, i) => (
          <li key={label} aria-current={step === i + 1 ? 'step' : undefined}>
            <span>{i + 1}</span>
            {label}
          </li>
        ))}
      </ol>
      {step === 1 && (
        <section className="panel settings-section">
          <h2>先告诉AI你的真实节奏</h2>
          <div className="form-grid">
            {(
              [
                ['university', '目标院校'],
                ['major', '目标专业'],
                ['examDate', '预计初试日期'],
                ['start', '本次计划开始'],
                ['end', '本次计划结束'],
                ['weekday', '平日分钟'],
                ['weekend', '周末分钟'],
              ] as const
            ).map(([key, label]) => (
              <label key={key}>
                {label}
                <input
                  type={
                    ['examDate', 'start', 'end'].includes(key)
                      ? 'date'
                      : ['weekday', 'weekend'].includes(key)
                        ? 'number'
                        : 'text'
                  }
                  min={0}
                  max={1440}
                  value={goal[key]}
                  onChange={(e) =>
                    setGoal({
                      ...goal,
                      [key]: ['weekday', 'weekend'].includes(key)
                        ? Number(e.target.value)
                        : e.target.value,
                    })
                  }
                />
              </label>
            ))}
          </div>
          <label>
            科目
            <input
              value={goal.subjects}
              onChange={(e) => setGoal({ ...goal, subjects: e.target.value })}
            />
          </label>
          <label>
            基础与当前进度
            <textarea
              value={goal.foundation}
              onChange={(e) => setGoal({ ...goal, foundation: e.target.value })}
            />
          </label>
          <label>
            计划代号（分月导入保持一致）
            <input value={planId} onChange={(e) => setPlanId(e.target.value)} />
          </label>
          <p className="hint">
            长计划建议逐月生成。相同计划代号与任务标识可安全重复导入；缺口会显示在预览中。
          </p>
          <Button onClick={() => setStep(2)}>生成提示词</Button>
        </section>
      )}
      {step === 2 && (
        <section className="panel settings-section">
          <h2>复制到 ChatGPT、DeepSeek 或其他工具</h2>
          <textarea aria-label="AI提示词" readOnly value={prompt} rows={12} />
          <div className="button-row">
            <Button
              onClick={() => app.run(() => navigator.clipboard.writeText(prompt), '提示词已复制')}
            >
              复制提示词
            </Button>
            <Button
              variant="secondary"
              onClick={() => download('星研-AI提示词.md', prompt, 'text/markdown')}
            >
              下载提示词
            </Button>
            <Button
              variant="ghost"
              onClick={() =>
                app.run(
                  () =>
                    navigator.clipboard.writeText(
                      JSON.stringify(studyPlanSchema.toJSONSchema(), null, 2),
                    ),
                  '格式说明已复制',
                )
              }
            >
              复制JSON格式说明
            </Button>
            <Button
              variant="ghost"
              onClick={() => download('星研-计划示例.json', JSON.stringify(example, null, 2))}
            >
              下载正确示例
            </Button>
          </div>
          <details>
            <summary>导入教程与隐私说明</summary>
            <p>
              1.每次生成一个月，要求仅返回完整JSON。2.复制结果或下载文件。3.回到星研粘贴并校验。4.检查重复、预算、依赖与计划缺口，再确认导入。招生信息、课程链接请自行核实。导出的提示词只包含上方填写的信息，不包含私人笔记和图片。
            </p>
          </details>
          <div className="button-row">
            <Button variant="ghost" onClick={() => setStep(1)}>
              修改目标
            </Button>
            <Button onClick={() => setStep(3)}>已取得计划，开始导入</Button>
          </div>
        </section>
      )}
      {step === 3 && (
        <>
          <section className="panel settings-section">
            <h2>粘贴或选择计划文件</h2>
            <label>
              内容格式
              <select value={format} onChange={(e) => setFormat(e.target.value)}>
                <option value="json">JSON / Markdown中的JSON代码块</option>
                <option value="csv">CSV表格</option>
                <option value="markdown">Markdown表格</option>
              </select>
            </label>
            <label>
              计划内容
              <textarea
                rows={12}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="在此粘贴AI生成的计划…"
              />
            </label>
            <label>
              选择计划文件
              <input
                type="file"
                accept=".json,.csv,.md,.txt"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  if (f.size > 12_000_000) {
                    setError('文件超过12 MB');
                    return;
                  }
                  setText(await f.text());
                  setFormat(
                    f.name.endsWith('.csv') ? 'csv' : f.name.endsWith('.md') ? 'markdown' : 'json',
                  );
                }}
              />
            </label>
            <label>
              导入方式
              <select value={mode} onChange={(e) => setMode(e.target.value as ImportMode)}>
                <option value="new">新建计划（保留已有任务）</option>
                <option value="merge">合并 / 后续月份</option>
                <option value="replace">替换范围内未完成且没有学习记录的任务</option>
              </select>
            </label>
            <p>
              自由文本不能保证正确识别。已配置账户AI时，可在AI服务页面转换为标准JSON后回到这里校验。
            </p>
            {error && (
              <p role="alert" className="warning">
                {error}
              </p>
            )}
            <div className="button-row">
              <Button variant="ghost" onClick={() => setStep(2)}>
                返回提示词
              </Button>
              <Button loading={busy} disabled={!text.trim()} onClick={check}>
                校验并预览
              </Button>
            </div>
          </section>
          <ImportPanel />
        </>
      )}
      {step === 4 && preview && (
        <section className="panel settings-section">
          <h2>{preview.plan.planName}</h2>
          <p>
            {preview.plan.startDate} — {preview.plan.endDate} · {preview.plan.tasks.length}项 ·{' '}
            {preview.totalMinutes}分钟
          </p>
          <p>
            将新增 {preview.added} 项 · 恢复 {preview.restored ?? 0} 项 · 重复跳过{' '}
            {preview.duplicates.length} 项 · 无任务日期 {preview.gaps.length} 天
          </p>
          <p>
            {preview.plan.subjects
              .map(
                (s) =>
                  `${s.name} ${preview.plan.tasks.filter((t) => t.subjectId === s.externalId).length}项`,
              )
              .join(' · ')}
          </p>
          {preview.errors.length > 0 && (
            <div className="warning" role="alert">
              <h3>请先修正以下问题</h3>
              <ul>
                {preview.errors.slice(0, 60).map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            </div>
          )}
          {preview.warnings.map((w, i) => (
            <p key={i} className="hint">
              {w}
            </p>
          ))}
          <details open>
            <summary>计划差异（{preview.changes.length}）</summary>
            <ul className="bounded-list">
              {preview.changes.map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ul>
          </details>
          {preview.gaps.length > 0 && (
            <details>
              <summary>检查计划缺口</summary>
              <p>{preview.gaps.join('、')}</p>
            </details>
          )}
          <div className="button-row">
            <Button disabled={!!preview.errors.length} onClick={apply}>
              确认导入
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setPreview(null);
                setStep(3);
              }}
            >
              修改方案
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setPreview(null);
                setLocalAfter(null);
                setStep(1);
              }}
            >
              取消导入
            </Button>
          </div>
        </section>
      )}
      {step === 5 && (
        <section className="empty-state">
          <h2>计划已准备好，开始今天的一小步</h2>
          <Button asChild>
            <a href={appUrl('/plan/')}>查看学习日历</a>
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              setStep(1);
              setText('');
            }}
          >
            继续导入下个月
          </Button>
        </section>
      )}
    </>
  );
}
