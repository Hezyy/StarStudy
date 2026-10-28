'use client';
import Link from '@/components/ui/app-link';
import { useState } from 'react';
import { format, differenceInCalendarDays, parseISO } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import { Plus, ArrowUpRight, ArrowRight, BookOpen, Check, CalendarDays } from 'lucide-react';
import { useApp } from '@/components/provider';
import { Button } from '@/components/ui/button';
import { TaskEditor } from '@/features/tasks/task-editor';
import { TaskCard } from '@/features/tasks/task-card';
import { today, budgetFor } from '@/lib/utils';
import { useNow, useViewState } from '@/lib/interaction';
import { secondsOnDate, streak, weekData, plannedMinutes } from '@/services/statistics';
export function TodayPage() {
  const app = useApp(),
    now = useNow(true, 60000);
  const [create, setCreate] = useState(false),
    [filter, setFilter] = useViewState('today.subject', 'all');
  const date = today(),
    target = app.examTargets[0],
    tasks = app.tasks
      .filter((t) => t.date === date && !t.deletedAt)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  const backlog = app.tasks.filter(
    (t) => t.date < date && !t.deletedAt && !['completed', 'skipped'].includes(t.status),
  );
  const completed = tasks.filter((t) => t.status === 'completed').length,
    planned = tasks.reduce((n, t) => n + plannedMinutes(t), 0),
    budget = budgetFor(date, app.preferences),
    actual = secondsOnDate(app.sessions, date, now) / 60;
  const week = weekData(app.tasks, app.sessions, date),
    max = Math.max(60, ...week.flatMap((d) => [d.actual, d.planned])),
    percent = tasks.length ? Math.round((completed / tasks.length) * 100) : 0,
    allDone = tasks.length > 0 && completed === tasks.length;
  const groups = app.subjects
    .filter((s) => tasks.some((t) => t.subjectId === s.id) && (filter === 'all' || filter === s.id))
    .sort((a, b) =>
      a.category === 'math' ? -1 : b.category === 'math' ? 1 : a.priority - b.priority,
    );
  const due = app.mistakes.filter((m) => !m.archivedAt && m.reviewDate <= date);
  return (
    <>
      <div className="page-heading today-heading">
        <div>
          <p className="eyebrow">{format(parseISO(date), 'M月d日 · EEEE', { locale: zhCN })}</p>
          <h1>
            今日学习 <span className="heading-star" aria-hidden="true">✦</span>
          </h1>
          <p>{allDone ? '今天的计划已完成。给自己留一点休息。' : '把注意力留给眼前这一小步。'}</p>
        </div>
        <Button onClick={() => setCreate(true)}>
          <Plus size={16} />
          新建任务
        </Button>
      </div>
      <section className="today-overview" aria-label="今日进度">
        <div
          className="today-progress-ring"
          role="progressbar"
          aria-label="今日任务完成率"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
        >
          <svg viewBox="0 0 100 100" aria-hidden="true">
            <circle className="ring-track" cx="50" cy="50" r="44" />
            <circle
              className="ring-value"
              cx="50"
              cy="50"
              r="44"
              strokeDasharray={276.46}
              strokeDashoffset={276.46 * (1 - percent / 100)}
            />
          </svg>
          <span>
            {allDone ? (
              <Check size={30} />
            ) : (
              <>
                <strong>{percent}</strong>
                <small>%</small>
              </>
            )}
          </span>
        </div>
        <div className="today-progress-copy">
          <p className="eyebrow">{allDone ? '这一程，走得很好' : '今日目标'}</p>
          <h2>
            {tasks.length
              ? allDone
                ? '把今天的努力留在这里。'
                : `完成 ${tasks.length} 个小目标`
              : '从一个小目标开始'}
          </h2>
          <p aria-live="polite">
            {completed} / {tasks.length} 项任务已完成
          </p>
          <div className="today-facts">
            <span>
              计划 <strong>{planned}</strong> / {budget} 分钟
            </span>
            <span>
              实际 <strong>{Math.floor(actual)}</strong> 分钟
            </span>
            <span>
              连续 <strong>{streak(app.sessions, date)}</strong> 天
            </span>
          </div>
        </div>
        <Link className="today-destination" href="/settings/">
          <span>
            我的考研目标 <ArrowUpRight size={13} />
          </span>
          <strong>{target.university}</strong>
          <small>{target.major}</small>
          <p>
            <b>
              {Math.max(0, differenceInCalendarDays(parseISO(target.examDate), parseISO(date)))}
            </b>{' '}
            天后 · 预计初试
          </p>
          <small>{target.examDate} · 日期可修改</small>
        </Link>
      </section>
      {planned > budget && (
        <p role="alert" className="warning-box">
          今日计划超出时间预算 {planned - budget} 分钟。可以拆成更小的任务，或调整到合适的日期。
          <Link href="/plan/">
            调整计划 <ArrowRight size={13} />
          </Link>
        </p>
      )}
      <div className="today-workspace">
        <section className="today-task-area">
          <div className="section-heading">
            <h2>
              今天要做的 <span>{tasks.length}</span>
            </h2>
            <Link href="/plan/">
              全部计划 <ArrowRight size={14} />
            </Link>
          </div>
          <div className="filter-tabs" aria-label="按科目筛选">
            <button
              className={filter === 'all' ? 'selected' : ''}
              aria-pressed={filter === 'all'}
              onClick={() => setFilter('all')}
            >
              全部任务
            </button>
            {app.subjects
              .filter((s) => s.active)
              .map((s) => (
                <button
                  key={s.id}
                  className={filter === s.id ? 'selected' : ''}
                  aria-pressed={filter === s.id}
                  onClick={() => setFilter(s.id)}
                >
                  {s.name}
                </button>
              ))}
          </div>
          {groups.map((s) => (
            <section
              className={`subject-block ${s.category === 'math' ? 'subject-priority' : ''}`}
              key={s.id}
              aria-label={s.category === 'math' ? '优先数学任务' : `${s.name}任务`}
            >
              <div className="subject-section-title">
                <h3>{s.name}</h3>
                <span>
                  {s.category === 'math'
                    ? '先把基础走扎实'
                    : `${tasks.filter((t) => t.subjectId === s.id).length} 项任务`}
                </span>
              </div>
              <div className="task-list">
                {tasks
                  .filter((t) => t.subjectId === s.id)
                  .map((t) => (
                    <TaskCard task={t} key={t.id} compact />
                  ))}
              </div>
            </section>
          ))}
          {!groups.length && (
            <div className="empty-state">
              <div className="empty-icon">
                <BookOpen size={27} />
              </div>
              <h3>{tasks.length ? '这门科目今天暂无任务' : '今天的学习，从这里开始'}</h3>
              <p>
                一个章节、几道练习，都可以是今天的起点。
                <br />
                也可以从设置中导入已有计划。
              </p>
              <Button variant="secondary" onClick={() => setCreate(true)}>
                <Plus size={15} />
                创建学习任务
              </Button>
            </div>
          )}
          {backlog.length > 0 && (
            <section className="backlog">
              <div className="section-heading">
                <h2>
                  留待继续 <span>{backlog.length}</span>
                </h2>
                <Link href="/plan/?backlog=1">
                  安排下一步 <ArrowRight size={14} />
                </Link>
              </div>
              <p className="hint">没完成的内容还在。按今天的精力，慢慢接上。</p>
              {backlog.slice(0, 3).map((t) => (
                <TaskCard key={t.id} task={t} />
              ))}
            </section>
          )}
        </section>
        <aside className="today-support">
          <section className="week-panel">
            <div className="section-heading">
              <h2>这一周的脚步</h2>
              <CalendarDays size={16} />
            </div>
            <p className="week-total">
              <strong>{Math.floor(week.reduce((n, d) => n + d.actual, 0))}</strong>
              <span>分钟专注</span>
            </p>
            <div
              className="week-chart"
              role="img"
              aria-label={`本周累计学习 ${Math.floor(week.reduce((n, d) => n + d.actual, 0))} 分钟`}
            >
              {week.map((d, i) => (
                <div
                  className={`day-bar ${d.date === date ? 'is-today' : ''}`}
                  key={d.date}
                  title={`${d.date} 计划 ${d.planned} 分钟，实际 ${Math.floor(d.actual)} 分钟`}
                >
                  <div className="bar-track">
                    <span
                      className="planned-bar"
                      style={{ height: `${(d.planned / max) * 100}%` }}
                    />
                    <span className="actual-bar" style={{ height: `${(d.actual / max) * 100}%` }} />
                  </div>
                  <span>{['一', '二', '三', '四', '五', '六', '日'][i]}</span>
                </div>
              ))}
            </div>
            <div className="chart-legend">
              <span>
                <i />
                计划
              </span>
              <span>
                <i />
                实际
              </span>
            </div>
          </section>
          <section className="today-review-note">
            <p className="eyebrow">给记忆留一点回响</p>
            <h2>{due.length ? `${due.length} 道错题，到了再见面的时候` : '今天学会了什么？'}</h2>
            <p>
              {due.length
                ? '重新做一遍，再由自己判断掌握程度。不急着一次全部完成。'
                : '结束前写下一处收获、一点困惑，明天就有了继续的线索。'}
            </p>
            <Link href={due.length ? '/mistakes/?due=today' : '/reviews/'}>
              {due.length ? '开始复习' : '去写周复盘'} <ArrowRight size={14} />
            </Link>
          </section>
          <p className="today-storage-note">
            本地保存 · 离线可用
            <br />
            <Link href="/settings/?tab=data">
              记得定期备份 <ArrowUpRight size={12} />
            </Link>
          </p>
        </aside>
      </div>
      {create && <TaskEditor onClose={() => setCreate(false)} />}
    </>
  );
}
