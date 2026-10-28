import { type Page } from '@playwright/test';
import { test, expect } from './fixtures';
import ExcelJS from 'exceljs';
import { readFile } from 'node:fs/promises';
const date = () => new Date().toLocaleDateString('en-CA');
async function open(page: Page, path = '/') {
  await page.goto(path);
  await expect(
    page.getByRole('heading', {
      name: path.startsWith('/settings')
        ? '个人设置'
        : path.startsWith('/plan')
          ? '学习计划'
          : '今日学习',
      exact: false,
    }),
  ).toBeVisible();
}
async function create(page: Page, title: string, minutes = 30) {
  await page.getByRole('button', { name: '新建任务', exact: true }).click();
  await page.getByLabel('任务名称', { exact: true }).fill(title);
  await page.getByLabel('预计时长（分钟）', { exact: true }).fill(String(minutes));
  await page.getByRole('button', { name: '保存任务', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}
test('创建、刷新和完成任务；导航、预算及布局', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await open(page);
  await expect(page.getByText('今天的学习，从这里开始')).toBeVisible();
  await create(page, '线性代数从基础开始', 100);
  await page.reload();
  await expect(page.getByRole('heading', { name: '线性代数从基础开始' })).toBeVisible();
  await expect(page.getByRole('alert').filter({ hasText: '超出时间预算' })).toBeVisible();
  await page.getByRole('button', { name: '完成 线性代数从基础开始', exact: true }).click();
  await expect(page.getByText('1 / 1 项任务已完成')).toBeVisible();
  await page.getByRole('button', { name: '编辑 线性代数从基础开始', exact: true }).click();
  await expect(page.getByLabel('学习日期', { exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({
    path: info.outputPath(`today-${info.project.name}.png`),
    fullPage: true,
  });
  await open(page, '/plan/');
  await page.getByRole('button', { name: '列表', exact: true }).click();
  await expect(page.getByRole('heading', { name: '线性代数从基础开始' })).toBeVisible();
  expect(errors).toEqual([]);
});
test('计时暂停、恢复、刷新保留且不重复累计', async ({ page }) => {
  await open(page);
  await page.clock.install();
  await create(page, '专注高数');
  await page.getByRole('button', { name: '开始学习', exact: true }).click();
  await page.clock.fastForward(5000);
  const seconds = (value: string) => value.split(':').reduce((n, v) => n * 60 + Number(v), 0);
  await expect
    .poll(async () => seconds(await page.getByTestId('timer-value').innerText()))
    .toBeGreaterThanOrEqual(5);
  await page.getByRole('button', { name: '暂停计时', exact: true }).click();
  await expect(page.getByRole('button', { name: '恢复计时', exact: true })).toBeVisible();
  const paused = await page.getByTestId('timer-value').innerText();
  await page.clock.fastForward(10000);
  await expect(page.getByTestId('timer-value')).toHaveText(paused);
  await page.reload();
  await expect(page.getByRole('button', { name: '恢复计时', exact: true })).toBeVisible();
  await expect(page.getByTestId('timer-value')).toHaveText(paused);
  await page.getByRole('button', { name: '恢复计时', exact: true }).click();
  await expect(page.getByRole('button', { name: '暂停计时', exact: true })).toBeVisible();
  await page.clock.fastForward(5000);
  await expect
    .poll(async () => seconds(await page.getByTestId('timer-value').innerText()))
    .toBeGreaterThanOrEqual(seconds(paused) + 5);
  await page.getByRole('button', { name: '结束计时', exact: true }).click();
  await expect(page.getByRole('region', { name: '学习计时器' })).toHaveCount(0);
  await page.getByRole('button', { name: '完成 专注高数', exact: true }).click();
  await expect(page.getByText('1 / 1 项任务已完成')).toBeVisible();
});
test('任务笔记、网课、部分完成及删除确认都有实际作用', async ({ page, context }) => {
  const description = '先复习定义，再完成基础练习并记录疑问。'.repeat(40);
  await open(page);
  await create(page, '笔记与练习任务');
  await page.getByRole('button', { name: '编辑 笔记与练习任务', exact: true }).click();
  await page.getByLabel('学习笔记', { exact: true }).fill('行列式展开仍需复习');
  await page.getByLabel('学习说明', { exact: true }).fill(description);
  await page.getByLabel('网课名称', { exact: true }).fill('用户自行填写的课程');
  await page
    .getByLabel('网课链接', { exact: true })
    .fill('https://example.com/star-study-test-course');
  await page.getByRole('button', { name: '保存任务', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: '查看 笔记与练习任务 详情', exact: true }).click();
  await expect(page.getByText('笔记：行列式展开仍需复习')).toBeVisible();
  await expect(page.getByText(`学习说明：${description}`, { exact: true })).toBeVisible();
  await page.getByLabel('笔记与练习任务 完成状态', { exact: true }).selectOption('partial');
  await expect(page.getByTestId('task-card').locator('.status-label')).toHaveText('部分完成');
  await context.route('https://example.com/star-study-test-course', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: '<h1>Test course</h1>' }),
  );
  const popup = page.waitForEvent('popup');
  await page.getByRole('link', { name: '打开网课', exact: true }).click();
  const course = await popup;
  await course.waitForLoadState();
  expect(course.url()).toBe('https://example.com/star-study-test-course');
  await course.close();
  await page.reload();
  await expect(page.getByTestId('task-card').locator('.status-label')).toHaveText('部分完成');
  await page.getByRole('button', { name: '编辑 笔记与练习任务', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '学习说明', exact: true })).toHaveValue(description);
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.getByRole('button', { name: '删除任务', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: '删除任务', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '笔记与练习任务', exact: true })).toHaveCount(0);
});
test('真实多工作表 Excel 预览、失败行与安全重复导入', async ({ page }) => {
  await open(page, '/settings/?tab=data');
  const wb = new ExcelJS.Workbook();
  let ws = wb.addWorksheet('数学');
  ws.addRow(['日期', '科目', '任务', '时长', '备注', '补充信息']);
  ws.addRow([date(), '数学一', 'Excel 导入极限', 40, '待复习', '原文']);
  ws.addRow(['错误日期', '数学一', '错误行', 20]);
  ws = wb.addWorksheet('专业课');
  ws.addRow(['日期', '科目', '任务', '时长']);
  ws.addRow([date(), '408', 'Excel 导入数据结构', 30]);
  const bytes = Buffer.from(await wb.xlsx.writeBuffer());
  const file = {
    name: '426天打卡.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: bytes,
  };
  await page.getByLabel('选择 Excel 文件', { exact: true }).setInputFiles(file);
  await expect(page.getByRole('button', { name: '确认导入 2 项任务' })).toBeEnabled();
  await page.getByRole('button', { name: '确认导入 2 项任务' }).click();
  await expect(
    page.getByText('导入完成：成功 2 项，失败 1 项，跳过 0 项。已有任务未被覆盖。'),
  ).toBeVisible();
  await page.getByLabel('选择 Excel 文件', { exact: true }).setInputFiles(file);
  await expect(page.getByRole('button', { name: '确认导入 0 项任务' })).toBeDisabled();
  await open(page, '/');
  await expect(page.getByRole('heading', { name: 'Excel 导入极限' })).toHaveCount(1);
  await expect(page.getByRole('heading', { name: 'Excel 导入数据结构' })).toHaveCount(1);
});
test('备份下载、恢复前预览及恢复前快照', async ({ page }, info) => {
  await open(page);
  await create(page, '备份里的任务');
  await open(page, '/settings/?tab=data');
  const event = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载完整备份', exact: true }).click();
  const download = await event;
  const file = info.outputPath('星研-备份.json');
  await download.saveAs(file);
  const json = JSON.parse(await readFile(file, 'utf8'));
  expect(json.app).toBe('星研');
  expect(json.data.tasks).toHaveLength(1);
  await open(page);
  await create(page, '恢复前的新任务');
  await open(page, '/settings/?tab=data');
  await page.getByLabel('选择 JSON 备份', { exact: true }).setInputFiles(file);
  await expect(page.getByRole('heading', { name: '恢复预览', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '确认恢复', exact: true })).toBeDisabled();
  await page.getByLabel('我已检查预览，确认用该备份替换当前数据。', { exact: true }).check();
  await page.getByRole('button', { name: '确认恢复', exact: true }).click();
  await expect(page.getByText('恢复成功；恢复前快照已保留')).toBeVisible();
  const beforeEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载恢复前快照', exact: true }).click();
  const beforeFile = info.outputPath('before.json');
  await (await beforeEvent).saveAs(beforeFile);
  expect(JSON.parse(await readFile(beforeFile, 'utf8')).data.tasks).toHaveLength(2);
  await open(page);
  await expect(page.getByRole('heading', { name: '备份里的任务' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '恢复前的新任务' })).toHaveCount(0);
});
test('手动调整日期必须确认，取消不写库，拆分保持总时长', async ({ page }) => {
  await open(page);
  await create(page, '待调整任务', 40);
  await open(page, '/plan/');
  await page.getByRole('button', { name: '列表', exact: true }).click();
  await page.getByLabel('选择 待调整任务', { exact: true }).check();
  await page.getByRole('button', { name: '调整日期（1）', exact: true }).click();
  await page.getByLabel('新的学习日期', { exact: true }).fill('2027-05-01');
  await page.getByRole('button', { name: '取消调整', exact: true }).click();
  await expect(page.getByRole('heading', { name: '待调整任务', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '调整日期（1）', exact: true }).click();
  await page.getByLabel('新的学习日期', { exact: true }).fill('2027-05-01');
  await page.getByRole('button', { name: '确认调整', exact: true }).click();
  await expect(page.getByRole('heading', { name: '2027-05-01', exact: true })).toBeVisible();
  await page.getByLabel('选择 待调整任务', { exact: true }).check();
  await page.getByRole('button', { name: '拆分任务', exact: true }).click();
  await page.getByLabel('第一部分时长（分钟）', { exact: true }).fill('15');
  await page.getByRole('button', { name: '确认拆分', exact: true }).click();
  await expect(page.getByRole('heading', { name: '待调整任务（续）', exact: true })).toBeVisible();
  await expect(page.getByText('当前显示 2 项任务 · 40 分钟')).toBeVisible();
});
test('更换考试科目保留历史任务并提示重规划；深色主题可保存', async ({ page }) => {
  await open(page);
  await create(page, '旧数学一学习记录');
  await open(page, '/settings/');
  await page.getByLabel('数学', { exact: true }).fill('数学二');
  await page.getByLabel('应用主题', { exact: true }).selectOption('dark');
  await page.getByRole('button', { name: '保存设置', exact: true }).click();
  await expect(page.getByText(/有 1 项未完成任务关联历史科目/)).toBeVisible();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await open(page);
  await expect(page.getByRole('heading', { name: '旧数学一学习记录' })).toBeVisible();
  await expect(page.getByTestId('task-card').getByText('数学一', { exact: true })).toBeVisible();
});
test('生产 Service Worker 支持离线冷刷新、创建任务和打卡', async ({ page, context }) => {
  await open(page);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByText('当前离线 · 本地任务可以正常查看和修改')).toBeVisible();
  await create(page, '离线学习任务');
  await page.getByRole('button', { name: '完成 离线学习任务', exact: true }).click();
  await expect(page.getByText('1 / 1 项任务已完成')).toBeVisible();
  await page.reload();
  await expect(page.getByText('1 / 1 项任务已完成')).toBeVisible();
  await page.locator('a[href="/plan/"]:visible').first().click();
  await expect(page.getByRole('heading', { name: '学习计划', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '列表', exact: true }).click();
  await expect(page.getByRole('heading', { name: '离线学习任务' })).toBeVisible();
  await context.setOffline(false);
  await open(page);
  await expect(page.getByRole('heading', { name: '离线学习任务' })).toBeVisible();
});
test('关闭浏览器上下文后重新打开同一持久化目录保留任务', async ({
  browserName,
  playwright,
}, info) => {
  test.skip(
    browserName !== 'chromium' || info.project.name !== 'chromium',
    '独立持久化浏览器测试只运行一次',
  );
  const userData = info.outputPath('persistent-profile');
  let context = await playwright.chromium.launchPersistentContext(userData, {
    headless: true,
    viewport: { width: 1440, height: 1000 },
  });
  let page = context.pages()[0];
  await open(page);
  await create(page, '关闭后继续的任务');
  await context.close();
  context = await playwright.chromium.launchPersistentContext(userData, { headless: true });
  page = context.pages()[0];
  await open(page);
  await expect(page.getByRole('heading', { name: '关闭后继续的任务' })).toBeVisible();
  await context.close();
});
