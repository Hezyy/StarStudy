'use client';
import { useViewState } from '@/lib/interaction';
import { useState } from 'react';
import { useApp } from '@/components/provider';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { masteryLabels, masteryValues } from '@/lib/mastery';
import { saveKnowledge, archiveKnowledge } from '@/services/learning';
import type { KnowledgePoint, Mastery } from '@/types';
export function KnowledgePage() {
  const app = useApp();
  const [edit, setEdit] = useState<KnowledgePoint | 'new' | null>(null),
    [subject, setSubject] = useViewState('knowledge.subject', 'all'),
    [mastery, setMastery] = useViewState('knowledge.mastery', 'all'),
    [query, setQuery] = useViewState('knowledge.query', ''),
    [archived, setArchived] = useViewState('knowledge.archived', false);
  const points = app.knowledgePoints.filter(
    (k) =>
      (archived ? !!k.archivedAt : !k.archivedAt) &&
      (subject === 'all' || k.subjectId === subject) &&
      (mastery === 'all' || k.mastery === mastery) &&
      `${k.name} ${k.chapter}`.includes(query),
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">理解，比打卡更重要</p>
          <h1>知识点管理</h1>
          <p>掌握度由你主动评估，完成任务不会自动变成熟练。</p>
        </div>
        <Button onClick={() => setEdit('new')}>新建知识点</Button>
      </div>
      <div className="management-filters">
        <label>
          搜索知识点
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="名称或章节"
          />
        </label>
        <label>
          科目
          <select
            aria-label="知识点科目筛选"
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
          掌握程度
          <select
            aria-label="知识点掌握筛选"
            value={mastery}
            onChange={(e) => setMastery(e.target.value)}
          >
            <option value="all">全部掌握度</option>
            {masteryValues.map((v) => (
              <option value={v} key={v}>
                {masteryLabels[v]}
              </option>
            ))}
          </select>
        </label>
        <label className="inline-check">
          <input
            type="checkbox"
            checked={archived}
            onChange={(e) => setArchived(e.target.checked)}
          />
          查看归档
        </label>
      </div>
      <div className="management-list">
        {points.map((k) => (
          <article className="panel record-card" key={k.id}>
            <div className="section-heading">
              <div>
                <span className="subject-pill">
                  {app.subjects.find((s) => s.id === k.subjectId)?.name}
                </span>
                <h2>{k.name}</h2>
              </div>
              <span className={`mastery mastery-${k.mastery}`}>{masteryLabels[k.mastery]}</span>
            </div>
            <p className="hint">
              章节：{k.chapter || '未分类'} · 依赖：
              {k.dependencyIds
                .map((id) => app.knowledgePoints.find((p) => p.id === id)?.name ?? '未知')
                .join('、') || '无'}
            </p>
            <p className="hint">
              关联任务{' '}
              {app.tasks.filter((t) => !t.deletedAt && t.knowledgePointIds.includes(k.id)).length}{' '}
              项
            </p>
            <details>
              <summary className="hint">掌握度变化记录</summary>
              {(k.history ?? []).map((h, i) => (
                <p className="hint" key={i}>
                  {new Date(h.changedAt).toLocaleString('zh-CN')} · {masteryLabels[h.mastery]} ·{' '}
                  {h.note}
                </p>
              ))}
            </details>
            <div className="record-actions">
              <Button size="sm" variant="secondary" onClick={() => setEdit(k)}>
                编辑知识点
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  app.run(
                    () => archiveKnowledge(k.id, !k.archivedAt),
                    k.archivedAt ? '已恢复知识点' : '知识点已归档',
                  )
                }
              >
                {k.archivedAt ? '恢复' : '归档'}
              </Button>
            </div>
          </article>
        ))}
      </div>
      {!points.length && (
        <div className="empty-state">
          <h3>没有符合条件的知识点</h3>
          <p>从一个具体概念开始，例如「行列式按行展开」。</p>
        </div>
      )}
      {edit && (
        <KnowledgeEditor point={edit === 'new' ? undefined : edit} onClose={() => setEdit(null)} />
      )}
    </>
  );
}
function KnowledgeEditor({ point, onClose }: { point?: KnowledgePoint; onClose: () => void }) {
  const app = useApp();
  const [form, setForm] = useState({
    subjectId: point?.subjectId ?? app.subjects.find((s) => s.active)!.id,
    name: point?.name ?? '',
    chapter: point?.chapter ?? '',
    mastery: point?.mastery ?? ('unlearned' as Mastery),
    dependencyIds: point?.dependencyIds ?? [],
    parentId: point?.parentId,
  });
  const [busy, setBusy] = useState(false);
  return (
    <Modal title={point ? '编辑知识点' : '新建知识点'} onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy) return;
          setBusy(true);
          if (
            await app.run(
              () => saveKnowledge(form, point?.id),
              '知识点评估已保存，复习建议将读取新状态',
            )
          )
            onClose();
          setBusy(false);
        }}
      >
        <div className="form-grid">
          <label>
            知识点名称
            <input
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </label>
          <label>
            科目
            <select
              aria-label="知识点科目"
              value={form.subjectId}
              onChange={(e) =>
                setForm({
                  ...form,
                  subjectId: e.target.value,
                  dependencyIds: [],
                  parentId: undefined,
                })
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
            <input
              value={form.chapter}
              onChange={(e) => setForm({ ...form, chapter: e.target.value })}
            />
          </label>
          <label>
            掌握程度
            <select
              aria-label="知识点掌握程度"
              value={form.mastery}
              onChange={(e) => setForm({ ...form, mastery: e.target.value as Mastery })}
            >
              {masteryValues.map((v) => (
                <option value={v} key={v}>
                  {masteryLabels[v]}
                </option>
              ))}
            </select>
          </label>
          <label className="span-2">
            前置知识点
            <select
              aria-label="前置知识点"
              multiple
              size={4}
              value={form.dependencyIds}
              onChange={(e) =>
                setForm({
                  ...form,
                  dependencyIds: Array.from(e.target.selectedOptions, (o) => o.value),
                })
              }
            >
              {app.knowledgePoints
                .filter(
                  (k) => k.id !== point?.id && k.subjectId === form.subjectId && !k.archivedAt,
                )
                .map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.name}
                  </option>
                ))}
            </select>
            <small className="hint">排期遵守依赖顺序，循环依赖会被拒绝。</small>
          </label>
        </div>
        <div className="modal-actions">
          <Button type="button" variant="secondary" onClick={onClose}>
            取消
          </Button>
          <Button loading={busy} disabled={busy}>
            保存知识点
          </Button>
        </div>
      </form>
    </Modal>
  );
}
