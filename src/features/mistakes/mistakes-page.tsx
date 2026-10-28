'use client';
import { useViewState } from '@/lib/interaction';
import { useEffect, useState } from 'react';
import { useUnsavedChanges } from '@/lib/interaction';
import Link from '@/components/ui/app-link';
import { addDays, format, parseISO } from 'date-fns';
import { useApp } from '@/components/provider';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { KnowledgePicker, BlobImages } from '@/components/learning-fields';
import { masteryLabels, masteryValues, reviewInterval } from '@/lib/mastery';
import { today } from '@/lib/utils';
import { saveMistake, archiveMistake, reviewMistake, mistakeToTask } from '@/services/learning';
import type { Mistake, Mastery } from '@/types';
export function MistakesPage() {
  const app = useApp();
  const [edit, setEdit] = useState<Mistake | 'new' | null>(null),
    [view, setView] = useState<string | null>(null),
    [review, setReview] = useState<string | null>(null),
    [task, setTask] = useState<string | null>(null),
    [subject, setSubject] = useViewState('mistakes.subject', 'all'),
    [chapter, setChapter] = useViewState('mistakes.chapter', ''),
    [query, setQuery] = useViewState('mistakes.query', ''),
    [mastery, setMastery] = useViewState('mistakes.mastery', 'all'),
    [due, setDue] = useViewState('mistakes.due', 'all'),
    [taskDate, setTaskDate] = useState(today()),
    [minutes, setMinutes] = useState(20),
    [busy, setBusy] = useState(false);
  const list = app.mistakes
    .filter(
      (m) =>
        (due === 'archived' ? !!m.archivedAt : !m.archivedAt) &&
        (subject === 'all' || m.subjectId === subject) &&
        (mastery === 'all' || m.mastery === mastery) &&
        (!chapter || m.chapter === chapter) &&
        `${m.question} ${m.reason} ${m.chapter}`.toLowerCase().includes(query.toLowerCase()) &&
        (due !== 'today' || m.reviewDate <= today()),
    )
    .sort((a, b) => a.reviewDate.localeCompare(b.reviewDate));
  const current = app.mistakes.find((m) => m.id === view);
  const count = app.mistakes.filter((m) => !m.archivedAt && m.reviewDate <= today()).length;
  useEffect(() => {
    if (new URLSearchParams(location.search).get('due') === 'today') setDue('today');
  }, [setDue]);
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">让错误成为下一次的线索</p>
          <h1>错题本</h1>
          <p>今日到期 {count} 道 · 复习结果由你主动评估。</p>
        </div>
        <Button onClick={() => setEdit('new')}>新建错题</Button>
      </div>
      {count > 0 && (
        <section className="review-start">
          <div>
            <h2>今天，重新理解 {count} 道错题</h2>
            <p>每次只看一道。保存评估后，可以直接继续下一道。</p>
          </div>
          <Button
            onClick={() =>
              setReview(
                app.mistakes
                  .filter((m) => !m.archivedAt && m.reviewDate <= today())
                  .sort((a, b) => a.reviewDate.localeCompare(b.reviewDate))[0].id,
              )
            }
          >
            开始今日复习
          </Button>
        </section>
      )}
      <div className="management-filters">
        <label>
          搜索错题
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="题目、原因或章节"
          />
        </label>
        <label>
          科目
          <select
            aria-label="错题科目筛选"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
          >
            <option value="all">全部科目</option>
            {app.subjects.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          章节
          <select
            aria-label="错题章节筛选"
            value={chapter}
            onChange={(e) => setChapter(e.target.value)}
          >
            <option value="">全部章节</option>
            {[...new Set(app.mistakes.map((m) => m.chapter).filter(Boolean))].map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label>
          掌握程度
          <select
            aria-label="错题掌握筛选"
            value={mastery}
            onChange={(e) => setMastery(e.target.value)}
          >
            <option value="all">全部掌握度</option>
            {masteryValues.map((v) => (
              <option key={v} value={v}>
                {masteryLabels[v]}
              </option>
            ))}
          </select>
        </label>
        <label>
          复习范围
          <select aria-label="复习日期筛选" value={due} onChange={(e) => setDue(e.target.value)}>
            <option value="all">全部未归档</option>
            <option value="today">今日待复习（含逾期）</option>
            <option value="archived">已归档</option>
          </select>
        </label>
      </div>
      <div className="management-list">
        {list.map((m) => (
          <article
            className={`panel record-card ${!m.archivedAt && m.reviewDate <= today() ? 'is-due' : ''}`}
            key={m.id}
          >
            <div className="task-meta">
              <span className="subject-pill">
                {app.subjects.find((s) => s.id === m.subjectId)?.name}
              </span>
              <span className={`mastery mastery-${m.mastery}`}>{masteryLabels[m.mastery]}</span>
              <span className={m.reviewDate <= today() ? 'error-text' : 'hint'}>
                复习 {m.reviewDate}
              </span>
            </div>
            <h2 className="clamp-3">{m.question}</h2>
            <p className="hint">
              {m.chapter || '未分类'} · 图片 {m.images.length} 张 · 复习{' '}
              {app.mistakeReviews.filter((r) => r.mistakeId === m.id).length} 次
            </p>
            <p className="hint clamp-3">错误原因：{m.reason || '待补充'}</p>
            <div className="record-actions">
              <Button size="sm" variant="secondary" onClick={() => setView(m.id)}>
                查看错题
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEdit(m)}>
                编辑
              </Button>
              {!m.archivedAt && (
                <>
                  <Button size="sm" onClick={() => setReview(m.id)}>
                    记录复习
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => setTask(m.id)}>
                    转为学习任务
                  </Button>
                </>
              )}
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  app.run(
                    () => archiveMistake(m.id, !m.archivedAt),
                    m.archivedAt ? '错题已恢复' : '错题已归档，图片与历史保留',
                  )
                }
              >
                {m.archivedAt ? '恢复错题' : '归档'}
              </Button>
            </div>
          </article>
        ))}
      </div>
      {!list.length && (
        <div className="empty-state">
          <h3>这里还没有符合条件的错题</h3>
          <p>记录题目与错误原因，给下次复习留下线索。</p>
          <Link href="/knowledge/">管理知识点 →</Link>
        </div>
      )}
      {edit && (
        <MistakeEditor mistake={edit === 'new' ? undefined : edit} onClose={() => setEdit(null)} />
      )}{' '}
      {current && (
        <Modal title="错题详情与复习历史" onClose={() => setView(null)} wide>
          <h3 className="pre-wrap">{current.question}</h3>
          <BlobImages images={current.images} />
          {[
            ['我的答案', current.wrongAnswer],
            ['正确答案', current.correctAnswer],
            ['错误原因', current.reason],
            ['解析', current.explanation],
          ].map(([l, v]) => (
            <div className="detail-block" key={l}>
              <h3>{l}</h3>
              <p className="pre-wrap">{v || '待补充'}</p>
            </div>
          ))}
          <p className="hint">
            关联知识点：
            {current.knowledgePointIds
              .map((id) => app.knowledgePoints.find((k) => k.id === id)?.name)
              .join('、') || '无'}
          </p>
          <p className="hint">
            关联任务：
            {(current.taskIds ?? [])
              .map((id) => app.tasks.find((t) => t.id === id)?.title)
              .join('、') || '无'}
          </p>
          <h3>复习历史</h3>
          {app.mistakeReviews
            .filter((r) => r.mistakeId === current.id)
            .sort((a, b) => b.reviewedAt.localeCompare(a.reviewedAt))
            .map((r) => (
              <p className="history-entry" key={r.id}>
                {new Date(r.reviewedAt).toLocaleString('zh-CN')} · {masteryLabels[r.mastery]}
                <br />
                {r.notes}
              </p>
            ))}
        </Modal>
      )}
      {review && (
        <ReviewEditor
          key={review}
          id={review}
          onClose={() => setReview(null)}
          onNext={() => {
            const next = app.mistakes
              .filter((m) => m.id !== review && !m.archivedAt && m.reviewDate <= today())
              .sort((a, b) => a.reviewDate.localeCompare(b.reviewDate))[0];
            setReview(next?.id ?? null);
          }}
        />
      )}{' '}
      {task && (
        <Modal title="错题转为学习任务" onClose={() => setTask(null)}>
          <div className="form-grid">
            <label>
              任务日期
              <input type="date" value={taskDate} onChange={(e) => setTaskDate(e.target.value)} />
            </label>
            <label>
              复习时长（分钟）
              <input
                type="number"
                min={1}
                max={1440}
                value={minutes}
                onChange={(e) => setMinutes(Number(e.target.value))}
              />
            </label>
          </div>
          <p className="hint">同一道错题在同一天只创建一项复习任务。完成任务不会自动改变掌握度。</p>
          <div className="modal-actions">
            <Button variant="secondary" onClick={() => setTask(null)}>
              取消
            </Button>
            <Button
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                if (await app.run(() => mistakeToTask(task, taskDate, minutes), '复习任务已创建'))
                  setTask(null);
                setBusy(false);
              }}
            >
              创建复习任务
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}
function MistakeEditor({ mistake, onClose }: { mistake?: Mistake; onClose: () => void }) {
  const app = useApp();
  const [form, setForm] = useState({
    subjectId: mistake?.subjectId ?? app.subjects.find((s) => s.active)!.id,
    question: mistake?.question ?? '',
    wrongAnswer: mistake?.wrongAnswer ?? '',
    correctAnswer: mistake?.correctAnswer ?? '',
    reason: mistake?.reason ?? '',
    explanation: mistake?.explanation ?? '',
    chapter: mistake?.chapter ?? '',
    knowledgePointIds: mistake?.knowledgePointIds ?? [],
    taskIds: mistake?.taskIds ?? [],
    reviewDate: mistake?.reviewDate ?? today(),
    mastery: mistake?.mastery ?? ('unmastered' as Mastery),
    images: mistake?.images ?? [],
  });
  const [busy, setBusy] = useState(false),
    [dirty, setDirty] = useState(false);
  const [preparing, setPreparing] = useState<{ done: number; total: number } | null>(null);
  useUnsavedChanges(dirty);
  const change = (v: Partial<typeof form>) => {
    setForm((f) => ({ ...f, ...v }));
    setDirty(true);
  };
  const close = () => {
    if (busy || preparing) return;
    if (!dirty || confirm('关闭将放弃未保存的错题内容，确认？')) onClose();
  };
  return (
    <Modal
      title={mistake ? '编辑错题' : '新建错题'}
      onClose={onClose}
      busy={busy || !!preparing}
      presentation="sheet"
      wide
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy || preparing) return;
          setBusy(true);
          if (await app.run(() => saveMistake(form, mistake?.id), '错题与图片已保存到本地数据库'))
            onClose();
          setBusy(false);
        }}
      >
        <div className="form-grid">
          <label className="span-2">
            题目
            <textarea
              required
              autoFocus
              rows={3}
              value={form.question}
              onChange={(e) => change({ question: e.target.value })}
            />
          </label>
          <label>
            科目
            <select
              aria-label="错题科目"
              value={form.subjectId}
              onChange={(e) =>
                change({ subjectId: e.target.value, knowledgePointIds: [], taskIds: [] })
              }
            >
              {app.subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            章节
            <input value={form.chapter} onChange={(e) => change({ chapter: e.target.value })} />
          </label>
          {(['wrongAnswer', 'correctAnswer', 'reason', 'explanation'] as const).map((key, i) => (
            <label key={key}>
              {['我的答案', '正确答案', '错误原因', '解析'][i]}
              <textarea
                rows={3}
                value={form[key]}
                onChange={(e) => change({ [key]: e.target.value })}
              />
            </label>
          ))}
          <label>
            掌握程度
            <select
              aria-label="错题掌握程度"
              value={form.mastery}
              onChange={(e) => change({ mastery: e.target.value as Mastery })}
            >
              {masteryValues.map((v) => (
                <option key={v} value={v}>
                  {masteryLabels[v]}
                </option>
              ))}
            </select>
          </label>
          <label>
            下次复习日期
            <input
              type="date"
              required
              value={form.reviewDate}
              onChange={(e) => change({ reviewDate: e.target.value })}
            />
          </label>
          <KnowledgePicker
            subjectId={form.subjectId}
            value={form.knowledgePointIds}
            onChange={(ids) => change({ knowledgePointIds: ids })}
          />
          <label>
            关联学习任务
            <select
              aria-label="关联学习任务"
              multiple
              size={3}
              value={form.taskIds}
              onChange={(e) =>
                change({ taskIds: Array.from(e.target.selectedOptions, (o) => o.value) })
              }
            >
              {app.tasks
                .filter((t) => !t.deletedAt && t.subjectId === form.subjectId)
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.date} {t.title}
                  </option>
                ))}
            </select>
          </label>
          <label className="span-2">
            上传错题图片
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              multiple
              disabled={!!preparing}
              onChange={async (e) => {
                const input = e.currentTarget;
                const files = Array.from(e.target.files ?? []);
                if (
                  files.some((f) => f.size > 10 * 1024 * 1024) ||
                  files.length + form.images.length > 10
                ) {
                  app.notify('最多10张图片，每张不超过10MB', true);
                  return;
                }
                if (!files.length) return;
                setPreparing({ done: 0, total: files.length });
                try {
                  const prepared: Blob[] = [];
                  for (const file of files) {
                    if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type))
                      throw new Error('请选择PNG、JPEG、WebP或GIF图片');
                    prepared.push(new Blob([await file.arrayBuffer()], { type: file.type }));
                    setPreparing({ done: prepared.length, total: files.length });
                  }
                  change({ images: [...form.images, ...prepared] });
                } catch (error) {
                  app.notify(
                    error instanceof Error ? error.message : '图片读取失败，请重新选择',
                    true,
                  );
                } finally {
                  input.value = '';
                  setPreparing(null);
                }
              }}
            />
          </label>
        </div>
        {(preparing || form.images.length > 0) && (
          <div className="upload-feedback" role="status">
            {preparing ? (
              <>
                <p>
                  正在读取图片 {preparing.done} / {preparing.total}
                </p>
                <progress max={preparing.total} value={preparing.done} />
              </>
            ) : (
              <p>已准备 {form.images.length} 张图片 · 保存后留在本机，不上传服务器</p>
            )}
          </div>
        )}
        <BlobImages images={form.images} />
        <div className="record-actions">
          {form.images.map((_, i) => (
            <Button
              size="sm"
              type="button"
              key={i}
              variant="ghost"
              onClick={() => change({ images: form.images.filter((_, j) => j !== i) })}
            >
              移除图片 {i + 1}
            </Button>
          ))}
        </div>
        <div className="modal-actions">
          <Button type="button" variant="secondary" onClick={close}>
            取消
          </Button>
          <Button loading={busy || !!preparing} disabled={busy || !!preparing}>
            保存错题
          </Button>
        </div>
      </form>
    </Modal>
  );
}
function ReviewEditor({
  id,
  onClose,
  onNext,
}: {
  id: string;
  onClose: () => void;
  onNext: () => void;
}) {
  const app = useApp();
  const [mastery, setMastery] = useState<Mastery>('weak'),
    [notes, setNotes] = useState(''),
    [date, setDate] = useState(format(addDays(parseISO(today()), 3), 'yyyy-MM-dd')),
    [update, setUpdate] = useState(false),
    [busy, setBusy] = useState(false);
  return (
    <Modal title="记录错题复习" onClose={onClose} busy={busy}>
      <p className="review-question">{app.mistakes.find((m) => m.id === id)?.question}</p>
      <details className="editor-extras">
        <summary>查看图片、答案与解析</summary>
        <BlobImages images={app.mistakes.find((m) => m.id === id)?.images ?? []} />
        <p className="pre-wrap">
          {app.mistakes.find((m) => m.id === id)?.correctAnswer || '正确答案待补充'}
        </p>
        <p className="hint pre-wrap">{app.mistakes.find((m) => m.id === id)?.explanation}</p>
      </details>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy) return;
          setBusy(true);
          if (
            await app.run(() => reviewMistake(id, mastery, notes, date, update), '复习结果已保存')
          ) {
            if ((e.nativeEvent as SubmitEvent).submitter?.getAttribute('value') === 'next')
              onNext();
            else onClose();
          }
          setBusy(false);
        }}
      >
        <div className="form-grid">
          <label>
            本次掌握程度
            <select
              aria-label="本次掌握程度"
              value={mastery}
              onChange={(e) => {
                const m = e.target.value as Mastery;
                setMastery(m);
                setDate(format(addDays(parseISO(today()), reviewInterval(m)), 'yyyy-MM-dd'));
              }}
            >
              {masteryValues.map((v) => (
                <option key={v} value={v}>
                  {masteryLabels[v]}
                </option>
              ))}
            </select>
          </label>
          <label>
            下次复习日期
            <input type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label className="span-2">
            复习记录
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
          </label>
          <label className="inline-check span-2">
            <input type="checkbox" checked={update} onChange={(e) => setUpdate(e.target.checked)} />
            我确认将相同评估应用到关联知识点
          </label>
        </div>
        <div className="modal-actions">
          <Button type="button" variant="secondary" onClick={onClose}>
            取消
          </Button>
          <Button loading={busy} disabled={busy}>
            保存复习结果
          </Button>
          <Button loading={busy} disabled={busy} name="intent" value="next" variant="secondary">
            保存并继续下一道
          </Button>
        </div>
      </form>
    </Modal>
  );
}
