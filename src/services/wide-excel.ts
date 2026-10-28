import { autoMapping, previewSheet, type ExcelSheet, type ImportRow } from './excel';
import type { Subject, StudyTask } from '@/types';
export const isWideSheet = (s: ExcelSheet) =>
  s.headers.some((h) => h.includes('数学网课')) && s.headers.some((h) => h.includes('408网课'));
export interface WideWeights {
  math: number;
  cs: number;
  english: number;
  politics: number;
}
export const defaultWideWeights: WideWeights = { math: 50, cs: 35, english: 10, politics: 5 };
export function previewWideSheet(
  sheet: ExcelSheet,
  subjects: Subject[],
  existing: StudyTask[],
  weights = defaultWideWeights,
  seen = new Set<string>(),
): ImportRow[] {
  const find = (pattern: RegExp) => sheet.headers.findIndex((h) => pattern.test(h));
  const date = find(/^日期$/),
    math = find(/^数学网课/),
    cs = find(/^408网课/),
    english = find(/^英语.*政治/),
    mathEx = find(/^数学练习/),
    csEx = find(/^408练习/),
    duration = find(/计划分钟|预计时长/),
    state = find(/^状态$/),
    chapter = find(/阶段.*重点/),
    note = find(/错题.*备注/);
  const rows: ImportRow[] = [];
  sheet.rows.forEach((cells, index) => {
    const parts: { category: keyof WideWeights; title: string; exercises: string }[] = [];
    if (cells[math]?.trim())
      parts.push({ category: 'math', title: cells[math], exercises: cells[mathEx] ?? '' });
    if (cells[cs]?.trim())
      parts.push({ category: 'cs', title: cells[cs], exercises: cells[csEx] ?? '' });
    const combined = cells[english] ?? '';
    const groups: Partial<Record<'english' | 'politics', string[]>> = {};
    let current: 'english' | 'politics' = 'english';
    for (const chunk of combined.split(/[；;]/)) {
      if (/^\s*政治/.test(chunk)) current = 'politics';
      else if (/^\s*英语/.test(chunk)) current = 'english';
      if (chunk.trim()) (groups[current] ??= []).push(chunk.trim());
    }
    for (const category of ['english', 'politics'] as const)
      if (groups[category]?.length)
        parts.push({ category, title: groups[category]!.join('；'), exercises: '' });
    const total = Number(cells[duration] || 90);
    const weight = parts.reduce((n, p) => n + weights[p.category], 0);
    let allocated = 0;
    const raw = Object.fromEntries(sheet.headers.map((h, j) => [`${j + 1}:${h}`, cells[j] ?? '']));
    if (
      !parts.length ||
      !Number.isInteger(total) ||
      total < parts.length ||
      total > 1440 ||
      weight <= 0
    ) {
      rows.push({
        sheet: sheet.name,
        row: sheet.rowNumbers?.[index] ?? index + 2,
        raw,
        error: '整日时长或科目分配无效',
        duplicate: false,
      });
      return;
    }
    for (const [i, part] of parts.entries()) {
      const remainingParts = parts.length - i - 1;
      const minutes =
        i === parts.length - 1
          ? total - allocated
          : Math.max(
              1,
              Math.min(
                total - allocated - remainingParts,
                Math.floor((total * weights[part.category]) / weight),
              ),
            );
      allocated += minutes;
      const subject = subjects.find((s) => s.category === part.category && s.active);
      const status = cells[state] === '未开始' ? '未完成' : (cells[state] ?? '');
      const partsOfTitle = part.title.split('｜');
      const realChapter =
        partsOfTitle.length > 1
          ? partsOfTitle.at(-1)!
          : part.category === 'math'
            ? (cells[chapter] ?? '').split(' / ')[0]
            : part.category === 'cs'
              ? ((cells[chapter] ?? '').split(' / ')[1] ?? '')
              : '';
      const virtual: ExcelSheet = {
        name: sheet.name,
        date1904: sheet.date1904,
        headers: ['日期', '科目', '任务', '章节', '练习', '时长', '状态', '备注', '网课'],
        rows: [
          [
            cells[date] ?? '',
            subject?.name ?? '未知',
            part.title.slice(0, 300),
            realChapter.slice(0, 500),
            part.exercises,
            String(minutes),
            status,
            `${cells[note] ?? ''}\n来源课程/题量待核实。整日 ${total} 分钟按比例拆分，本项 ${minutes} 分钟。`,
            partsOfTitle.length > 1 ? partsOfTitle.slice(0, -1).join('｜').slice(0, 500) : '',
          ],
        ],
        rowNumbers: [sheet.rowNumbers?.[index] ?? index + 2],
      };
      const result = previewSheet(
        virtual,
        autoMapping(virtual.headers),
        subjects,
        existing,
        seen,
      )[0];
      result.raw = {
        ...raw,
        导入说明: `整日总时长${total}分钟；权重${JSON.stringify(weights)}；分配${minutes}分钟`,
      };
      rows.push(result);
    }
  });
  return rows;
}
