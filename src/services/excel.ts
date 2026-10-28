import { format, addDays } from 'date-fns';
import { db } from '@/db';
import { entity, taskFingerprint, validDate } from '@/lib/utils';
import { taskSchema, type TaskInput } from '@/schemas';
import type { Subject, StudyTask, TaskStatus, StudySession, TaskResource } from '@/types';
import { taskProtectionReason } from '@/lib/task-protection';
import { record } from './tasks';
export const importFields = [
  'date',
  'subject',
  'title',
  'courseName',
  'courseUrl',
  'chapter',
  'exercises',
  'estimatedMinutes',
  'status',
  'notes',
] as const;
export type ImportField = (typeof importFields)[number];
export const fieldLabels: Record<ImportField, string> = {
  date: '日期',
  subject: '科目',
  title: '任务',
  courseName: '网课',
  courseUrl: '网课链接',
  chapter: '章节',
  exercises: '练习',
  estimatedMinutes: '时长（分钟）',
  status: '状态',
  notes: '备注',
};
export interface ExcelSheet {
  name: string;
  headers: string[];
  rows: string[][];
  rowNumbers?: number[];
  date1904: boolean;
}
export type ColumnMapping = Partial<Record<ImportField, number>>;
export interface ImportRow {
  sheet: string;
  row: number;
  raw: Record<string, string>;
  task?: TaskInput;
  sourceKey?: string;
  error?: string;
  duplicate: boolean;
}
const aliases: Record<ImportField, string[]> = {
  date: ['日期', '学习日期', 'date'],
  subject: ['科目', '学科', 'subject'],
  title: ['任务', '任务名称', '学习任务', '任务内容', 'title', 'task'],
  courseName: ['网课', '课程', '网课名称'],
  courseUrl: ['链接', '网课链接', 'url'],
  chapter: ['章节', '知识点', 'chapter'],
  exercises: ['练习', '题号', '练习题'],
  estimatedMinutes: ['时长', '时长分钟', '预计时长', '计划时长', '分钟', 'duration'],
  status: ['状态', '完成状态', 'status'],
  notes: ['备注', '笔记', 'notes'],
};
const norm = (v: string) => v.toLowerCase().replace(/[\s（）()_—-]/g, '');
export function autoMapping(headers: string[]): ColumnMapping {
  const result: ColumnMapping = {};
  for (const f of importFields) {
    const i = headers.findIndex((h) => aliases[f].some((a) => norm(h) === norm(a)));
    if (i >= 0) result[f] = i;
  }
  return result;
}
export function excelDate(value: string, date1904 = false): string {
  const v = value.trim();
  if (/^\d+(\.\d+)?$/.test(v)) {
    const n = Number(v);
    if (n < (date1904 ? 0 : 1) || n > 100000 || (!date1904 && Math.floor(n) === 60))
      throw new Error('Excel 日期序列无效');
    return format(
      addDays(
        new Date(date1904 ? 1904 : 1899, date1904 ? 0 : 11, date1904 ? 1 : 30),
        Math.floor(n) + (!date1904 && n < 60 ? 1 : 0),
      ),
      'yyyy-MM-dd',
    );
  }
  const match = v.match(/^(\d{4})[年/.-](\d{1,2})[月/.-](\d{1,2})日?(?:[ T].*)?$/);
  const date = match ? `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}` : v;
  if (!validDate(date)) throw new Error('日期格式无效，须为 YYYY-MM-DD 或 Excel 日期');
  return date;
}
function minutes(v: string) {
  if (!v.trim()) return 30;
  const h = v.match(/^(\d+(?:\.\d+)?)\s*(?:小时|h)$/i);
  const n = h ? Number(h[1]) * 60 : Number(v.replace(/分钟|分|min/gi, ''));
  if (!Number.isFinite(n) || n < 1 || n > 1440) throw new Error('时长须为 1–1440 分钟');
  return Math.round(n);
}
function subjectId(v: string, subjects: Subject[]) {
  const exact = subjects.find((s) => norm(s.name) === norm(v));
  if (exact) return exact.id;
  const category = /^(数学|高数|线代|概率)/.test(v)
    ? 'math'
    : /^英语/.test(v)
      ? 'english'
      : /^(408|数据结构|操作系统|计算机|自命题)/.test(v)
        ? 'cs'
        : /^政治|思想政治/.test(v)
          ? 'politics'
          : undefined;
  const s = subjects.find((s) => s.category === category && s.active);
  if (!s) throw new Error(`无法识别科目「${v}」`);
  return s.id;
}
function status(v: string): TaskStatus {
  const m: Record<string, TaskStatus> = {
    todo: 'todo',
    未完成: 'todo',
    待完成: 'todo',
    in_progress: 'in_progress',
    进行中: 'in_progress',
    partial: 'partial',
    部分完成: 'partial',
    completed: 'completed',
    已完成: 'completed',
    完成: 'completed',
    skipped: 'skipped',
    已跳过: 'skipped',
    跳过: 'skipped',
  };
  if (!v) return 'todo';
  if (!m[v]) throw new Error(`无法识别状态「${v}」`);
  return m[v];
}
export function previewSheet(
  sheet: ExcelSheet,
  mapping: ColumnMapping,
  subjects: Subject[],
  existing: StudyTask[],
  seen = new Set<string>(),
  sessions: StudySession[] = [],
  taskResources: TaskResource[] = [],
): ImportRow[] {
  const retained = existing.filter(
    (task) => !task.deletedAt || taskProtectionReason(task, sessions, taskResources),
  );
  const keys = new Set(retained.map(taskFingerprint)),
    sources = new Set(retained.map((t) => t.sourceKey));
  return sheet.rows.map((cells, i) => {
    const raw = Object.fromEntries(sheet.headers.map((h, j) => [`${j + 1}:${h}`, cells[j] ?? '']));
    const result: ImportRow = {
      sheet: sheet.name,
      row: sheet.rowNumbers?.[i] ?? i + 2,
      raw,
      duplicate: false,
    };
    try {
      if (
        mapping.date === undefined ||
        mapping.subject === undefined ||
        mapping.title === undefined
      )
        throw new Error('必须映射日期、科目和任务三列');
      const get = (f: ImportField) =>
        mapping[f] === undefined ? '' : (cells[mapping[f]!] ?? '').trim();
      const task = taskSchema.parse({
        date: excelDate(get('date'), sheet.date1904),
        subjectId: subjectId(get('subject'), subjects),
        title: get('title'),
        chapter: get('chapter'),
        courseName: get('courseName'),
        courseUrl: get('courseUrl'),
        exercises: get('exercises'),
        estimatedMinutes: minutes(get('estimatedMinutes')),
        status: status(get('status')),
        notes: get('notes'),
        knowledgePointIds: [],
        priority: 3,
      });
      const fingerprint = taskFingerprint(task);
      result.task = task;
      result.sourceKey = `xlsx:${fingerprint}`;
      result.duplicate =
        keys.has(fingerprint) || sources.has(result.sourceKey) || seen.has(fingerprint);
      seen.add(fingerprint);
    } catch (error) {
      result.error = error instanceof Error ? error.message : '解析失败';
    }
    return result;
  });
}
export async function readWorkbook(file: ArrayBuffer): Promise<ExcelSheet[]> {
  const { hasPrefixedWorkbook, readXmlWorkbook } = await import('./xlsx-xml');
  // ExcelJS does not reliably settle its streaming parser for prefixed OOXML.
  // Route that supported variant directly to the namespace-aware reader.
  if (await hasPrefixedWorkbook(file)) return readXmlWorkbook(file);
  try {
    return await readExcelJsWorkbook(file);
  } catch {
    return readXmlWorkbook(file);
  }
}
async function readExcelJsWorkbook(file: ArrayBuffer): Promise<ExcelSheet[]> {
  const ExcelJS = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(file);
  const result: ExcelSheet[] = [];
  let rowCount = 0;
  workbook.eachSheet((ws) => {
    if (ws.rowCount > 10000 || ws.columnCount > 100)
      throw new Error('单个工作表最多 10000 行、100 列');
    const rows: string[][] = [];
    const rowNumbers: number[] = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      const cells = Array.from({ length: ws.columnCount }, (_, i) => {
        const c = row.getCell(i + 1);
        const value = c.value;
        if (value instanceof Date)
          return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, '0')}-${String(value.getUTCDate()).padStart(2, '0')}`;
        if (value && typeof value === 'object') {
          if ('hyperlink' in value) return value.hyperlink;
          if ('result' in value) return String(value.result ?? '');
          if ('richText' in value) return value.richText.map((v) => v.text).join('');
        }
        return c.text ?? '';
      });
      rows.push(cells);
      rowNumbers.push(row.number);
      rowCount++;
    });
    if (rows.length > 1) {
      const headers = rows.shift()!;
      rowNumbers.shift();
      result.push({
        name: ws.name,
        headers,
        rows,
        rowNumbers,
        date1904: !!workbook.properties.date1904,
      });
    }
  });
  if (rowCount > 30000) throw new Error('文件最多 30000 行，请分批导入');
  if (!result.length) throw new Error('未发现含表头和任务的数据工作表');
  return result;
}
export async function commitImport(rows: ImportRow[], database = db) {
  return database.transaction(
    'rw',
    [
      database.tasks,
      database.subjects,
      database.revisions,
      database.sessions,
      database.taskResources,
    ],
    async () => {
      const sessions = await database.sessions.toArray();
      const taskResources = await database.taskResources.toArray();
      const all = await database.tasks.toArray();
      const existing = all.filter(
          (task) => !task.deletedAt || taskProtectionReason(task, sessions, taskResources),
        ),
        keys = new Set(existing.map(taskFingerprint)),
        sources = new Set(existing.map((t) => t.sourceKey));
      const subjects = new Set((await database.subjects.toArray()).map((s) => s.id));
      const added: StudyTask[] = [];
      const restoredBefore: StudyTask[] = [];
      let success = 0,
        skipped = 0,
        failed = 0;
      for (const row of rows) {
        if (!row.task || row.error) {
          failed++;
          continue;
        }
        const task = taskSchema.parse(row.task);
        if (!subjects.has(task.subjectId)) throw new Error('科目已变化，请重新预览');
        const key = taskFingerprint(task);
        if (keys.has(key) || (row.sourceKey && sources.has(row.sourceKey))) {
          skipped++;
          continue;
        }
        const archived = all.find(
          (candidate) =>
            candidate.deletedAt &&
            !taskProtectionReason(candidate, sessions, taskResources) &&
            ((row.sourceKey && candidate.sourceKey === row.sourceKey) ||
              taskFingerprint(candidate) === key),
        );
        const imported: StudyTask = {
          ...(archived ?? entity()),
          ...task,
          notes: archived?.notes || task.notes,
          deletedAt: undefined,
          plannedMinutes: undefined,
          unscheduled: false,
          dependencyTaskIds: task.dependencyTaskIds ?? [],
          scheduleKey: undefined,
          updatedAt: new Date().toISOString(),
          sourceKey: row.sourceKey,
          rawImport: row.raw,
          originDate: archived?.originDate ?? task.date,
          completedAt: task.status === 'completed' ? new Date().toISOString() : undefined,
        };
        if (archived) restoredBefore.push(archived);
        added.push(imported);
        keys.add(key);
        if (row.sourceKey) sources.add(row.sourceKey);
        success++;
      }
      if (added.length) {
        await database.tasks.bulkPut(added);
        await record(
          database,
          restoredBefore,
          added,
          `Excel导入（用户预览确认${restoredBefore.length ? `，恢复${restoredBefore.length}项归档任务` : ''}）`,
        );
      }
      return { success, skipped, failed };
    },
  );
}
