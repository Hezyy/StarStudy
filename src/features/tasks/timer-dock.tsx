'use client';
import { Pause, Play, Square, Timer, Check, Pencil, X } from 'lucide-react';
import { useState } from 'react';
import { useApp } from '@/components/provider';
import { Button } from '@/components/ui/button';
import { duration, sessionSeconds } from '@/lib/utils';
import { useNow } from '@/lib/interaction';
import { controlTimer } from '@/services/timer';
import { changeTaskStatus } from '@/services/task-interactions';
import { TaskEditor } from './task-editor';
import type { StudySession, StudyTask } from '@/types';
export function TimerDock() {
  const app = useApp(),
    active = app.sessions.find((s) => s.state !== 'ended');
  const [busy, setBusy] = useState(false),
    [summary, setSummary] = useState<{ task: StudyTask; seconds: number } | null>(null),
    [editing, setEditing] = useState<StudyTask | null>(null);
  const control = async (action: 'pause' | 'resume' | 'stop') => {
    if (!active || busy) return;
    setBusy(true);
    const task = app.tasks.find((t) => t.id === active.taskId),
      seconds = sessionSeconds(active, Date.now());
    const ok = await app.run(() => controlTimer(active.id, action));
    if (ok && action === 'stop' && task) {
      setSummary({ task, seconds });
      app.notify('本次专注已保存');
    }
    setBusy(false);
  };
  return (
    <>
      {active && (
        <section
          className={`timer-dock ${active.state === 'paused' ? 'timer-paused' : ''}`}
          aria-label="学习计时器"
        >
          <div className="timer-symbol">
            <Timer size={21} />
          </div>
          <div className="timer-task">
            <small>
              <span className="focus-dot" />
              {active.state === 'running' ? '专注进行中' : '计时已暂停'}
            </small>
            <strong>{app.tasks.find((t) => t.id === active.taskId)?.title}</strong>
          </div>
          <TimerValue session={active} />
          <Button
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={() => control(active.state === 'running' ? 'pause' : 'resume')}
          >
            {active.state === 'running' ? <Pause size={14} /> : <Play size={14} />}
            <span>{active.state === 'running' ? '暂停计时' : '恢复计时'}</span>
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => control('stop')}>
            <Square size={13} />
            结束计时
          </Button>
        </section>
      )}
      {!active && summary && (
        <section className="session-summary" aria-label="本次学习总结">
          <span className="summary-check">
            <Check size={18} />
          </span>
          <div>
            <strong>专注已记录 · {duration(summary.seconds)}</strong>
            <p>{summary.task.title}</p>
          </div>
          <div className="summary-actions">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setEditing(summary.task);
                setSummary(null);
              }}
            >
              <Pencil size={13} />
              记下收获
            </Button>
            <Button
              size="sm"
              onClick={async () => {
                const ok = await app.run(
                  () => changeTaskStatus(summary.task.id, 'completed'),
                  '任务已完成',
                );
                if (ok) setSummary(null);
              }}
            >
              标记完成
            </Button>
          </div>
          <button
            className="icon-action"
            aria-label="关闭学习总结"
            onClick={() => setSummary(null)}
          >
            <X size={16} />
          </button>
        </section>
      )}
      {editing && <TaskEditor task={editing} onClose={() => setEditing(null)} />}
    </>
  );
}
function TimerValue({ session }: { session: StudySession }) {
  const now = useNow(session.state === 'running');
  return (
    <output data-testid="timer-value" aria-label="已专注时长">
      {duration(sessionSeconds(session, now))}
    </output>
  );
}
