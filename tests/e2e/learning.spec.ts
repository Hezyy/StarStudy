import { type Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { readFile } from 'node:fs/promises';
import { addDays, format } from 'date-fns';
import { version as appVersion } from '../../package.json';
const today = () => format(new Date(), 'yyyy-MM-dd');
async function go(page: Page, path: string, title: string) {
  await page.goto(path);
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
}
async function task(page: Page, title: string, minutes = 30) {
  await go(page, '/', '今日学习');
  await page.getByRole('button', { name: '新建任务', exact: true }).click();
  await page.getByLabel('任务名称', { exact: true }).fill(title);
  await page.getByLabel('预计时长（分钟）', { exact: true }).fill(String(minutes));
  await page.getByRole('button', { name: '保存任务', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}
async function knowledge(page: Page) {
  await go(page, '/knowledge/', '知识点管理');
  await page.getByRole('button', { name: '新建知识点', exact: true }).click();
  await page.getByLabel('知识点名称', { exact: true }).fill('行列式展开');
  await page.getByLabel('知识点掌握程度', { exact: true }).selectOption('weak');
  await page.getByLabel('章节', { exact: true }).fill('线性代数');
  await page.getByRole('button', { name: '保存知识点', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}
test('知识点与错题图片持久化、备份恢复、复习结果、任务转换和归档', async ({ page }, info) => {
  await knowledge(page);
  await go(page, '/mistakes/', '错题本');
  await page.getByRole('button', { name: '新建错题', exact: true }).click();
  await page.getByLabel('题目', { exact: true }).fill('如何按第一行展开三阶行列式？');
  await page.getByLabel('我的答案', { exact: true }).fill('符号全部为正');
  await page.getByLabel('正确答案', { exact: true }).fill('符号依次为正负正');
  await page.getByLabel('错误原因', { exact: true }).fill('余子式符号错误');
  await page.getByLabel('解析', { exact: true }).fill('按代数余子式定义展开');
  await page
    .getByLabel('关联知识点', { exact: true })
    .selectOption({ label: '线性代数 / 行列式展开' });
  await page.getByLabel('上传错题图片', { exact: true }).setInputFiles('public/icons/icon-192.png');
  await page.getByRole('button', { name: '保存错题', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.reload();
  await page.getByRole('button', { name: '查看错题', exact: true }).click();
  const img = page.getByRole('img', { name: '错题图片 1', exact: true });
  await expect(img).toBeVisible();
  await expect
    .poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth))
    .toBeGreaterThan(0);
  await expect(page.getByText('按代数余子式定义展开', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
  await go(page, '/settings/?tab=data', '个人设置');
  const backupEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载完整备份', exact: true }).click();
  const backupPath = info.outputPath('image-backup.json');
  await (await backupEvent).saveAs(backupPath);
  const backup = JSON.parse(await readFile(backupPath, 'utf8'));
  expect(backup.data.mistakes).toHaveLength(1);
  expect(backup.data.mistakes[0].images).toHaveLength(1);
  await page.getByLabel('选择 JSON 备份', { exact: true }).setInputFiles(backupPath);
  await page.getByLabel('我已检查预览，确认用该备份替换当前数据。', { exact: true }).check();
  await page.getByRole('button', { name: '确认恢复', exact: true }).click();
  await expect(page.getByText('恢复成功；恢复前快照已保留')).toBeVisible();
  await go(page, '/mistakes/', '错题本');
  await page.reload();
  await page.getByRole('button', { name: '查看错题', exact: true }).click();
  await expect
    .poll(() =>
      page
        .getByRole('img', { name: '错题图片 1', exact: true })
        .evaluate((el: HTMLImageElement) => el.naturalWidth),
    )
    .toBe(192);
  await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
  await page.getByRole('button', { name: '记录复习', exact: true }).click();
  await page.getByLabel('本次掌握程度', { exact: true }).selectOption('basic');
  await page.getByLabel('复习记录', { exact: true }).fill('重新做对，但还要巩固');
  await page.getByRole('button', { name: '保存复习结果', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText(/复习 1 次/)).toBeVisible();
  await page.getByRole('button', { name: '转为学习任务', exact: true }).click();
  await page.getByRole('button', { name: '创建复习任务', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await go(page, '/', '今日学习');
  await expect(page.getByRole('heading', { name: /错题复习：如何按第一行/ })).toBeVisible();
  await go(page, '/knowledge/', '知识点管理');
  await expect(page.locator('.record-card .mastery')).toHaveText('薄弱');
  await go(page, '/mistakes/', '错题本');
  await page.getByRole('button', { name: '归档', exact: true }).click();
  await page.getByLabel('复习日期筛选', { exact: true }).selectOption('archived');
  await expect(page.getByRole('button', { name: '恢复错题', exact: true })).toBeVisible();
});
test('资料真实CRUD、进度与任务关联', async ({ page }) => {
  await task(page, '课程关联目标');
  await go(page, '/resources/', '学习资料');
  await page.getByRole('button', { name: '新建学习资料', exact: true }).click();
  await page.getByLabel('资料名称', { exact: true }).fill('我的线代课程');
  await page.getByLabel('章节', { exact: true }).fill('线性代数');
  await page.getByLabel('学习进度（%）', { exact: true }).fill('25');
  await page.getByRole('button', { name: '保存学习资料', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('heading', { name: '我的线代课程', exact: true })).toBeVisible();
  await expect(page.getByText(/进度 25%/)).toBeVisible();
  await page.getByRole('button', { name: '关联已有任务', exact: true }).click();
  await page
    .getByLabel('资料关联任务', { exact: true })
    .selectOption({ label: `${today()} 课程关联目标` });
  await page.getByRole('button', { name: '保存关联', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('关联任务：课程关联目标', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '创建课程任务', exact: true }).click();
  await page.getByRole('button', { name: '创建学习任务', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await go(page, '/', '今日学习');
  await expect(page.getByRole('heading', { name: '我的线代课程', exact: true })).toBeVisible();
});
test('周复盘保存历史与统计读取实际计时', async ({ page }, info) => {
  await task(page, '周复盘学习任务');
  await page.clock.install();
  await page.getByRole('button', { name: '开始学习', exact: true }).click();
  await page.clock.fastForward(65000);
  await page.getByRole('button', { name: '结束计时', exact: true }).click();
  await expect(page.getByRole('region', { name: '学习计时器' })).toHaveCount(0);
  await go(page, '/reviews/', '每周复盘');
  await page.getByLabel('本周最大困难', { exact: true }).fill('学校考试，需要减少任务');
  await page.getByLabel('哪些知识点没听懂', { exact: true }).fill('矩阵秩');
  await page.getByLabel('下周一' + '分钟', { exact: true }).fill('30');
  await page.getByRole('button', { name: '保存周复盘', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: '周复盘已保存' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('textbox', { name: '本周最大困难', exact: true })).toHaveValue(
    '学校考试，需要减少任务',
  );
  await go(page, '/analytics/', '学习统计');
  const event = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出当前统计', exact: true }).click();
  const file = info.outputPath('statistics.json');
  await (await event).saveAs(file);
  const stats = JSON.parse(await readFile(file, 'utf8'));
  expect(stats.actual).toBeGreaterThan(1);
  expect(stats.subjects.reduce((n: number, s: { actual: number }) => n + s.actual, 0)).toBeCloseTo(
    stats.actual,
    4,
  );
});
test('排期缺口预览、取消、确认、版本撤销与预算恢复', async ({ page }) => {
  await task(page, '数学基础第一项', 60);
  await task(page, '数学基础第二项', 40);
  await go(page, '/planner/', '动态排期');
  const end = format(addDays(new Date(), 2), 'yyyy-MM-dd');
  await page.getByLabel('排期结束日期', { exact: true }).fill(end);
  await page.getByLabel('学校考试 / 假期使用特殊预算，确认方案时一起保存', { exact: true }).check();
  await page.getByLabel('特殊预算结束', { exact: true }).fill(end);
  await page.getByRole('button', { name: '生成排期预览', exact: true }).click();
  await expect(page.getByRole('heading', { name: '计划调整预览', exact: true })).toBeVisible();
  await expect(page.getByText(/无法安排/).first()).toBeVisible();
  await page.getByRole('button', { name: '取消调整', exact: true }).click();
  await page.getByRole('button', { name: '生成排期预览', exact: true }).click();
  await page.getByRole('button', { name: '确认调整', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(
    page.getByRole('status').filter({ hasText: '计划已确认应用，版本与原始学习记录已保留' }),
  ).toBeVisible();
  await page.getByRole('button', { name: '撤销上一次调整', exact: true }).click();
  await expect(page.getByRole('heading', { name: '计划调整预览', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '确认调整', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await go(page, '/plan/', '学习计划');
  await page.getByRole('button', { name: '列表', exact: true }).click();
  await expect(page.getByText('当前显示 2 项任务 · 100 分钟', { exact: true })).toBeVisible();
});
test('ChatGPT默认隐私与JSON方案校验、确认应用', async ({ page }, info) => {
  await task(page, '协作调整任务');
  await go(page, '/collaboration/', 'ChatGPT 协作中心');
  const reportEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 JSON 报告', exact: true }).click();
  const path = info.outputPath('report.json');
  await (await reportEvent).saveAs(path);
  const report = JSON.parse(await readFile(path, 'utf8'));
  expect(report.privacy).toEqual({ notes: false, mistakeText: false, images: false });
  const developmentEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出开发状态报告', exact: true }).click();
  const developmentPath = info.outputPath('development.json');
  await (await developmentEvent).saveAs(developmentPath);
  const development = JSON.parse(await readFile(developmentPath, 'utf8'));
  expect(development.version).toBe(appVersion);
  expect(development.knownIssues.length).toBeGreaterThan(0);
  expect(development.pending.length).toBeGreaterThan(0);
  expect(development.recentUpdates.length).toBeGreaterThan(0);
  await page.getByRole('button', { name: '载入当前任务模板', exact: true }).click();
  const file = JSON.parse(await page.getByLabel('调整方案内容', { exact: true }).inputValue());
  file.reason = '把该任务调整为20分钟';
  file.changes[0].plan.estimatedMinutes = 20;
  await page.getByLabel('调整方案内容', { exact: true }).fill(JSON.stringify(file));
  await page.getByRole('button', { name: '校验并预览方案', exact: true }).click();
  await expect(page.getByRole('heading', { name: '计划调整预览', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '确认调整', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await go(page, '/', '今日学习');
  await expect(page.getByText('预计 20 分钟', { exact: false })).toBeVisible();
});
test('所有新增页面移动布局与未配置服务状态', async ({ page }, info) => {
  const errors: string[] = [];
  const prefetches: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('request', (r) => {
    if (r.headers()['next-router-prefetch'] === '1') prefetches.push(r.url());
  });
  for (const [route, title] of [
    ['/knowledge/', '知识点管理'],
    ['/resources/', '学习资料'],
    ['/mistakes/', '错题本'],
    ['/reviews/', '每周复盘'],
    ['/analytics/', '学习统计'],
    ['/planner/', '动态排期'],
    ['/collaboration/', 'ChatGPT 协作中心'],
    ['/integrations/', '云同步与 AI'],
  ]) {
    await go(page, route, title);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    if (['/mistakes/', '/analytics/', '/planner/'].includes(route))
      await page.screenshot({
        path: info.outputPath(`${route.replaceAll('/', '')}-${info.project.name}.png`),
        fullPage: true,
      });
  }
  await expect(page.getByRole('button', { name: '登录账户', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: '请求服务端 AI', exact: true })).toBeDisabled();
  if (info.project.name === 'mobile' || info.project.name === 'webkit') {
    await page.getByRole('button', { name: '更多功能', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('dialog').getByRole('link', { name: '知识点管理', exact: true }).click();
    await expect(page.getByRole('heading', { name: '知识点管理', exact: true })).toBeVisible();
  }
  expect(errors).toEqual([]);
  expect(prefetches).toEqual([]);
});
test('用户原始426天宽表可在浏览器预览、确认导入与重复检测', async ({ page }) => {
  test.skip(!process.env.STAR_STUDY_SOURCE_XLSX, '原始私人附件未配置，此组合不执行');
  test.setTimeout(90000);
  await go(page, '/settings/?tab=data', '个人设置');
  await page
    .getByLabel('选择 Excel 文件', { exact: true })
    .setInputFiles(process.env.STAR_STUDY_SOURCE_XLSX!);
  await expect(
    page.getByRole('button', { name: '确认导入 1462 项任务', exact: true }),
  ).toBeEnabled();
  await expect(page.getByText('检测到每日多科目宽表', { exact: true })).toBeVisible({
    timeout: 60000,
  });
  await page.getByRole('button', { name: '确认导入 1462 项任务', exact: true }).click();
  await expect(
    page.getByText('导入完成：成功 1462 项，失败 0 项，跳过 0 项。已有任务未被覆盖。', {
      exact: true,
    }),
  ).toBeVisible({ timeout: 60000 });
  await page
    .getByLabel('选择 Excel 文件', { exact: true })
    .setInputFiles(process.env.STAR_STUDY_SOURCE_XLSX!);
  await expect(page.getByRole('button', { name: '确认导入 0 项任务', exact: true })).toBeDisabled();
  await go(page, '/plan/', '学习计划');
  await page.getByRole('button', { name: '下一周期', exact: true }).click();
  await page.getByRole('button', { name: '查看 2026-11-01 任务', exact: true }).click();
  await expect(page.getByTestId('task-card')).toHaveCount(3);
  await page.reload();
  await page.getByRole('button', { name: '列表', exact: true }).click();
  await expect(page.getByText(/共 1462 项 · 当前第 1\/30 页/)).toBeVisible();
  expect(await page.getByTestId('task-card').count()).toBeLessThanOrEqual(50);
});
