'use client';
import { useViewState } from '@/lib/interaction';
import { useUnsavedChanges } from '@/lib/interaction';
import { useMemo, useState } from 'react';
import Link from '@/components/ui/app-link';
import { addDays, format, parseISO, startOfWeek } from 'date-fns';
import { useApp } from '@/components/provider';
import { Button } from '@/components/ui/button';
import { analyze, weekSuggestions } from '@/services/analytics';
import { saveWeeklyReview } from '@/services/reviews';
import { today, download, budgetFor } from '@/lib/utils';
import { masteryLabels } from '@/lib/mastery';
export function ReviewsPage() {
  const app = useApp();
  const [week, setWeek] = useViewState(
    'reviews.week',
    format(startOfWeek(parseISO(today()), { weekStartsOn: 1 }), 'yyyy-MM-dd'),
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">复盘不是追责，是找到下一步</p>
          <h1>每周复盘</h1>
          <p>基于真实记录汇总，建议需经排期预览确认后应用。</p>
        </div>
        <label>
          选择一周
          <input
            aria-label="复盘周日期"
            type="date"
            value={week}
            onChange={(e) => {
              if (
                e.target.value &&
                window.dispatchEvent(new Event('star-study:before-navigate', { cancelable: true }))
              )
                setWeek(
                  format(startOfWeek(parseISO(e.target.value), { weekStartsOn: 1 }), 'yyyy-MM-dd'),
                );
            }}
          />
        </label>
      </div>
      <ReviewForm
        key={week + app.weeklyReviews.find((r) => r.weekStart === week)?.updatedAt}
        week={week}
      />
      <section className="panel settings-section">
        <h2>历史复盘</h2>
        {[...app.weeklyReviews]
          .sort((a, b) => b.weekStart.localeCompare(a.weekStart))
          .map((r) => (
            <div className="history-entry" key={r.id}>
              <strong>{r.weekStart} 这一周</strong>
              <p className="hint">
                {r.difficulty || '未填写困难'} · 更新于{' '}
                {new Date(r.updatedAt).toLocaleString('zh-CN')}
              </p>
              <div className="record-actions">
                <Button size="sm" variant="secondary" onClick={() => setWeek(r.weekStart)}>
                  查看 / 编辑复盘
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    download(`星研-周复盘-${r.weekStart}.json`, JSON.stringify(r, null, 2))
                  }
                >
                  导出历史报告
                </Button>
              </div>
              <details>
                <summary className="hint">查看保存时的统计快照</summary>
                <pre className="snapshot-view">
                  {JSON.stringify(
                    r.summarySnapshot ?? { message: '此历史记录尚无统计快照' },
                    null,
                    2,
                  )}
                </pre>
              </details>
            </div>
          ))}
        {!app.weeklyReviews.length && <p className="hint">尚未保存周复盘。</p>}
      </section>
    </>
  );
}
function ReviewForm({ week }: { week: string }) {
  const [dirty, setDirty] = useState(false);
  useUnsavedChanges(dirty);
  const app = useApp(),
    end = format(addDays(parseISO(week), 6), 'yyyy-MM-dd'),
    next = format(addDays(parseISO(week), 7), 'yyyy-MM-dd');
  const existing = app.weeklyReviews.find((r) => r.weekStart === week);
  const [difficulty, setDifficulty] = useState(existing?.difficulty ?? ''),
    [unclear, setUnclear] = useState(existing?.unclear ?? ''),
    [school, setSchool] = useState(existing?.schoolExams ?? ''),
    [priority, setPriority] = useState(
      existing?.prioritySubjectId ?? app.subjects.find((s) => s.active)!.id,
    ),
    [minutes, setMinutes] = useState(
      existing?.nextWeekMinutes ??
        Array.from({ length: 7 }, (_, i) =>
          budgetFor(format(addDays(parseISO(next), i), 'yyyy-MM-dd'), app.preferences),
        ),
    ),
    [busy, setBusy] = useState(false);
  const summary = useMemo(() => analyze(app, week, end), [app, week, end]);
  const suggestions = weekSuggestions(summary, app.preferences, next, minutes, priority);
  const markdown = () =>
    `# 星研每周复盘\n\n${week} 至 ${end}\n\n计划 ${summary.planned} 分钟，实际 ${Math.floor(summary.actual)} 分钟。任务完成 ${summary.completed}/${summary.total}。\n\n## 本周困难\n${difficulty}\n\n## 未听懂\n${unclear}\n\n## 学校考试\n${school}\n\n## 下周预算\n${minutes.join(' / ')} 分钟\n\n## 下周建议\n${suggestions.map((s) => '- ' + s).join('\n')}`;
  return (
    <>
      <p className="eyebrow">客观记录 · 来自任务与计时</p>
      <div className="stats-grid">
        {[
          ['计划时长', `${summary.planned} 分钟`],
          ['实际时长', `${Math.floor(summary.actual)} 分钟`],
          ['已完成任务', `${summary.completed}/${summary.total}`],
          ['计划差异', `${Math.round(summary.actual - summary.planned)} 分钟`],
        ].map(([l, v]) => (
          <section className="stat-card" key={l}>
            <small>{l}</small>
            <h2>{v}</h2>
          </section>
        ))}
      </div>
      {!summary.hasTimeData && (
        <p className="warning-box">计时数据不足，仅展示已有任务与打卡，不推算学习成绩或掌握度。</p>
      )}
      <section className="panel settings-section">
        <h2>本周各科学习</h2>
        <p className="hint">
          首次安排基准 {summary.originalPlanned} 分钟；当前计划 {summary.planned}{' '}
          分钟。基准按任务首次记录与首次日期计算，拆分续任务不重复累加。
        </p>
        <div className="subject-review-list">
          {summary.subjects.map((s) => (
            <div className="subject-review-row" key={s.id}>
              <strong>{s.name}</strong>
              <div>
                <span>
                  实际 {Math.floor(s.actual)} / 计划 {s.planned} 分钟
                </span>
                <div className="subject-review-track">
                  <span
                    style={{
                      width: `${s.planned ? Math.min(100, (s.actual / s.planned) * 100) : 0}%`,
                    }}
                  />
                </div>
              </div>
              <span>{s.total ? `${s.completed}/${s.total} 已完成` : '数据不足'}</span>
            </div>
          ))}
        </div>
        <details>
          <summary>积压任务（{summary.pending.length} 项）</summary>
          {summary.pending.map((t) => (
            <p className="hint" key={t.id}>
              {t.title} · 首次计划 {t.originDate ?? t.date} · 积压 {t.ageDays} 天
            </p>
          ))}
        </details>
        <details>
          <summary>薄弱知识点与到期错题</summary>
          {summary.weak.map((k) => (
            <p className="hint" key={k.id}>
              {k.name} · {masteryLabels[k.mastery]}
            </p>
          ))}
          {summary.due.map((m) => (
            <p className="hint" key={m.id}>
              {m.question.slice(0, 60)} · 复习日期 {m.reviewDate}
            </p>
          ))}
        </details>
      </section>
      <form
        className="panel settings-section"
        onChange={() => setDirty(true)}
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy) return;
          setBusy(true);
          const saved = await app.run(
            () =>
              saveWeeklyReview({
                weekStart: week,
                difficulty,
                unclear,
                schoolExams: school,
                nextWeekMinutes: minutes,
                prioritySubjectId: priority,
              }),
            '周复盘已保存',
          );
          if (saved) setDirty(false);
          setBusy(false);
        }}
      >
        <p className="eyebrow">主观复盘 · 由你填写</p>
        <h2>我的复盘与下周安排</h2>
        <p className="reflection-caption">
          不用写得完整，先留下最值得记住的一点。{dirty ? ' 当前内容尚未保存。' : ''}
        </p>
        <div className="form-grid">
          <label>
            本周最大困难
            <textarea rows={3} value={difficulty} onChange={(e) => setDifficulty(e.target.value)} />
          </label>
          <label>
            哪些知识点没听懂
            <textarea rows={3} value={unclear} onChange={(e) => setUnclear(e.target.value)} />
          </label>
          <label>
            下周学校考试安排
            <textarea rows={2} value={school} onChange={(e) => setSchool(e.target.value)} />
          </label>
          <label>
            希望优先提高的科目
            <select
              aria-label="复盘优先科目"
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
            >
              {app.subjects
                .filter((s) => s.active)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
            </select>
          </label>
        </div>
        <h3>下周每天可用分钟</h3>
        <div className="week-budget-inputs">
          {minutes.map((n, i) => (
            <label key={i}>
              {['周一', '周二', '周三', '周四', '周五', '周六', '周日'][i]}
              <input
                aria-label={`下周${['一', '二', '三', '四', '五', '六', '日'][i]}分钟`}
                type="number"
                min={0}
                max={1440}
                required
                value={n}
                onChange={(e) =>
                  setMinutes(minutes.map((v, j) => (j === i ? Number(e.target.value) : v)))
                }
              />
            </label>
          ))}
        </div>
        <div className="record-actions">
          <Button loading={busy} disabled={busy}>
            保存周复盘
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => download(`星研-周复盘-${week}.md`, markdown(), 'text/markdown')}
          >
            导出 Markdown
          </Button>
        </div>
      </form>
      <section className="panel settings-section">
        <h2>下周学习建议</h2>
        <ul className="suggestions">
          {suggestions.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ul>
        <p className="hint">
          保存复盘不会修改任务或预算。前往动态排期，选择本周复盘导入预算后再预览确认。
        </p>
        <Button asChild>
          <Link href="/planner/">前往动态排期预览</Link>
        </Button>
      </section>
    </>
  );
}
