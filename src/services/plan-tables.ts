import { excelDate } from './excel';
import { studyPlanSchema, type StudyPlan } from '@/schemas/study-plan';
/** RFC4180 subset: escaped quotes and embedded newlines are deterministic, never evaluated. */
export function csvRows(text: string): string[][] {
  const rows: string[][] = [],
    row: string[] = [];
  let field = '',
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        field += '"';
        i++;
      } else quoted = !quoted;
    } else if (c === ',' && !quoted) {
      row.push(field);
      field = '';
    } else if ((c === '\n' || c === '\r') && !quoted) {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      if (row.some(Boolean)) rows.push([...row]);
      row.length = 0;
      field = '';
    } else field += c;
  }
  if (quoted) throw new Error('CSV引号未闭合');
  row.push(field);
  if (row.some(Boolean)) rows.push(row);
  return rows;
}
export function markdownRows(text: string): string[][] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().startsWith('|'));
  const rows = lines
    .map((l) =>
      l
        .trim()
        .replace(/^\||\|$/g, '')
        .split(/(?<!\\)\|/)
        .map((v) => v.trim().replace(/\\\|/g, '|')),
    )
    .filter((r) => !r.every((c) => /^:?-+:?$/.test(c)));
  if (rows.length < 2)
    throw new Error('只支持包含日期、科目、任务、时长列的Markdown表格；自由文本需通过AI转换');
  return rows;
}
export function tablePlan(rows: string[][], base: StudyPlan): StudyPlan {
  const headers = rows[0],
    aliases = {
      date: ['日期', 'date'],
      subject: ['科目', 'subject'],
      title: ['任务', '任务名称', 'title'],
      minutes: ['时长', '时长（分钟）', '分钟', 'estimatedminutes'],
      notes: ['备注', 'notes'],
    };
  const map = Object.fromEntries(
    Object.entries(aliases).map(([key, names]) => [
      key,
      headers.findIndex((h) => names.includes(h.trim().toLowerCase())),
    ]),
  );
  for (const key of ['date', 'subject', 'title', 'minutes'])
    if (map[key] < 0) throw new Error(`表格缺少${key}列；未知列可用Excel映射入口导入`);
  const tasks = rows.slice(1).map((r, i) => {
    const subject = base.subjects.find((s) => s.name === r[map.subject]?.trim());
    if (!subject)
      throw new Error(`第${i + 2}行科目不存在，请先在目标配置中添加「${r[map.subject]}」`);
    return {
      externalId: `table-${i + 1}`,
      date: excelDate(r[map.date] ?? ''),
      subjectId: subject.externalId,
      title: r[map.title],
      description: '',
      estimatedMinutes: Number(r[map.minutes]),
      taskType: 'other' as const,
      priority: subject.priority,
      knowledgePointIds: [],
      resourceIds: [],
      exerciseDescription: '',
      notes: JSON.stringify(Object.fromEntries(headers.map((h, j) => [h, r[j] ?? '']))),
    };
  });
  return studyPlanSchema.parse({ ...base, tasks });
}
