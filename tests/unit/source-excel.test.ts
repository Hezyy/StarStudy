import { describe, it, expect } from 'vitest';
import { readFile, writeFile } from 'node:fs/promises';
import JSZip from 'jszip';
import { readWorkbook, commitImport } from '@/services/excel';
import { readCoreData } from '@/services/backup';
import { schedule } from '@/scheduler/engine';
import { validateProposal } from '@/services/plans';
import { defaults, budgetFor } from '@/lib/utils';
import { previewWideSheet, isWideSheet } from '@/services/wide-excel';
import { testDatabase } from './helpers';
describe('命名空间与真实426天宽表', () => {
  it('带前缀XML工作簿能解析文本、日期和多个科目', async () => {
    const zip = new JSZip();
    zip.file(
      'xl/workbook.xml',
      '<x:workbook xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><x:sheets><x:sheet name="任务" sheetId="1" r:id="r1" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/></x:sheets></x:workbook>',
    );
    zip.file(
      'xl/_rels/workbook.xml.rels',
      '<Relationships><Relationship Id="r1" Target="worksheets/sheet1.xml"/></Relationships>',
    );
    zip.file(
      'xl/sharedStrings.xml',
      '<x:sst xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><x:si><x:t>日期</x:t></x:si><x:si><x:t>科目</x:t></x:si><x:si><x:t>任务</x:t></x:si><x:si><x:t>2026-11-01</x:t></x:si><x:si><x:t>数学一</x:t></x:si><x:si><x:t>矩阵</x:t></x:si></x:sst>',
    );
    zip.file(
      'xl/worksheets/sheet1.xml',
      '<x:worksheet xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><x:sheetData><x:row r="1"><x:c r="A1" t="s"><x:v>0</x:v></x:c><x:c r="B1" t="s"><x:v>1</x:v></x:c><x:c r="C1" t="s"><x:v>2</x:v></x:c></x:row><x:row r="3"><x:c r="A3" t="s"><x:v>3</x:v></x:c><x:c r="B3" t="s"><x:v>4</x:v></x:c><x:c r="C3" t="s"><x:v>5</x:v></x:c></x:row></x:sheetData></x:worksheet>',
    );
    const s = await readWorkbook(await zip.generateAsync({ type: 'arraybuffer' }));
    expect(s[0].rows[0]).toEqual(['2026-11-01', '数学一', '矩阵']);
    expect(s[0].rowNumbers).toEqual([3]);
  });
  it.skipIf(!process.env.STAR_STUDY_SOURCE_XLSX)(
    '核对用户原件426个日期、拆分总时长与原始字段',
    async () => {
      const data = await readFile(process.env.STAR_STUDY_SOURCE_XLSX!);
      const sheets = await readWorkbook(Uint8Array.from(data).buffer);
      const wide = sheets.filter(isWideSheet);
      const d = await testDatabase();
      try {
        const subjects = await d.subjects.toArray(),
          seen = new Set<string>();
        const rows = wide.flatMap((s) => previewWideSheet(s, subjects, [], undefined, seen));
        expect(wide).toHaveLength(14);
        expect(new Set(rows.map((r) => r.task?.date)).size).toBe(426);
        expect(rows.filter((r) => r.error)).toHaveLength(0);
        const planned = wide.reduce(
          (sum, s) =>
            sum + s.rows.reduce((n, r) => n + Number(r[s.headers.indexOf('计划分钟')]), 0),
          0,
        );
        expect(rows.reduce((n, r) => n + (r.task?.estimatedMinutes ?? 0), 0)).toBe(planned);
        expect(rows[0].raw['4:数学网课/学习内容']).toBeTruthy();
        await commitImport(rows, d);
        expect((await commitImport(rows, d)).success).toBe(0);
        const core = await readCoreData(d);
        const preview = schedule(
          { ...core, today: '2026-10-27', examDate: '2027-12-25', preferences: defaults },
          {
            from: '2026-11-01',
            to: '2027-12-25',
            reason: '原件默认预算容量校验',
            maxChunkMinutes: 45,
            addReviews: false,
            subjectDailyLimits: {},
            generatedAt: '2026-10-27T00:00:00.000Z',
          },
        );
        validateProposal(preview, core);
        const assigned = preview.changes
            .filter((c) => !c.after.unscheduled)
            .reduce((n, c) => n + (c.after.plannedMinutes ?? 0), 0),
          unassigned = preview.unassigned.reduce((n, u) => n + u.minutes, 0);
        expect(assigned + unassigned).toBe(planned);
        expect(preview.availableMinutes).toBe(41400);
        expect(unassigned).toBe(13490);
        const byDay = new Map<string, number>();
        for (const c of preview.changes)
          if (!c.after.unscheduled)
            byDay.set(c.after.date, (byDay.get(c.after.date) ?? 0) + (c.after.plannedMinutes ?? 0));
        for (const [date, minutes] of byDay)
          expect(minutes).toBeLessThanOrEqual(budgetFor(date, defaults));
        await writeFile(
          'imports/source-audit.json',
          JSON.stringify(
            {
              sheets: sheets.map((s) => ({
                name: s.name,
                rows: s.rows.length,
                wide: isWideSheet(s),
              })),
              days: 426,
              taskCount: rows.length,
              plannedMinutes: planned,
              dateFrom: [...new Set(rows.map((r) => r.task!.date))].sort()[0],
              dateTo: [...new Set(rows.map((r) => r.task!.date))].sort().at(-1),
              errors: 0,
              duplicateRows: rows.filter((r) => r.duplicate).length,
              allocation: '数学50、408 35、英语10、政治5，按当日存在科目归一化；仅为可编辑导入估算',
              defaultBudgetForecast: {
                from: '2026-11-01',
                examDate: '2027-12-25',
                availableMinutes: preview.availableMinutes,
                assignedMinutes: assigned,
                unassignedMinutes: unassigned,
                changes: preview.changes.length,
                important: '仅隔离测试库模拟，未自动修改用户数据库；假期预算尚未配置',
              },
            },
            null,
            2,
          ),
        );
      } finally {
        await d.delete();
      }
    },
  );
});
