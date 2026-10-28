import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import type { StarDatabase } from '@/db';
import { testDatabase, sampleTask } from './helpers';
import {
  autoMapping,
  excelDate,
  previewSheet,
  commitImport,
  readWorkbook,
  type ExcelSheet,
} from '@/services/excel';
const sheet: ExcelSheet = {
  name: '11月',
  date1904: false,
  headers: ['日期', '科目', '任务', '时长', '状态', '原始额外列'],
  rows: [
    ['2026/11/1', '数学一', '复习极限', '45', '未完成', '保留我'],
    ['2026-11-02', '408', '数据结构基础', '30', '部分完成', '自学'],
  ],
};
describe('Excel 安全导入', () => {
  let database: StarDatabase;
  beforeEach(async () => {
    database = await testDatabase();
  });
  afterEach(async () => {
    await database.delete();
  });
  it('日期支持 Excel 数值、1904、中文及斜杠，拒绝无效日期', () => {
    expect(excelDate('2026/11/1')).toBe('2026-11-01');
    expect(excelDate('2026年11月1日')).toBe('2026-11-01');
    expect(excelDate('25569')).toBe('1970-01-01');
    expect(excelDate('1', true)).toBe('1904-01-02');
    expect(() => excelDate('2026-02-30')).toThrow();
    expect(() => excelDate('hello')).toThrow();
  });
  it('识别科目时长状态，保留未知列；重复导入跳过', async () => {
    const subjects = await database.subjects.toArray();
    const rows = previewSheet(sheet, autoMapping(sheet.headers), subjects, []);
    expect(rows[0].task?.estimatedMinutes).toBe(45);
    expect(rows[1].task?.status).toBe('partial');
    expect(await commitImport(rows, database)).toEqual({ success: 2, failed: 0, skipped: 0 });
    expect(await commitImport(rows, database)).toEqual({ success: 0, failed: 0, skipped: 2 });
    const tasks = await database.tasks.toArray();
    expect(tasks.find((t) => t.title === '复习极限')?.rawImport?.['6:原始额外列']).toBe('保留我');
  });
  it('未知列允许用户映射，错误行不破坏原数据', async () => {
    await sampleTask(database);
    const unknown = { ...sheet, headers: ['A', 'B', 'C'], rows: [['错误日期', '数学一', '测试']] };
    const missing = previewSheet(unknown, {}, await database.subjects.toArray(), []);
    expect(missing[0].error).toContain('映射');
    const mapped = previewSheet(
      { ...unknown, rows: [['2026-11-01', '数学一', '测试']] },
      { date: 0, subject: 1, title: 2 },
      await database.subjects.toArray(),
      [],
    );
    expect(mapped[0].task?.title).toBe('测试');
    expect(await commitImport(missing, database)).toEqual({ success: 0, failed: 1, skipped: 0 });
    expect(await database.tasks.count()).toBe(1);
  });
  it('多个表共享去重集合；保留源标识，编辑后仍可安全重复导入', async () => {
    const seen = new Set<string>(),
      subjects = await database.subjects.toArray();
    const a = previewSheet(sheet, autoMapping(sheet.headers), subjects, [], seen);
    const b = previewSheet(
      { ...sheet, name: '重复表' },
      autoMapping(sheet.headers),
      subjects,
      [],
      seen,
    );
    expect(b.every((r) => r.duplicate)).toBe(true);
    await commitImport([...a, ...b], database);
    const t = await database.tasks.toCollection().first();
    await database.tasks.update(t!.id, { date: '2027-01-01', title: '修改后的任务' });
    expect((await commitImport(a, database)).success).toBe(0);
  });
  it('真实 .xlsx 文件支持多个表和日期单元格；损坏文件读取失败且不写库', async () => {
    const wb = new ExcelJS.Workbook();
    for (const name of ['基础', '强化']) {
      const ws = wb.addWorksheet(name);
      ws.addRow(['日期', '科目', '任务']);
      ws.addRow([new Date(Date.UTC(2026, 10, 1)), '数学一', '学习' + name]);
    }
    const bytes = await wb.xlsx.writeBuffer();
    const sheets = await readWorkbook(Uint8Array.from(new Uint8Array(bytes)).buffer);
    expect(sheets).toHaveLength(2);
    expect(sheets[0].rows[0][0]).toBe('2026-11-01');
    await expect(readWorkbook(new TextEncoder().encode('broken').buffer)).rejects.toThrow();
    expect(await database.tasks.count()).toBe(0);
  });
  it('事务中发生写入失败时整批导入回滚', async () => {
    await sampleTask(database);
    const rows = previewSheet(
      sheet,
      autoMapping(sheet.headers),
      await database.subjects.toArray(),
      [],
    );
    const fail = (_key: unknown, obj: { title: string }) => {
      if (obj.title === '数据结构基础') throw new Error('模拟磁盘写入失败');
    };
    database.tasks.hook('creating', fail);
    await expect(commitImport(rows, database)).rejects.toThrow('模拟');
    database.tasks.hook('creating').unsubscribe(fail);
    expect(await database.tasks.count()).toBe(1);
  });
});
