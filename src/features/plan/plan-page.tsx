'use client';
import { useViewState } from '@/lib/interaction';
import { plannedMinutes } from '@/services/analytics';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from '@/components/ui/app-link';
import {
  addDays,
  addMonths,
  addWeeks,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  parseISO,
  startOfMonth,
  startOfWeek,
} from 'date-fns';
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  Upload,
  MoveRight,
  Scissors,
  CalendarDays,
  Archive,
} from 'lucide-react';
import { useApp } from '@/components/provider';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { TaskCard } from '@/features/tasks/task-card';
import { TaskEditor } from '@/features/tasks/task-editor';
import { budgetFor, statusLabels, today, validDate } from '@/lib/utils';
import { shiftTasks, splitTask } from '@/services/tasks';
import type { StudyTask } from '@/types';
import { PlanHistory } from '@/features/planner/history';
import { CleanupDialog } from './cleanup-dialog';
import { db } from '@/db';
import { versionProposal } from '@/services/plans';
import { ProposalPreview } from '@/features/planner/proposal-preview';
import type { PlanProposal } from '@/scheduler/types';
type View = 'day' | 'week' | 'month' | 'list';
export function PlanPage() {
  const app = useApp();
  const router = useRouter();
  const database = db;
  const mounted = useRef(true);
  const { run } = app;
  const [cleanup, setCleanup] = useState(false);
  const [undoProposal, setUndoProposal] = useState<PlanProposal | null>(null);
  const [cleanupRevision, setCleanupRevision] = useState<string | null>(null);
  const undoCleanup = useCallback(
    async (revisionId: string) => {
      if (!mounted.current) {
        router.push(`/plan/?cleanupUndo=${encodeURIComponent(revisionId)}`);
        return;
      }
      await run(async () => {
        const proposal = await versionProposal(revisionId, 'undo', database);
        if (mounted.current) setUndoProposal(proposal);
        else router.push(`/plan/?cleanupUndo=${encodeURIComponent(revisionId)}`);
      });
    },
    [database, run, router],
  );
  useEffect(() => {
    mounted.current = true;
    const params = new URLSearchParams(location.search);
    if (params.get('cleanup') === '1') setCleanup(true);
    const revisionId = params.get('cleanupUndo');
    if (revisionId) void undoCleanup(revisionId);
    return () => {
      mounted.current = false;
    };
  }, [undoCleanup]);
  const [listPage, setListPage] = useState(0);
  const [dragTarget, setDragTarget] = useState<string | null>(null),
    [dragging, setDragging] = useState<string | null>(null);
  useEffect(() => setListPage(0), [app.tasks.length]);
  const [view, setView] = useViewState<View>('plan.view', 'month'),
    [date, setDate] = useViewState('plan.date', today()),
    [subject, setSubject] = useViewState('plan.subject', 'all'),
    [status, setStatus] = useViewState('plan.status', 'all'),
    [backlog, setBacklog] = useViewState('plan.backlog', false),
    [create, setCreate] = useState(false),
    [selected, setSelected] = useState<string[]>([]),
    [move, setMove] = useState<{ ids: string[]; date: string } | null>(null),
    [split, setSplit] = useState(false),
    [splitMinutes, setSplitMinutes] = useState(15),
    [busy, setBusy] = useState(false),
    [history, setHistory] = useState(false);
  useEffect(() => {
    if (new URLSearchParams(location.search).get('backlog')) {
      setBacklog(true);
      setView('list');
    }
  }, [setBacklog, setView]);
  useEffect(() => setListPage(0), [subject, status, backlog]);
  const tasks = useMemo(
    () =>
      app.tasks
        .filter(
          (t) =>
            !t.deletedAt &&
            (subject === 'all' || t.subjectId === subject) &&
            (status === 'all' || t.status === status) &&
            (!backlog || (t.date < today() && !['completed', 'skipped'].includes(t.status))),
        )
        .sort(
          (a, b) =>
            a.date.localeCompare(b.date) ||
            a.createdAt.localeCompare(b.createdAt) ||
            a.id.localeCompare(b.id),
        ),
    [app.tasks, subject, status, backlog],
  );
  const cursor = parseISO(date);
  const days =
    view === 'month'
      ? eachDayOfInterval({
          start: startOfWeek(startOfMonth(cursor), { weekStartsOn: 1 }),
          end: endOfWeek(endOfMonth(cursor), { weekStartsOn: 1 }),
        })
      : view === 'week'
        ? eachDayOfInterval({
            start: startOfWeek(cursor, { weekStartsOn: 1 }),
            end: endOfWeek(cursor, { weekStartsOn: 1 }),
          })
        : [cursor];
  const at = (d: string) => tasks.filter((t) => t.date === d),
    total = (d: string) =>
      app.tasks
        .filter((t) => t.date === d && !t.deletedAt)
        .reduce((n, t) => n + plannedMinutes(t), 0);
  const visible =
    view === 'list'
      ? tasks
      : tasks.filter((t) => days.some((d) => format(d, 'yyyy-MM-dd') === t.date));
  const listVisible = view === 'list' ? visible.slice(listPage * 50, (listPage + 1) * 50) : visible;
  const selectedTasks = selected
    .map((id) => app.tasks.find((t) => t.id === id))
    .filter((t): t is StudyTask => !!t && !t.deletedAt);
  const moveTasks =
    move?.ids.map((id) => app.tasks.find((t) => t.id === id)).filter((t): t is StudyTask => !!t) ??
    [];
  const changeDate = (direction: number) =>
    setDate(
      format(
        view === 'month'
          ? addMonths(cursor, direction)
          : view === 'week'
            ? addWeeks(cursor, direction)
            : addDays(cursor, direction),
        'yyyy-MM-dd',
      ),
    );
  const select = (id: string) =>
    setSelected((s) => (s.includes(id) ? s.filter((v) => v !== id) : [...s, id]));
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">一步一步，走向你的目标</p>
          <h1>学习计划</h1>
          <p>按真实时间安排任务，让未完成的计划有处可循。</p>
        </div>
        <div className="heading-buttons">
          <Button variant="secondary" onClick={() => setCleanup(true)}>
            <Archive size={16} />
            清空计划
          </Button>
          <Button asChild variant="secondary">
            <Link href="/planner/">动态排期</Link>
          </Button>
          <Button variant="secondary" asChild>
            <Link href="/settings/?tab=data">
              <Upload size={16} />
              导入 Excel
            </Link>
          </Button>
          <Button onClick={() => setCreate(true)}>
            <Plus size={16} />
            新建任务
          </Button>
        </div>
      </div>
      {cleanupRevision && (
        <div className="selection-toolbar" role="status">
          <span>本次清空已保存版本，历史学习记录仍保留。</span>
          <Button variant="ghost" size="sm" onClick={() => undoCleanup(cleanupRevision)}>
            撤销本次清空
          </Button>
        </div>
      )}
      <div className="plan-toolbar panel">
        <div className="calendar-controls">
          <Button variant="ghost" size="icon" aria-label="上一周期" onClick={() => changeDate(-1)}>
            <ChevronLeft size={18} />
          </Button>
          <strong>{format(cursor, view === 'month' ? 'yyyy年 M月' : 'yyyy年 M月d日')}</strong>
          <Button variant="ghost" size="icon" aria-label="下一周期" onClick={() => changeDate(1)}>
            <ChevronRight size={18} />
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setDate(today())}>
            今天
          </Button>
        </div>
        <div className="segmented">
          {(
            [
              ['day', '日'],
              ['week', '周'],
              ['month', '月'],
              ['list', '列表'],
            ] as const
          ).map(([v, label]) => (
            <button key={v} className={view === v ? 'selected' : ''} onClick={() => setView(v)}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="plan-filters">
        <label>
          科目
          <select
            value={subject}
            onChange={(e) => {
              setSubject(e.target.value);
              setSelected([]);
            }}
          >
            <option value="all">全部科目</option>
            {app.subjects.map((s) => (
              <option value={s.id} key={s.id}>
                {s.name}
                {!s.active ? '（历史）' : ''}
              </option>
            ))}
          </select>
        </label>
        <label>
          状态
          <select
            aria-label="计划状态筛选"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setSelected([]);
            }}
          >
            <option value="all">全部状态</option>
            {Object.entries(statusLabels).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label className="inline-check">
          <input
            type="checkbox"
            checked={backlog}
            onChange={(e) => {
              setBacklog(e.target.checked);
              setView('list');
            }}
          />
          仅看积压任务
        </label>
        <span className="spacer" />
        <Button size="sm" variant="ghost" onClick={() => setHistory(true)}>
          变更记录（{app.revisions.length}）
        </Button>
      </div>
      {view === 'month' ? (
        <section className="calendar panel calendar-motion" aria-label="月历" key={date}>
          <div className="calendar-weekdays">
            {['周一', '周二', '周三', '周四', '周五', '周六', '周日'].map((d) => (
              <span key={d}>{d}</span>
            ))}
          </div>
          <div className="calendar-grid">
            {days.map((d) => {
              const key = format(d, 'yyyy-MM-dd'),
                list = at(key),
                sum = total(key),
                budget = budgetFor(key, app.preferences);
              return (
                <div
                  key={key}
                  className={`calendar-cell ${key === today() ? 'calendar-today' : ''} ${d.getMonth() !== cursor.getMonth() ? 'muted-day' : ''} ${dragTarget === key ? 'drop-target' : ''}`}
                  onDragOver={(e) => {
                    e.preventDefault();
                    if (dragging || e.dataTransfer.types.includes('text/plain')) setDragTarget(key);
                  }}
                  onDragLeave={(e) => {
                    if (!e.currentTarget.contains(e.relatedTarget as Node | null))
                      setDragTarget(null);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragTarget(null);
                    setDragging(null);
                    const id = e.dataTransfer.getData('text/plain');
                    if (app.tasks.some((t) => t.id === id && t.status !== 'completed'))
                      setMove({ ids: [id], date: key });
                  }}
                >
                  <button
                    className="calendar-day"
                    aria-label={`查看 ${key} 任务`}
                    onClick={() => {
                      setDate(key);
                      setView('day');
                    }}
                  >
                    {format(d, 'd')}
                  </button>
                  {sum > 0 && (
                    <span
                      className={`day-total ${sum > budget ? 'over-budget' : ''}`}
                      title={`预算 ${budget} 分钟`}
                    >
                      {sum}分{sum > budget ? ' ⚠' : ''}
                    </span>
                  )}
                  <div className="calendar-task-list">
                    {list.slice(0, 3).map((t) => (
                      <button
                        draggable={t.status !== 'completed'}
                        onDragStart={(e) => {
                          e.dataTransfer.setData('text/plain', t.id);
                          setDragging(t.id);
                        }}
                        onDragEnd={() => {
                          setDragging(null);
                          setDragTarget(null);
                        }}
                        className={`calendar-task ${app.subjects.find((s) => s.id === t.subjectId)?.category} ${t.status === 'completed' ? 'done' : ''}`}
                        key={t.id}
                        onClick={() => {
                          setDate(key);
                          setView('day');
                        }}
                        title={`${t.title} · ${t.estimatedMinutes}分钟`}
                      >
                        {t.title}
                      </button>
                    ))}
                    {list.length > 3 && (
                      <button
                        className="calendar-more"
                        onClick={() => {
                          setDate(key);
                          setView('day');
                        }}
                      >
                        +{list.length - 3} 项
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <p className="calendar-help">
            点击日期查看任务；桌面端可拖动任务到新日期，预览确认后保存。每日分钟数按全部科目计算。
          </p>
        </section>
      ) : (
        <>
          <div className="selection-toolbar">
            <span>
              当前显示 {visible.length} 项任务 ·{' '}
              {visible.reduce((n, t) => n + plannedMinutes(t), 0)} 分钟
            </span>
            <Button
              size="sm"
              variant="secondary"
              disabled={!selected.length}
              onClick={() => setMove({ ids: selected, date })}
            >
              <MoveRight size={14} />
              调整日期（{selected.length}）
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={selected.length !== 1}
              onClick={() => setSplit(true)}
            >
              <Scissors size={14} />
              拆分任务
            </Button>
          </div>
          {(view === 'list'
            ? [...new Set(listVisible.map((t) => t.date))]
            : days.map((d) => format(d, 'yyyy-MM-dd'))
          ).map((key) => (
            <section className="day-section" key={key}>
              <div className="section-heading">
                <h2>
                  {key} {key === today() && <span>今天</span>}
                </h2>
                <span
                  className={total(key) > budgetFor(key, app.preferences) ? 'error-text' : 'hint'}
                >
                  计划 {total(key)} / 预算 {budgetFor(key, app.preferences)} 分钟
                  {total(key) > budgetFor(key, app.preferences) ? ' · 超出预算' : ''}
                </span>
              </div>
              {(view === 'list' ? listVisible.filter((t) => t.date === key) : at(key)).map((t) => (
                <div className="selectable-task" key={t.id}>
                  <input
                    type="checkbox"
                    aria-label={`选择 ${t.title}`}
                    checked={selected.includes(t.id)}
                    disabled={t.status === 'completed'}
                    onChange={() => select(t.id)}
                  />
                  <TaskCard task={t} />
                </div>
              ))}
              {!at(key).length && (
                <div className="day-empty">
                  这一天还没有任务{' '}
                  <button
                    onClick={() => {
                      setDate(key);
                      setCreate(true);
                    }}
                  >
                    添加任务
                  </button>
                </div>
              )}
            </section>
          ))}
          {view === 'list' && visible.length > 50 && (
            <div className="selection-toolbar">
              <span>
                共 {visible.length} 项 · 当前第 {listPage + 1}/
                {Math.max(1, Math.ceil(visible.length / 50))} 页，每页50项
              </span>
              <Button
                size="sm"
                variant="secondary"
                disabled={listPage === 0}
                onClick={() => setListPage((p) => p - 1)}
              >
                上一页任务
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={(listPage + 1) * 50 >= visible.length}
                onClick={() => setListPage((p) => p + 1)}
              >
                下一页任务
              </Button>
            </div>
          )}
          {view === 'list' && !visible.length && (
            <div className="empty-state panel">
              <CalendarDays size={32} />
              <h3>还没有符合条件的任务</h3>
              <p>调整筛选条件，或创建第一个学习任务。</p>
            </div>
          )}
        </>
      )}
      {create && <TaskEditor date={date} onClose={() => setCreate(false)} />}{' '}
      {move && (
        <Modal title="调整日期预览" onClose={() => !busy && setMove(null)}>
          <label>
            新的学习日期
            <input
              type="date"
              value={move.date}
              onChange={(e) => setMove({ ...move, date: e.target.value })}
            />
          </label>
          <div className="preview-changes">
            {moveTasks.map((t) => (
              <div key={t.id}>
                <strong>{t.title}</strong>
                <p>
                  {t.date} → {move.date} · {t.estimatedMinutes} 分钟
                  {t.status === 'completed' ? ' · 已完成，禁止调整' : ''}
                </p>
              </div>
            ))}
          </div>
          <p className="warning-box">
            手动调整将保留原时长与学习记录。
            {validDate(move.date) &&
              `目标日期将安排 ${total(move.date) + moveTasks.filter((t) => t.date !== move.date).reduce((n, t) => n + plannedMinutes(t), 0)} 分钟，预算 ${budgetFor(move.date, app.preferences)} 分钟。`}
            超出预算时请拆分或选择其他日期。
          </p>
          <div className="modal-actions">
            <Button variant="secondary" onClick={() => setMove(null)}>
              取消调整
            </Button>
            <Button
              disabled={
                busy || !validDate(move.date) || moveTasks.some((t) => t.status === 'completed')
              }
              onClick={async () => {
                setBusy(true);
                if (
                  await app.run(() => shiftTasks(move.ids, move.date), '日期已调整，原始版本已记录')
                ) {
                  setMove(null);
                  setSelected([]);
                }
                setBusy(false);
              }}
            >
              确认调整
            </Button>
          </div>
        </Modal>
      )}
      {split && (
        <Modal title="拆分任务预览" onClose={() => setSplit(false)}>
          <p>
            {selectedTasks[0]?.title} · 原预计 {selectedTasks[0]?.estimatedMinutes} 分钟
          </p>
          <label>
            第一部分时长（分钟）
            <input
              type="number"
              min="1"
              max={(selectedTasks[0]?.estimatedMinutes ?? 1) - 1}
              value={splitMinutes}
              onChange={(e) => setSplitMinutes(Number(e.target.value))}
            />
          </label>
          <p className="hint">
            原任务保留 {splitMinutes} 分钟，新建续任务{' '}
            {Math.max(0, (selectedTasks[0]?.estimatedMinutes ?? 0) - splitMinutes)}{' '}
            分钟，两部分日期相同，之后可以单独移动。已有计时的任务不会被拆分。
          </p>
          <div className="modal-actions">
            <Button variant="secondary" onClick={() => setSplit(false)}>
              取消
            </Button>
            <Button
              disabled={
                busy ||
                !selectedTasks[0] ||
                splitMinutes < 1 ||
                splitMinutes >= selectedTasks[0].estimatedMinutes
              }
              onClick={async () => {
                setBusy(true);
                if (await app.run(() => splitTask(selected[0], splitMinutes), '任务已拆分')) {
                  setSplit(false);
                  setSelected([]);
                }
                setBusy(false);
              }}
            >
              确认拆分
            </Button>
          </div>
        </Modal>
      )}
      {history && (
        <Modal title="计划变更记录" onClose={() => setHistory(false)} wide>
          <PlanHistory />
        </Modal>
      )}
      {cleanup && (
        <CleanupDialog
          initialSubjectId={subject === 'all' ? undefined : subject}
          onClose={() => setCleanup(false)}
          onApplied={(revision, count) => {
            setCleanup(false);
            setSelected([]);
            setCleanupRevision(revision.revisionId);
            app.notify(`已清空 ${count} 项未开始任务，学习记录已保留`, false, {
              label: '撤销清空',
              onClick: () => undoCleanup(revision.revisionId),
            });
          }}
        />
      )}
      {undoProposal && (
        <ProposalPreview
          proposal={undoProposal}
          onCancel={() => setUndoProposal(null)}
          onModify={() => setUndoProposal(null)}
          onApplied={() => setCleanupRevision(null)}
        />
      )}
    </>
  );
}
