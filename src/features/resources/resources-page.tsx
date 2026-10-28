'use client';
import { useViewState } from '@/lib/interaction';
import { useState } from 'react';
import Link from '@/components/ui/app-link';
import { useApp } from '@/components/provider';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { KnowledgePicker } from '@/components/learning-fields';
import { saveResource, archiveResource, linkResourceTask } from '@/services/learning';
import { saveTask } from '@/services/tasks';
import { today } from '@/lib/utils';
import { masteryLabels, masteryValues } from '@/lib/mastery';
import type { Resource, Mastery } from '@/types';
import { videoLink } from '@/lib/video-link';
const chapters: Record<string, string[]> = {
  math: ['高等数学', '线性代数', '概率论与数理统计'],
  english: ['词汇', '长难句', '阅读', '翻译', '新题型', '写作'],
  cs: ['数据结构', '计算机组成原理', '操作系统', '计算机网络'],
  politics: ['基础知识', '强化练习', '冲刺复习'],
};
export function ResourcesPage() {
  const app = useApp();
  const [edit, setEdit] = useState<Resource | 'new' | null>(null),
    [subject, setSubject] = useViewState('resources.subject', 'all'),
    [chapter, setChapter] = useViewState('resources.chapter', ''),
    [query, setQuery] = useViewState('resources.query', ''),
    [archive, setArchive] = useViewState('resources.archive', false),
    [link, setLink] = useState<Resource | null>(null),
    [task, setTask] = useState(''),
    [create, setCreate] = useState<Resource | null>(null),
    [date, setDate] = useState(today()),
    [minutes, setMinutes] = useState(30),
    [busy, setBusy] = useState(false);
  const list = app.resources.filter(
    (r) =>
      (archive ? !!r.archivedAt : !r.archivedAt) &&
      (subject === 'all' || r.subjectId === subject) &&
      (!chapter || r.chapter === chapter) &&
      `${r.name} ${r.teacher} ${r.chapter}`.includes(query),
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">课程、练习与知识点连在一起</p>
          <h1>学习资料</h1>
          <p>未核实的课程来源、集数和题号明确标记待核实。</p>
        </div>
        <div className="heading-buttons">
          <Button variant="secondary" asChild>
            <Link href="/knowledge/">知识点管理</Link>
          </Button>
          <Button onClick={() => setEdit('new')}>新建学习资料</Button>
        </div>
      </div>
      <div className="management-filters">
        <label>
          搜索资料
          <input value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <label>
          科目
          <select
            aria-label="资料科目筛选"
            value={subject}
            onChange={(e) => {
              setSubject(e.target.value);
              setChapter('');
            }}
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
            aria-label="资料章节筛选"
            value={chapter}
            onChange={(e) => setChapter(e.target.value)}
          >
            <option value="">全部章节</option>
            {[
              ...new Set([
                ...Object.values(chapters).flat(),
                ...app.resources.map((r) => r.chapter),
              ]),
            ]
              .filter(Boolean)
              .map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
          </select>
        </label>
        <label className="inline-check">
          <input type="checkbox" checked={archive} onChange={(e) => setArchive(e.target.checked)} />
          查看归档
        </label>
      </div>
      <div className="management-list">
        {list.map((r) => (
          <article className="panel record-card" key={r.id}>
            <div className="section-heading">
              <div>
                <span className="subject-pill">
                  {app.subjects.find((s) => s.id === r.subjectId)?.name} · {r.chapter || '待分类'}
                </span>
                <h2>{r.name}</h2>
              </div>
              <span className="tag">{r.verification === 'verified' ? '用户已核实' : '待核实'}</span>
            </div>
            <p className="hint">
              老师 {r.teacher || '待核实'} · 视频集数 {r.episodes || '待核实'} · 教材{' '}
              {r.textbook || '待核实'}
            </p>
            <p className="pre-wrap hint">练习位置：{r.exercises || '待核实'}</p>
            <p className="hint">
              进度 {r.progress ?? 0}% · {masteryLabels[r.mastery ?? 'unlearned']}
            </p>
            <progress max={100} value={r.progress ?? 0} />
            <p className="hint">
              关联任务：
              {app.taskResources
                .filter((v) => v.resourceId === r.id)
                .map((v) => app.tasks.find((t) => t.id === v.taskId)?.title)
                .join('、') || '无'}
            </p>
            <div className="record-actions">
              {r.url && (
                <Button asChild size="sm">
                  <a href={r.url} target="_blank" rel="noopener noreferrer">
                    {videoLink(r.url).label}
                  </a>
                </Button>
              )}
              <Button size="sm" variant="secondary" onClick={() => setEdit(r)}>
                编辑资料
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setCreate(r)}>
                创建课程任务
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setLink(r);
                  setTask('');
                }}
              >
                关联已有任务
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  app.run(
                    () => archiveResource(r.id, !r.archivedAt),
                    r.archivedAt ? '资料已恢复' : '资料已归档',
                  )
                }
              >
                {r.archivedAt ? '恢复' : '归档'}
              </Button>
            </div>
          </article>
        ))}
      </div>
      {!list.length && (
        <div className="empty-state">
          <h3>还没有符合条件的学习资料</h3>
          <p>添加你实际使用的课程，内容和进度全部由本地数据生成。</p>
        </div>
      )}
      {edit && (
        <ResourceEditor
          resource={edit === 'new' ? undefined : edit}
          onClose={() => setEdit(null)}
        />
      )}{' '}
      {link && (
        <Modal title="关联已有学习任务" onClose={() => setLink(null)}>
          <label>
            选择任务
            <select
              aria-label="资料关联任务"
              value={task}
              onChange={(e) => setTask(e.target.value)}
            >
              <option value="">请选择</option>
              {app.tasks
                .filter((t) => !t.deletedAt && t.subjectId === link.subjectId)
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.date} {t.title}
                  </option>
                ))}
            </select>
          </label>
          <div className="modal-actions">
            <Button variant="secondary" onClick={() => setLink(null)}>
              取消
            </Button>
            <Button
              disabled={!task}
              onClick={async () => {
                if (await app.run(() => linkResourceTask(link.id, task), '资料已关联'))
                  setLink(null);
              }}
            >
              保存关联
            </Button>
          </div>
        </Modal>
      )}
      {create && (
        <Modal title="创建课程任务" onClose={() => setCreate(null)}>
          <div className="form-grid">
            <label>
              学习日期
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
            <label>
              预计时长（分钟）
              <input
                type="number"
                min={1}
                max={1440}
                value={minutes}
                onChange={(e) => setMinutes(Number(e.target.value))}
              />
            </label>
          </div>
          <p className="hint">将保存课程名称、链接、章节、练习与关联知识点。</p>
          <div className="modal-actions">
            <Button variant="secondary" onClick={() => setCreate(null)}>
              取消
            </Button>
            <Button
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                if (
                  await app.run(async () => {
                    const t = await saveTask({
                      title: create.name,
                      date,
                      subjectId: create.subjectId,
                      chapter: create.chapter,
                      courseName: create.name,
                      courseUrl: create.url,
                      exercises: create.exercises,
                      estimatedMinutes: minutes,
                      status: 'todo',
                      notes: '',
                      knowledgePointIds: create.knowledgePointIds ?? [],
                      priority: 3,
                    });
                    await linkResourceTask(create.id, t.id);
                  }, '课程任务已创建')
                )
                  setCreate(null);
                setBusy(false);
              }}
            >
              创建学习任务
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}
function ResourceEditor({ resource, onClose }: { resource?: Resource; onClose: () => void }) {
  const app = useApp();
  const [f, setF] = useState({
    platform: resource?.platform ?? '',
    courseName: resource?.courseName ?? '',
    section: resource?.section ?? '',
    subjectId: resource?.subjectId ?? app.subjects.find((s) => s.active)!.id,
    name: resource?.name ?? '',
    teacher: resource?.teacher ?? '',
    url: resource?.url ?? '',
    chapter: resource?.chapter ?? '',
    episodes: resource?.episodes ?? '',
    textbook: resource?.textbook ?? '',
    exercises: resource?.exercises ?? '',
    verification: resource?.verification ?? ('pending' as 'pending' | 'verified'),
    progress: resource?.progress ?? 0,
    mastery: resource?.mastery ?? ('unlearned' as Mastery),
    knowledgePointIds: resource?.knowledgePointIds ?? [],
  });
  const [busy, setBusy] = useState(false);
  return (
    <Modal title={resource ? '编辑学习资料' : '新建学习资料'} onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy) return;
          setBusy(true);
          if (await app.run(() => saveResource(f, resource?.id), '学习资料已保存')) onClose();
          setBusy(false);
        }}
      >
        <div className="form-grid">
          <label>
            资料名称
            <input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          </label>
          <label>
            科目
            <select
              aria-label="资料科目"
              value={f.subjectId}
              onChange={(e) => setF({ ...f, subjectId: e.target.value, knowledgePointIds: [] })}
            >
              {app.subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          {(
            [
              'teacher',
              'url',
              'chapter',
              'episodes',
              'textbook',
              'exercises',
              'platform',
              'courseName',
              'section',
            ] as const
          ).map((k, i) => (
            <label key={k}>
              {
                [
                  '授课老师',
                  '网课URL',
                  '章节',
                  '视频集数',
                  '教材名称',
                  '练习题位置',
                  '平台',
                  '课程名称',
                  '选集说明',
                ][i]
              }
              <input
                type={k === 'url' ? 'url' : 'text'}
                placeholder="待核实 / 待补充"
                list={k === 'chapter' ? 'resource-chapters' : undefined}
                value={f[k]}
                onChange={(e) => setF({ ...f, [k]: e.target.value })}
              />
            </label>
          ))}
          <datalist id="resource-chapters">
            {(
              chapters[app.subjects.find((s) => s.id === f.subjectId)?.category ?? 'math'] ?? []
            ).map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
          <label>
            学习进度（%）
            <input
              type="number"
              min={0}
              max={100}
              value={f.progress}
              onChange={(e) => setF({ ...f, progress: Number(e.target.value) })}
            />
          </label>
          <label>
            掌握程度
            <select
              aria-label="资料掌握程度"
              value={f.mastery}
              onChange={(e) => setF({ ...f, mastery: e.target.value as Mastery })}
            >
              {masteryValues.map((v) => (
                <option key={v} value={v}>
                  {masteryLabels[v]}
                </option>
              ))}
            </select>
          </label>
          <KnowledgePicker
            subjectId={f.subjectId}
            value={f.knowledgePointIds}
            onChange={(ids) => setF({ ...f, knowledgePointIds: ids })}
          />
          <label className="inline-check">
            <input
              type="checkbox"
              checked={f.verification === 'verified'}
              onChange={(e) =>
                setF({ ...f, verification: e.target.checked ? 'verified' : 'pending' })
              }
            />
            我已核实所填来源
          </label>
        </div>
        <div className="modal-actions">
          <Button type="button" variant="secondary" onClick={onClose}>
            取消
          </Button>
          <Button loading={busy} disabled={busy}>
            保存学习资料
          </Button>
        </div>
      </form>
    </Modal>
  );
}
