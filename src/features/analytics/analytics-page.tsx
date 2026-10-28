'use client';
import { useViewState } from '@/lib/interaction';
import { useEffect, useMemo, useState } from 'react';
import Link from '@/components/ui/app-link';
import { useReducedMotion } from '@/lib/interaction';
import { format, subDays, parseISO } from 'date-fns';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
} from 'recharts';
import { useApp } from '@/components/provider';
import { analyze, recentSummary } from '@/services/analytics';
import { today, download } from '@/lib/utils';
import { Button } from '@/components/ui/button';
const colors = ['#476f9e', '#d1aa66', '#9e82b4', '#68a28d', '#bc7988'];
export function AnalyticsPage() {
  const app = useApp();
  const reduced = useReducedMotion(),
    [touch, setTouch] = useState(false);
  useEffect(() => {
    const media = matchMedia('(pointer: coarse)');
    const update = () => setTouch(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  const [range, setRange] = useViewState('analytics.range', 30),
    [unit, setUnit] = useViewState('analytics.unit', 'day');
  const end = today(),
    from = format(subDays(parseISO(end), range - 1), 'yyyy-MM-dd');
  const summary = useMemo(() => analyze(app, from, end), [app, from, end]);
  const seven = useMemo(() => recentSummary(app, 7, end), [app, end]);
  const thirty = useMemo(() => recentSummary(app, 30, end), [app, end]);
  const chart = unit === 'week' ? summary.weeks : unit === 'month' ? summary.months : summary.days;
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">每一份实际投入，都有据可查</p>
          <h1>学习统计</h1>
          <p>按学习发生的日期计算；计时不会因任务改期重复统计。</p>
        </div>
        <Button
          variant="secondary"
          onClick={() => download(`星研-学习统计-${end}.json`, JSON.stringify(summary, null, 2))}
        >
          导出当前统计
        </Button>
      </div>
      <div className="management-filters">
        <label>
          统计范围
          <select
            aria-label="统计范围"
            value={range}
            onChange={(e) => setRange(Number(e.target.value))}
          >
            <option value={7}>最近7天</option>
            <option value={30}>最近30天</option>
            <option value={90}>最近90天</option>
            <option value={365}>最近365天</option>
          </select>
        </label>
        <label>
          聚合方式
          <select aria-label="统计聚合方式" value={unit} onChange={(e) => setUnit(e.target.value)}>
            <option value="day">每日</option>
            <option value="week">每周</option>
            <option value="month">每月</option>
          </select>
        </label>
      </div>
      <div className="stats-grid">
        {[
          ['实际学习', `${Math.floor(summary.actual)} 分钟`],
          ['计划时长', `${summary.planned} 分钟`],
          [
            '任务完成率',
            summary.completionRate === null
              ? '暂无任务'
              : `${Math.round(summary.completionRate * 100)}%`,
          ],
          ['连续学习', `${summary.streak} 天`],
        ].map(([l, v]) => (
          <section className="stat-card" key={l}>
            <small>{l}</small>
            <h2>{v}</h2>
          </section>
        ))}
      </div>
      {!summary.hasTimeData && (
        <p className="warning-box">
          尚无计时数据。图表只展示已有计划与自报完成状态，不推算学习成绩。
        </p>
      )}
      <div className="charts-grid">
        <ChartPanel title="计划与实际学习时长（分钟）">
          {summary.total || summary.actual > 0 ? (
            <ResponsiveContainer width="100%" height={270}>
              <BarChart data={chart}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip trigger={touch ? 'click' : 'hover'} />
                <Legend />
                <Bar
                  isAnimationActive={!reduced}
                  animationDuration={180}
                  dataKey="planned"
                  name="计划"
                  fill="#c7d4e5"
                />
                <Bar
                  isAnimationActive={!reduced}
                  animationDuration={180}
                  dataKey="actual"
                  name="实际"
                  fill="#476f9e"
                />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <ChartEmpty title="每一段专注，都会在这里留下轨迹" />
          )}
        </ChartPanel>
        <ChartPanel title="各科学习时间分布（分钟）">
          {summary.subjects.some((s) => s.actual > 0) ? (
            <ResponsiveContainer width="100%" height={270}>
              <PieChart>
                <Pie
                  isAnimationActive={!reduced}
                  animationDuration={180}
                  data={summary.subjects.filter((s) => s.actual > 0)}
                  dataKey="actual"
                  nameKey="name"
                  innerRadius={55}
                  outerRadius={90}
                >
                  {summary.subjects.map((s, i) => (
                    <Cell key={s.id} fill={colors[i % colors.length]} />
                  ))}
                </Pie>
                <Tooltip trigger={touch ? 'click' : 'hover'} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <ChartEmpty title="暂无实际学习时长" />
          )}
        </ChartPanel>
        <ChartPanel title="未完成任务积压趋势">
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={summary.days}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="label" tick={{ fontSize: 10 }} />
              <YAxis allowDecimals={false} />
              <Tooltip trigger={touch ? 'click' : 'hover'} />
              <Line
                isAnimationActive={!reduced}
                animationDuration={180}
                dataKey="backlog"
                name="积压任务"
                stroke="#b58a4e"
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
          <p className="hint">
            按首次计划日、已记录完成时间及删除时间重建。旧记录缺少完成时间：
            {summary.unknownCompletionDates} 项，不推测其历史完成时点。
          </p>
        </ChartPanel>
        <ChartPanel title="知识点掌握情况">
          {app.knowledgePoints.length > 0 ? (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={summary.mastery}>
                <XAxis dataKey="name" tick={{ fontSize: 9 }} />
                <YAxis allowDecimals={false} />
                <Tooltip trigger={touch ? 'click' : 'hover'} />
                <Bar
                  isAnimationActive={!reduced}
                  animationDuration={180}
                  dataKey="count"
                  name="知识点"
                  fill="#9b83b5"
                />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <ChartEmpty title="从一个知识点开始建立掌握记录" />
          )}
        </ChartPanel>
      </div>
      <section className="panel settings-section">
        <h2>各科任务进度</h2>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>科目</th>
                <th>计划 / 实际分钟</th>
                <th>已完成 / 任务数</th>
                <th>完成率</th>
              </tr>
            </thead>
            <tbody>
              {summary.subjects.map((s) => (
                <tr key={s.id}>
                  <td>
                    {s.name}
                    {!s.active ? '（历史）' : ''}
                  </td>
                  <td>
                    {s.planned} / {Math.floor(s.actual)}
                  </td>
                  <td>
                    {s.completed} / {s.total}
                  </td>
                  <td>{s.total ? `${Math.round((s.completed / s.total) * 100)}%` : '数据不足'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="hint">
          错题 {summary.mistakeCount} 道 · 到期 {summary.due.length} 道 · 范围内复习{' '}
          {summary.reviewCount} 次 · 薄弱知识点 {summary.weak.length} 个
        </p>
      </section>
      <div className="charts-grid">
        {[
          [7, seven],
          [30, thirty],
        ].map(([n, s]) => {
          const v = s as typeof summary;
          return (
            <section className="panel settings-section" key={String(n)}>
              <h2>最近{String(n)}天学习报告</h2>
              <p>
                计划 {v.planned} 分钟，实际 {Math.floor(v.actual)} 分钟。
              </p>
              <p className="hint">
                任务完成 {v.completed}/{v.total}，计划差异 {Math.round(v.actual - v.planned)}{' '}
                分钟，待处理任务 {v.pending.length} 项。
              </p>
              {!v.hasTimeData && <p className="hint">实际记录不足，暂不评估学习效率。</p>}
            </section>
          );
        })}
      </div>
    </>
  );
}
function ChartEmpty({ title }: { title: string }) {
  return (
    <div className="chart-empty">
      <strong>{title}</strong>
      <span>从一次真实学习开始。没有记录时，不推算成绩。</span>
      <Link className="button button-secondary button-sm" href="/">
        去今日学习
      </Link>
    </div>
  );
}
function ChartPanel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="panel chart-panel">
      <h2>{title}</h2>
      {children}
    </section>
  );
}
