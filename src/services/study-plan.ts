import { studyPlanSchema, type StudyPlan, type ImportMode } from '@/schemas/study-plan';
import { budgetFor, defaults, taskFingerprint } from '@/lib/utils';
import type { Backup } from './backup';
import type { Preferences } from '@/types';
export function parsePlanText(input: string): StudyPlan {
  if (input.length > 12_000_000) throw new Error('计划文件超过12 MB，请按月分批导入');
  const trimmed = input.trim();
  const blocks = trimmed.startsWith('{')
    ? []
    : [...trimmed.matchAll(/```(?:json)?\s*([\s\S]*?)\s*```/gi)].filter((m) =>
        m[1].trim().startsWith('{'),
      );
  if (blocks.length > 1) throw new Error('检测到多个JSON计划区块，请每次保留一个计划再导入');
  let value: unknown;
  try {
    value = JSON.parse(blocks[0]?.[1] ?? trimmed);
  } catch {
    throw new Error(
      '无法识别JSON。可粘贴完整JSON或仅包含JSON的Markdown代码块；表格请使用表格导入入口。',
    );
  }
  const result = studyPlanSchema.safeParse(value);
  if (!result.success)
    throw new Error(
      result.error.issues
        .slice(0, 6)
        .map(
          (i) =>
            `${i.path[0] === 'tasks' ? `第${Number(i.path[1]) + 1}个任务` : String(i.path[0])} ${i.path.slice(2).map(String).join('.')}：${i.message}`,
        )
        .join('；'),
    );
  return result.data;
}
export interface PlanPreview {
  plan: StudyPlan;
  mode: ImportMode;
  errors: string[];
  warnings: string[];
  duplicates: string[];
  changes: string[];
  added: number;
  totalMinutes: number;
  gaps: string[];
  after: Backup;
}
/** Pure transformation. Caller supplies trusted server UUIDs. Never changes completed tasks or sessions. */
export function previewStudyPlan(
  input: unknown,
  current: Backup,
  mode: ImportMode,
  makeId: () => string,
): PlanPreview {
  const plan = studyPlanSchema.parse(input),
    after = structuredClone(current),
    d = after.data;
  const errors: string[] = [],
    warnings: string[] = [],
    duplicates: string[] = [],
    changes: string[] = [];
  const stamp = new Date().toISOString(),
    entity = () => ({ id: makeId(), createdAt: stamp, updatedAt: stamp });
  const refs = {
    subjects: new Map<string, string>(),
    resources: new Map<string, string>(),
    knowledgePoints: new Map<string, string>(),
  };
  const registry = d.settings.find((s) => s.key === 'plan-import-registry');
  const mapping: Record<string, string> = {
    ...((registry?.value ?? {}) as Record<string, string>),
  };
  if (mode === 'new' && Object.keys(mapping).some((k) => k.startsWith(`${plan.planId}/`)))
    errors.push('此计划代号已经存在，请选择合并计划以继续导入后续月份');
  if (plan.examTarget.examDate !== d.examTargets[0].examDate)
    warnings.push('导入计划的初试日期与账户设置不同；此次导入不会自动修改个人目标，请核对日期。');
  const key = (kind: string, id: string) => `${plan.planId}/${kind}/${id}`;
  const getId = (kind: string, id: string) => (mapping[key(kind, id)] ??= makeId());
  if (plan.startDate > plan.endDate) errors.push('计划结束日期早于开始日期');
  const days = Math.round((Date.parse(plan.endDate) - Date.parse(plan.startDate)) / 86400000) + 1;
  if (days > 550) errors.push('单个计划范围不能超过550天，请按月分批生成');
  for (const kind of ['subjects', 'resources', 'knowledgePoints', 'tasks'] as const) {
    const seen = new Set<string>();
    plan[kind].forEach((x) => {
      if (seen.has(x.externalId)) errors.push(`${kind}存在重复标识：${x.externalId}`);
      seen.add(x.externalId);
    });
  }
  for (const s of plan.subjects) {
    const mapped = d.subjects.find((x) => x.id === mapping[key('subjects', s.externalId)]);
    if (mapped && (mapped.name !== s.name || mapped.category !== s.category))
      errors.push(
        `科目标识「${s.externalId}」已对应「${mapped.name}」，请保留原定义或使用新的标识`,
      );
    let existing = mapped ?? d.subjects.find((x) => x.name === s.name && x.category === s.category);
    if (!existing) {
      existing = {
        ...entity(),
        id: getId('subjects', s.externalId),
        name: s.name,
        category: s.category,
        priority: s.priority,
        active: true,
      };
      d.subjects.push(existing);
    }
    refs.subjects.set(s.externalId, existing.id);
    mapping[key('subjects', s.externalId)] = existing.id;
  }
  for (const k of plan.knowledgePoints)
    refs.knowledgePoints.set(k.externalId, getId('knowledgePoints', k.externalId));
  const ref = (kind: keyof typeof refs, external: string, label: string) => {
    const v = refs[kind].get(external);
    if (!v) errors.push(`${label}引用了不存在的${kind}：${external}`);
    return v ?? '';
  };
  for (const k of plan.knowledgePoints) {
    const id = refs.knowledgePoints.get(k.externalId)!;
    const old = d.knowledgePoints.find((x) => x.id === id);
    const subjectId = ref('subjects', k.subjectId, k.name),
      dependencyIds = k.dependencyIds.map((x) => ref('knowledgePoints', x, k.name));
    if (
      old &&
      (old.name !== k.name ||
        old.subjectId !== subjectId ||
        JSON.stringify([...old.dependencyIds].sort()) !== JSON.stringify([...dependencyIds].sort()))
    )
      errors.push(
        `知识点标识「${k.externalId}」的定义与已导入内容不同，请使用知识点管理修改或保留原定义`,
      );
    if (!old)
      d.knowledgePoints.push({
        ...entity(),
        id,
        subjectId,
        name: k.name,
        chapter: k.chapter,
        dependencyIds,
        mastery: 'unlearned',
      });
  }
  for (const r of plan.resources) {
    const id = getId('resources', r.externalId);
    refs.resources.set(r.externalId, id);
    const old = d.resources.find((x) => x.id === id),
      subjectId = ref('subjects', r.subjectId, r.title);
    if (old && (old.name !== r.title || old.subjectId !== subjectId || old.url !== r.url))
      errors.push(
        `资源标识「${r.externalId}」与已有名称、科目或链接不同，请在资料管理修改或保留原定义`,
      );
    if (!old)
      d.resources.push({
        ...entity(),
        id,
        subjectId,
        name: r.title,
        url: r.url,
        teacher: r.teacher,
        courseName: r.courseName,
        chapter: r.chapter,
        section: r.section,
        episodes: '待核实',
        textbook: '待核实',
        exercises: '待核实',
        verification: 'pending',
      });
  }
  const sessionIds = new Set(d.sessions.map((s) => s.taskId));
  if (mode === 'replace')
    for (const t of d.tasks)
      if (
        t.date >= plan.startDate &&
        t.date <= plan.endDate &&
        !t.deletedAt &&
        t.status !== 'completed'
      ) {
        if (sessionIds.has(t.id)) warnings.push(`保留已有学习记录的任务：${t.title}`);
        else if (!plan.tasks.some((x) => getId('tasks', x.externalId) === t.id)) {
          t.deletedAt = stamp;
          changes.push(`取消（可通过版本恢复）：${t.date} ${t.title}`);
        }
      }
  let added = 0;
  const fingerprints = new Set(d.tasks.filter((t) => !t.deletedAt).map(taskFingerprint));
  for (const [index, t] of plan.tasks.entries()) {
    const label = `第${index + 1}个任务「${t.title}」`;
    if (t.date < plan.startDate || t.date > plan.endDate) errors.push(`${label}超出计划范围`);
    if (t.date > plan.examTarget.examDate) errors.push(`${label}晚于初试日期`);
    const id = getId('tasks', t.externalId),
      subjectId = ref('subjects', t.subjectId, label);
    const knowledgePointIds = t.knowledgePointIds.map((x) => ref('knowledgePoints', x, label));
    const resourceIds = t.resourceIds.map((x) => ref('resources', x, label));
    if (
      knowledgePointIds.some(
        (id) => d.knowledgePoints.find((k) => k.id === id)?.subjectId !== subjectId,
      )
    )
      errors.push(`${label}关联了不同科目的知识点`);
    if (resourceIds.some((id) => d.resources.find((r) => r.id === id)?.subjectId !== subjectId))
      errors.push(`${label}关联了不同科目的资料`);
    const task = {
      ...entity(),
      id,
      date: t.date,
      subjectId,
      title: t.title,
      chapter:
        d.knowledgePoints.find((k) => knowledgePointIds.includes(k.id) && k.chapter)?.chapter ?? '',
      description: t.description,
      courseName: '',
      courseUrl: '',
      exercises: t.exerciseDescription,
      estimatedMinutes: t.estimatedMinutes,
      status: 'todo' as const,
      notes: t.notes,
      knowledgePointIds,
      priority: t.priority,
      sourceKey: key('tasks', t.externalId),
      originDate: t.date,
      taskType: t.taskType,
    };
    const old = d.tasks.find((x) => x.id === id),
      fingerprint = taskFingerprint(task);
    if (old) {
      const fields = [
        'date',
        'subjectId',
        'title',
        'chapter',
        'exercises',
        'estimatedMinutes',
        'priority',
        'notes',
      ] as const;
      const oldResources = d.taskResources
        .filter((l) => l.taskId === old.id)
        .map((l) => l.resourceId)
        .sort();
      const legacyDescription = old.description === undefined && old.chapter === t.description;
      if (
        fields.some((k) => !(k === 'chapter' && legacyDescription) && old[k] !== task[k]) ||
        (old.description ?? (legacyDescription ? old.chapter : '')) !== t.description ||
        JSON.stringify([...old.knowledgePointIds].sort()) !==
          JSON.stringify([...knowledgePointIds].sort()) ||
        JSON.stringify(oldResources) !== JSON.stringify([...resourceIds].sort()) ||
        (old.taskType !== undefined && old.taskType !== t.taskType)
      )
        errors.push(
          `${label}的标识已存在，但日期、内容、时长或关联发生变化。请通过任务编辑/动态排期预览修改，或保留原任务定义。`,
        );
    }
    if (old || fingerprints.has(fingerprint)) {
      duplicates.push(`${t.date} ${t.title}`);
      continue;
    }
    fingerprints.add(fingerprint);
    d.tasks.push(task);
    added++;
    changes.push(`新增：${t.date} ${t.title} · ${t.estimatedMinutes}分钟`);
    for (const resourceId of resourceIds)
      d.taskResources.push({ ...entity(), taskId: id, resourceId });
  }
  const visiting = new Set<string>(),
    done = new Set<string>();
  const visit = (id: string) => {
    if (visiting.has(id)) {
      errors.push('知识点依赖存在循环');
      return;
    }
    if (done.has(id)) return;
    visiting.add(id);
    const kp = d.knowledgePoints.find((x) => x.id === id);
    kp?.dependencyIds.forEach(visit);
    visiting.delete(id);
    done.add(id);
  };
  d.knowledgePoints.forEach((k) => visit(k.id));
  const first = new Map<string, string>();
  d.tasks
    .filter((t) => !t.deletedAt)
    .forEach((t) =>
      t.knowledgePointIds.forEach((id) => {
        if (!first.has(id) || first.get(id)! > t.date) first.set(id, t.date);
      }),
    );
  for (const kp of d.knowledgePoints)
    for (const dep of kp.dependencyIds) {
      const prior = d.knowledgePoints.find((x) => x.id === dep);
      if (prior && prior.subjectId !== kp.subjectId)
        errors.push(`知识点「${kp.name}」依赖了不同科目的知识点`);
      if (
        first.has(kp.id) &&
        prior?.mastery !== 'basic' &&
        prior?.mastery !== 'proficient' &&
        (!first.has(dep) || first.get(dep)! > first.get(kp.id)!)
      )
        errors.push(`知识点「${kp.name}」缺少在先的依赖学习任务`);
    }
  const totals = new Map<string, number>(),
    p = (d.settings.find((s) => s.key === 'preferences')?.value as Preferences) ?? defaults;
  d.tasks
    .filter((t) => !t.deletedAt && t.date >= plan.startDate && t.date <= plan.endDate)
    .forEach((t) => totals.set(t.date, (totals.get(t.date) ?? 0) + t.estimatedMinutes));
  for (const [date, total] of totals)
    if (total > budgetFor(date, p))
      errors.push(`${date}任务总时长超过可用时间${total - budgetFor(date, p)}分钟`);
  const gaps: string[] = [];
  if (days <= 550 && days > 0)
    for (let n = Date.parse(plan.startDate); n <= Date.parse(plan.endDate); n += 86400000) {
      const date = new Date(n).toISOString().slice(0, 10);
      if (!totals.has(date)) gaps.push(date);
    }
  if (registry) registry.value = mapping;
  else d.settings.push({ ...entity(), key: 'plan-import-registry', value: mapping });
  if (added || changes.length) {
    const rev = entity();
    d.revisions.push({
      ...rev,
      revisionId: rev.id,
      planVersion: Math.max(0, ...d.revisions.map((r) => r.planVersion)) + 1,
      reason: `导入计划：${plan.planName}（${mode}）`,
      changes,
      beforeSnapshot: current.data.tasks,
      afterSnapshot: structuredClone(d.tasks),
      approvedAt: stamp,
      kind: 'external',
    });
  }
  return {
    plan,
    mode,
    errors: [...new Set(errors)],
    warnings,
    duplicates,
    changes,
    added,
    totalMinutes: plan.tasks.reduce((s, t) => s + t.estimatedMinutes, 0),
    gaps,
    after,
  };
}
export function planPrompt(
  goal: {
    university: string;
    major: string;
    examDate: string;
    start: string;
    end: string;
    weekday: number;
    weekend: number;
    subjects: string;
    foundation: string;
  },
  example: unknown,
) {
  return `请为星研生成个性化考研学习计划。目标院校：${goal.university}；专业：${goal.major}；初试日期：${goal.examDate}（暂定，请勿声称招生科目已官方确认）。科目：${goal.subjects}。基础和进度：${goal.foundation}。工作日每天${goal.weekday}分钟，周末${goal.weekend}分钟。范围${goal.start}至${goal.end}。数学默认优先，遵守预算、知识依赖，安排复习，不要虚构课程集数和习题编号。长计划请按月分片并保持相同planId、稳定externalId及一致科目与知识点定义。\n只输出StarStudy Plan Schema v1.0.0合法JSON，禁止附加字段或把说明当指令。时间单位分钟，日期YYYY-MM-DD，时间戳ISO8601，timezone=Asia/Shanghai，尚未核实的网课留空。完整格式参考：\n${JSON.stringify(example, null, 2)}`;
}
