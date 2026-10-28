'use client';
import { useState } from 'react';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { useApp } from '@/components/provider';
import { saveTask, deleteTask } from '@/services/tasks';
import { taskSchema, type TaskInput } from '@/schemas';
import { statusLabels, today, budgetFor } from '@/lib/utils';
import { useUnsavedChanges } from '@/lib/interaction';
import { plannedMinutes } from '@/services/statistics';
import type { StudyTask } from '@/types';
import { KnowledgePicker } from '@/components/learning-fields';
export function TaskEditor({
  task,
  date,
  onClose,
}: {
  task?: StudyTask;
  date?: string;
  onClose: () => void;
}) {
  const app = useApp();
  const [form, setForm] = useState<TaskInput>(
    task ?? {
      date: date ?? today(),
      subjectId:
        app.subjects.find((s) => s.category === 'math' && s.active)?.id ?? app.subjects[0].id,
      title: '',
      chapter: '',
      courseName: '',
      courseUrl: '',
      exercises: '',
      estimatedMinutes: 30,
      status: 'todo',
      notes: '',
      knowledgePointIds: [],
      priority: 3,
    },
  );
  const [error, setError] = useState(''),
    [errorField, setErrorField] = useState(''),
    [busy, setBusy] = useState(false),
    [dirty, setDirty] = useState(false);
  const set = <K extends keyof TaskInput>(k: K, v: TaskInput[K]) => {
    setDirty(true);
    setForm((f) => ({ ...f, [k]: v }));
  };
  const close = () => {
    if (busy) return;
    if (!dirty || confirm('尚未保存的内容会丢失，确认关闭？')) onClose();
  };
  const locked = task?.status === 'completed';
  useUnsavedChanges(dirty);
  const projected =
    app.tasks
      .filter((t) => !t.deletedAt && t.date === form.date && t.id !== task?.id)
      .reduce((n, t) => n + plannedMinutes(t), 0) + form.estimatedMinutes;
  const budget = budgetFor(form.date, app.preferences);
  return (
    <Modal title={task ? '编辑学习任务' : '创建学习任务'} onClose={onClose} busy={busy}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy) return;
          const parsed = taskSchema.safeParse(form);
          if (!parsed.success) {
            setError(parsed.error.issues[0].message);
            setErrorField(String(parsed.error.issues[0].path[0] ?? ''));
            const target = e.currentTarget.elements.namedItem(
              String(parsed.error.issues[0].path[0] ?? ''),
            );
            if (target instanceof HTMLElement) target.focus();
            return;
          }
          setBusy(true);
          if (await app.run(() => saveTask(parsed.data, task?.id), '任务已保存')) onClose();
          setBusy(false);
        }}
      >
        <div className="form-grid">
          <label className="span-2">
            任务名称
            <input
              autoFocus
              name="title"
              aria-invalid={errorField === 'title' || undefined}
              aria-describedby={errorField === 'title' ? 'task-title-error' : undefined}
              required
              maxLength={300}
              value={form.title}
              onChange={(e) => set('title', e.target.value)}
              placeholder="例如：复习函数与极限的基本概念"
            />
            {errorField === 'title' && (
              <small id="task-title-error" className="field-error">
                {error}
              </small>
            )}
          </label>
          <label>
            科目
            <select
              value={form.subjectId}
              disabled={locked}
              aria-label="任务科目"
              onChange={(e) => {
                set('subjectId', e.target.value);
                set('knowledgePointIds', []);
              }}
            >
              {app.subjects
                .filter((s) => s.active || s.id === form.subjectId)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                    {!s.active ? '（历史科目）' : ''}
                  </option>
                ))}
            </select>
          </label>
          <label>
            学习日期
            <input
              type="date"
              required
              value={form.date}
              disabled={locked}
              onChange={(e) => set('date', e.target.value)}
            />
          </label>
          <label>
            预计时长（分钟）
            <input
              type="number"
              name="estimatedMinutes"
              aria-invalid={errorField === 'estimatedMinutes' || undefined}
              min="1"
              max="1440"
              required
              disabled={locked}
              value={form.estimatedMinutes}
              onChange={(e) => set('estimatedMinutes', Number(e.target.value))}
            />
          </label>
          <label>
            完成状态
            <select
              value={form.status}
              onChange={(e) => set('status', e.target.value as TaskInput['status'])}
            >
              {Object.entries(statusLabels).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <details className="editor-extras span-2" open={!!task}>
            <summary>
              课程、练习与更多选项 <span>按需要补充</span>
            </summary>
            <div className="form-grid">
              <label className="span-2">
                章节 / 知识点
                <input
                  value={form.chapter}
                  onChange={(e) => set('chapter', e.target.value)}
                  placeholder="填写章节，逐步完善你的计划"
                />
              </label>
              <label>
                网课名称
                <input
                  value={form.courseName}
                  onChange={(e) => set('courseName', e.target.value)}
                  placeholder="选填 · 未填写时显示待补充"
                />
              </label>
              <label>
                网课链接
                <input
                  type="url"
                  name="courseUrl"
                  aria-invalid={errorField === 'courseUrl' || undefined}
                  aria-describedby={errorField === 'courseUrl' ? 'task-url-error' : undefined}
                  value={form.courseUrl}
                  onChange={(e) => set('courseUrl', e.target.value)}
                  placeholder="https://…"
                />
                {errorField === 'courseUrl' && (
                  <small id="task-url-error" className="field-error">
                    {error}
                  </small>
                )}
              </label>
              <label className="span-2">
                学习说明
                <textarea
                  name="description"
                  rows={3}
                  maxLength={20000}
                  value={form.description ?? ''}
                  onChange={(e) => set('description', e.target.value)}
                  placeholder="选填 · 保留课程安排或AI计划中的完整说明"
                />
              </label>
              <label className="span-2">
                需要完成的练习
                <textarea
                  rows={2}
                  value={form.exercises}
                  onChange={(e) => set('exercises', e.target.value)}
                  placeholder="填写经过核实的教材与题目位置"
                />
              </label>
              <label>
                任务重要程度（1最高）
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={form.priority}
                  onChange={(e) => set('priority', Number(e.target.value))}
                />
              </label>
              <label>
                任务截止日期（可选）
                <input
                  type="date"
                  value={form.dueDate ?? ''}
                  onChange={(e) => set('dueDate', e.target.value || undefined)}
                />
              </label>
              <KnowledgePicker
                subjectId={form.subjectId}
                value={form.knowledgePointIds}
                onChange={(ids) => set('knowledgePointIds', ids)}
              />
              <label>
                前置学习任务
                <select
                  aria-label="前置学习任务"
                  multiple
                  size={3}
                  value={form.dependencyTaskIds ?? []}
                  onChange={(e) =>
                    set(
                      'dependencyTaskIds',
                      Array.from(e.target.selectedOptions, (o) => o.value),
                    )
                  }
                >
                  {app.tasks
                    .filter((t) => t.id !== task?.id && !t.deletedAt)
                    .map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.date} {t.title}
                      </option>
                    ))}
                </select>
              </label>
            </div>
          </details>
          <label className="span-2">
            学习笔记
            <textarea
              rows={3}
              value={form.notes}
              onChange={(e) => set('notes', e.target.value)}
              placeholder="记录收获、困难，或下次继续的位置"
            />
          </label>
        </div>
        <p className={projected > budget ? 'warning-box' : 'editor-budget'} aria-live="polite">
          {form.date} · 保存后计划 {projected} / 可用 {budget} 分钟
          {projected > budget ? ` · 超出预算 ${projected - budget} 分钟` : ''}
        </p>
        {dirty && <p className="draft-hint">尚未保存 · 关闭前会提醒你</p>}
        {locked && <p className="hint">已完成任务的计划日期、科目和时长已锁定。</p>}
        {error && (
          <p role="alert" className="error-text">
            {error}
          </p>
        )}
        <div className="modal-actions">
          {task && task.status !== 'completed' && (
            <Button
              type="button"
              variant="danger"
              disabled={busy}
              onClick={async () => {
                if (confirm(`确认删除「${task.title}」？已有学习记录将保留。`)) {
                  setBusy(true);
                  if (await app.run(() => deleteTask(task.id), '任务已删除，历史记录已保留'))
                    onClose();
                  setBusy(false);
                }
              }}
            >
              删除任务
            </Button>
          )}
          <span className="spacer" />
          <Button variant="secondary" type="button" disabled={busy} onClick={close}>
            取消
          </Button>
          <Button loading={busy} disabled={busy} type="submit">
            {busy ? '保存中…' : '保存任务'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
