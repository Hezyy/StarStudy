'use client';
import { useEffect, useRef, useState } from 'react';
import {
  Play,
  Check,
  Pencil,
  ExternalLink,
  Clock3,
  BookOpen,
  FilePenLine,
  ChevronDown,
} from 'lucide-react';
import { useApp } from '@/components/provider';
import { Button } from '@/components/ui/button';
import { useNow } from '@/lib/interaction';
import { startTimer } from '@/services/timer';
import { changeTaskStatus } from '@/services/task-interactions';
import { saveTask } from '@/services/tasks';
import { db } from '@/db';
import { statusLabels, taskSeconds } from '@/lib/utils';
import type { StudyTask, StudySession } from '@/types';
import { TaskEditor } from './task-editor';
import { TaskResources } from './task-resources';
import { videoLink } from '@/lib/video-link';
export function TaskCard({ task, compact = false }: { task: StudyTask; compact?: boolean }) {
  const app = useApp();
  const database = db;
  const [editing, setEditing] = useState(false),
    [expanded, setExpanded] = useState(false),
    [busy, setBusy] = useState(false),
    [optimistic, setOptimistic] = useState<StudyTask['status'] | null>(null),
    [notesOpen, setNotesOpen] = useState(false),
    [notes, setNotes] = useState(task.notes);
  const lock = useRef(false);
  const subject = app.subjects.find((s) => s.id === task.subjectId),
    active = app.sessions.find((s) => s.state !== 'ended'),
    status = optimistic ?? task.status;
  useEffect(() => {
    setOptimistic(null);
  }, [task.status]);
  const change = async (next: StudyTask['status']) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    const previous = task.status;
    let saved: StudyTask | undefined;
    const ok = await app.run(async () => {
      if (
        active?.taskId === task.id &&
        (await db.sessions
          .where('taskId')
          .equals(task.id)
          .filter((s) => s.state !== 'ended')
          .count())
      )
        throw new Error('请先结束计时，再修改完成状态');
      setOptimistic(next);
      saved = await changeTaskStatus(task.id, next);
    });
    if (ok && saved) {
      const committed = saved;
      app.notify(next === 'completed' ? '又完成了一小步' : '任务状态已更新', false, {
        label: '撤销',
        onClick: async () => {
          await changeTaskStatus(task.id, previous, committed);
          app.notify('已撤销本次状态更改');
        },
      });
    } else setOptimistic(null);
    setBusy(false);
    lock.current = false;
  };
  return (
    <article
      className={`task-card ${subject?.category ?? 'math'} ${status === 'completed' ? 'task-complete' : ''} ${active?.taskId === task.id ? 'task-active' : ''}`}
      data-testid="task-card"
      aria-busy={busy || undefined}
    >
      <button
        className={`task-checkbox ${status === 'completed' ? 'checked' : ''}`}
        aria-pressed={status === 'completed'}
        aria-label={status === 'completed' ? `将 ${task.title} 设为未完成` : `完成 ${task.title}`}
        disabled={busy}
        onClick={() => change(status === 'completed' ? 'todo' : 'completed')}
      >
        <Check size={15} className="check-tick" />
      </button>
      <div className="task-main">
        <div className="task-meta">
          <span className={`subject-pill ${subject?.category}`}>{subject?.name ?? '历史科目'}</span>
          <span className={`status-label status-${status}`}>{statusLabels[status]}</span>
          {task.unscheduled && <span className="tag">未排期 · 内容保留</span>}
          {!compact && <span className="task-date">{task.date}</span>}
        </div>
        <h3>{task.title}</h3>
        {(task.chapter || task.courseName || !compact) && (
          <p className="task-subline">
            <BookOpen size={13} />
            {task.chapter || '章节待补充'}
            {task.courseName && (
              <>
                <span>·</span>
                {task.courseName}
              </>
            )}
          </p>
        )}
        {task.exercises && <p className="exercise-line">练习：{task.exercises}</p>}
        <div className="task-bottom">
          <span>
            <Clock3 size={14} />
            预计 {task.estimatedMinutes} 分钟
            <span className="actual-time">
              {' '}
              / 实际{' '}
              <TaskMinutes
                taskId={task.id}
                sessions={app.sessions}
                running={active?.taskId === task.id && active.state === 'running'}
              />{' '}
              分钟
            </span>
          </span>
          <div className="task-actions">
            {task.courseUrl && (
              <a
                className="task-resource-link"
                href={task.courseUrl}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`学习资料 ${task.title}`}
              >
                <ExternalLink size={14} />
                <span>{videoLink(task.courseUrl).kind === 'search' ? '搜索对应视频' : '资料'}</span>
              </a>
            )}
            {status !== 'completed' && (
              <Button
                size="sm"
                variant="secondary"
                disabled={!!active || busy}
                onClick={async () => {
                  await app.run(() => startTimer(task.id), '计时已开始，切换页面仍会继续');
                }}
              >
                <Play size={12} />
                {active?.taskId === task.id ? '计时已开启' : '开始学习'}
              </Button>
            )}
            <button
              className="icon-action"
              aria-label={`编辑 ${task.title}`}
              title="编辑任务和笔记"
              onClick={() => setEditing(true)}
            >
              <Pencil size={16} />
            </button>
            <button
              className="icon-action"
              aria-label={`查看 ${task.title} 详情`}
              aria-expanded={expanded}
              onClick={() => setExpanded(!expanded)}
            >
              <ChevronDown size={16} className={expanded ? 'rotate-open' : ''} />
            </button>
          </div>
        </div>
        {task.plannedMinutes !== undefined && task.plannedMinutes !== task.estimatedMinutes && (
          <p className="hint">
            当日分配 {task.plannedMinutes} 分钟，预计总量包含此前已记录的学习时间。
          </p>
        )}
        <TaskResources taskId={task.id} />
        <div className={`task-reveal ${expanded ? 'is-expanded' : ''}`} inert={!expanded}>
          <div>
            <div className="task-details">
              {task.description && <p className="pre-wrap">学习说明：{task.description}</p>}
              <label>
                完成状态
                <select
                  aria-label={`${task.title} 完成状态`}
                  value={status}
                  disabled={busy}
                  onChange={(e) => change(e.target.value as StudyTask['status'])}
                >
                  {Object.entries(statusLabels).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <p>
                网课：{task.courseName || '待补充'}{' '}
                {task.courseUrl ? (
                  <a href={task.courseUrl} target="_blank" rel="noopener noreferrer">
                    {videoLink(task.courseUrl).label} <ExternalLink size={13} />
                  </a>
                ) : (
                  <span className="hint">链接待核实 / 待补充</span>
                )}
              </p>
              <p className="pre-wrap">笔记：{task.notes || '还没有学习笔记'}</p>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setNotes(task.notes);
                  setNotesOpen(!notesOpen);
                }}
              >
                <FilePenLine size={14} />
                添加或编辑笔记
              </Button>
              {notesOpen && (
                <form
                  className="inline-notes"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    if (busy) return;
                    setBusy(true);
                    const ok = await app.run(
                      () =>
                        database.transaction(
                          'rw',
                          [
                            database.tasks,
                            database.sessions,
                            database.subjects,
                            database.revisions,
                            database.knowledgePoints,
                          ],
                          async () => {
                            const latest = await database.tasks.get(task.id);
                            if (!latest) throw new Error('任务不存在');
                            await saveTask({ ...latest, notes }, task.id, database);
                          },
                        ),
                      '笔记已保存',
                    );
                    if (ok) setNotesOpen(false);
                    setBusy(false);
                  }}
                >
                  <label>
                    快速学习笔记
                    <textarea
                      autoFocus
                      rows={3}
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                    />
                  </label>
                  <div className="record-actions">
                    <Button size="sm" type="submit" disabled={busy} loading={busy}>
                      保存笔记
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      type="button"
                      onClick={() => setNotesOpen(false)}
                    >
                      取消编辑
                    </Button>
                  </div>
                </form>
              )}
            </div>
          </div>
        </div>
      </div>
      {editing && <TaskEditor task={task} onClose={() => setEditing(false)} />}
    </article>
  );
}
function TaskMinutes({
  taskId,
  sessions,
  running,
}: {
  taskId: string;
  sessions: StudySession[];
  running: boolean;
}) {
  const now = useNow(running, 60000);
  return <>{Math.floor(taskSeconds(taskId, sessions, running ? now : Date.now()) / 60)}</>;
}
