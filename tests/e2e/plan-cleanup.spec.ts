import { type Page } from '@playwright/test';
import { test, expect } from './fixtures';
import ExcelJS from 'exceljs';
import type { PlanRevision, StudyTask } from '../../src/types';

async function openPlan(page: Page) {
  await page.goto('/plan/');
  await expect(page.getByRole('heading', { name: '学习计划', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '列表', exact: true }).click();
}
async function create(page: Page, title: string, date: string, subject = '数学一') {
  await page.getByRole('button', { name: '新建任务', exact: true }).click();
  await page.getByLabel('任务名称', { exact: true }).fill(title);
  await page.getByLabel('任务科目', { exact: true }).selectOption({ label: subject });
  await page.getByLabel('学习日期', { exact: true }).fill(date);
  await page.getByLabel('预计时长（分钟）', { exact: true }).fill('10');
  await page.getByRole('button', { name: '保存任务', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}
async function snapshot(page: Page) {
  return page.evaluate(
    () =>
      new Promise<{ tasks: StudyTask[]; revisions: PlanRevision[] }>((resolve, reject) => {
        const opening = indexedDB.open('star-study');
        opening.onerror = () => reject(opening.error);
        opening.onsuccess = () => {
          const database = opening.result;
          const transaction = database.transaction(['tasks', 'revisions'], 'readonly');
          const tasks = transaction.objectStore('tasks').getAll();
          const revisions = transaction.objectStore('revisions').getAll();
          transaction.oncomplete = () => {
            database.close();
            resolve({ tasks: tasks.result, revisions: revisions.result });
          };
          transaction.onerror = () => {
            database.close();
            reject(transaction.error);
          };
        };
      }),
  );
}
async function workbook(date: string, rows: [string, string][]) {
  const book = new ExcelJS.Workbook(),
    sheet = book.addWorksheet('学习计划');
  sheet.addRow(['日期', '科目', '任务', '时长']);
  for (const [subject, title] of rows) sheet.addRow([date, subject, title, 10]);
  return {
    name: '清空与重导合成测试.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from(await book.xlsx.writeBuffer()),
  };
}

test('清空先预览且取消不写，范围与完成记录保护，切页后仍可预览撤销', async ({ page }, info) => {
  await openPlan(page);
  const today = await page.evaluate(() => new Date().toLocaleDateString('en-CA'));
  const tomorrow = new Date(Date.parse(`${today}T12:00:00`) + 86400000).toLocaleDateString('en-CA');
  await create(page, '待清空的数学任务', today);
  await create(page, '已完成的数学任务', today);
  await create(page, '另一科目的任务', today, '英语一');
  await create(page, '范围外的数学任务', tomorrow);
  await page.getByRole('button', { name: '完成 已完成的数学任务', exact: true }).click();
  await expect(
    page.getByRole('button', { name: '将 已完成的数学任务 设为未完成', exact: true }),
  ).toBeVisible();
  await expect
    .poll(
      async () =>
        (await snapshot(page)).tasks.find((task) => task.title === '已完成的数学任务')?.status,
    )
    .toBe('completed');
  const before = await snapshot(page);
  await page.getByRole('button', { name: '清空计划', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('status')).toContainText(
    '可清空 3 项 · 受保护 1 项',
  );
  await page.getByRole('button', { name: '取消清空', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await snapshot(page)).toEqual(before);

  await page.getByRole('button', { name: '清空计划', exact: true }).click();
  await page.getByLabel('清空范围', { exact: true }).selectOption('range');
  await page.getByLabel('清空开始日期', { exact: true }).fill(today);
  await page.getByLabel('清空结束日期', { exact: true }).fill('');
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText(
    '有效的开始日期和结束日期',
  );
  await expect(page.getByRole('button', { name: '确认清空 0 项', exact: true })).toBeDisabled();
  await page.getByLabel('清空结束日期', { exact: true }).fill(today);
  await page.getByLabel('清空科目', { exact: true }).selectOption({ label: '数学一' });
  await expect(page.getByRole('dialog').getByRole('status')).toContainText(
    '可清空 1 项 · 受保护 1 项',
  );
  await expect(page.getByRole('region', { name: '清空时保留的任务' })).toContainText(
    '已完成的数学任务',
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('plan-cleanup-preview.png'), fullPage: true });
  await page.getByRole('button', { name: '确认清空 1 项', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '待清空的数学任务', exact: true })).toHaveCount(0);
  for (const title of ['已完成的数学任务', '另一科目的任务', '范围外的数学任务'])
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
  const cleared = await snapshot(page);
  expect(cleared.tasks).toHaveLength(before.tasks.length);
  expect(cleared.tasks.filter((task) => task.deletedAt)).toHaveLength(1);
  expect(cleared.revisions).toHaveLength(before.revisions.length + 1);

  await page.getByRole('link', { name: '导入 Excel', exact: true }).click();
  await expect(page.getByRole('heading', { name: '个人设置', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '撤销清空', exact: true }).click();
  await expect(page.getByRole('heading', { name: '计划调整预览', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '确认调整', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '待清空的数学任务', exact: true })).toBeVisible();
  const restored = await snapshot(page);
  expect(restored.tasks.filter((task) => task.deletedAt)).toHaveLength(0);
  expect(restored.tasks.map((task) => task.id).sort()).toEqual(
    before.tasks.map((task) => task.id).sort(),
  );
  expect(restored.tasks.find((task) => task.title === '已完成的数学任务')?.status).toBe(
    'completed',
  );
});

test('Excel追加与日期重叠说明清晰，清空后同份文件重导恢复原任务且不会叠加', async ({ page }) => {
  await page.goto('/settings/?tab=data');
  await expect(
    page.getByRole('heading', { name: '导入考研打卡 Excel', exact: true }),
  ).toBeVisible();
  await expect(page.getByText('Excel采用追加导入', { exact: false })).toBeVisible();
  const today = await page.evaluate(() => new Date().toLocaleDateString('en-CA'));
  const file = await workbook(today, [
    ['数学一', 'Excel数学基础'],
    ['英语一', 'Excel英语阅读'],
  ]);
  await page.getByLabel('选择 Excel 文件', { exact: true }).setInputFiles(file);
  await page.getByRole('button', { name: '确认导入 2 项任务', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: '导入完成：成功 2 项' })).toBeVisible();
  const initial = await snapshot(page);
  await page.getByLabel('选择 Excel 文件', { exact: true }).setInputFiles(file);
  await expect(page.getByRole('button', { name: '确认导入 0 项任务', exact: true })).toBeDisabled();
  expect((await snapshot(page)).tasks).toHaveLength(2);

  const overlapping = await workbook(today, [['数学一', '同日另一项新任务']]);
  await page.getByLabel('选择 Excel 文件', { exact: true }).setInputFiles(overlapping);
  await expect(page.getByRole('region', { name: '导入日期重叠提醒' })).toContainText(
    `${today}：旧任务 2 项`,
  );
  await page.getByRole('link', { name: '先预览清空旧计划', exact: true }).click();
  await expect(page.getByRole('heading', { name: '清空学习计划', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '确认清空 2 项', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '确认清空 2 项', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect((await snapshot(page)).tasks.filter((task) => !task.deletedAt)).toHaveLength(0);

  await page.getByRole('link', { name: '导入 Excel', exact: true }).click();
  await page.getByLabel('选择 Excel 文件', { exact: true }).setInputFiles(file);
  await page.getByRole('button', { name: '确认导入 2 项任务', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: '导入完成' })).toBeVisible();
  const importedAgain = await snapshot(page);
  expect(importedAgain.tasks.filter((task) => !task.deletedAt)).toHaveLength(2);
  expect(importedAgain.tasks).toHaveLength(2);
  expect(importedAgain.tasks.map((task) => task.id).sort()).toEqual(
    initial.tasks.map((task) => task.id).sort(),
  );
  await page.getByLabel('选择 Excel 文件', { exact: true }).setInputFiles(file);
  await expect(page.getByRole('button', { name: '确认导入 0 项任务', exact: true })).toBeDisabled();
  expect((await snapshot(page)).tasks).toHaveLength(2);
});
