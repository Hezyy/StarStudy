import { type Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { addDays, format } from 'date-fns';
async function home(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '今日学习', exact: true })).toBeVisible();
}
async function create(page: Page, title: string, minutes = 30) {
  await page.getByRole('button', { name: '新建任务', exact: true }).click();
  await page.getByLabel('任务名称', { exact: true }).fill(title);
  await page.getByLabel('预计时长（分钟）', { exact: true }).fill(String(minutes));
  await page.getByRole('button', { name: '保存任务', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
}
test('任务完成轻量反馈与撤销，计数准确且任务位置稳定', async ({ page }, info) => {
  await home(page);
  await create(page, '安静地完成第一步');
  await create(page, '接着做第二步');
  await expect(page.getByTestId('task-card').locator('h3')).toHaveText([
    '安静地完成第一步',
    '接着做第二步',
  ]);
  const card = page
    .getByTestId('task-card')
    .filter({ has: page.getByRole('heading', { name: '安静地完成第一步', exact: true }) });
  await page
    .getByRole('button', { name: '完成 安静地完成第一步', exact: true })
    .evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
  const before = await card.evaluate((el) => ({
    top: el.getBoundingClientRect().top + scrollY,
    scroll: scrollY,
  }));
  const hit = await page
    .getByRole('button', { name: '完成 安静地完成第一步', exact: true })
    .boundingBox();
  // Direct pointer input tests layout stability without locator.click's WebKit auto-scroll.
  if (info.project.name === 'mobile' || info.project.name === 'webkit')
    await page.touchscreen.tap(hit!.x + hit!.width / 2, hit!.y + hit!.height / 2);
  else await page.mouse.click(hit!.x + hit!.width / 2, hit!.y + hit!.height / 2);
  await expect(page.getByRole('progressbar', { name: '今日任务完成率' })).toHaveAttribute(
    'aria-valuenow',
    '50',
  );
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(card).toHaveClass(/task-complete/);
  const after = await card.evaluate((el) => ({
    top: el.getBoundingClientRect().top + scrollY,
    scroll: scrollY,
  }));
  expect(Math.abs(after.top - before.top)).toBeLessThan(3);
  expect(after.scroll).toBe(before.scroll);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(page.getByText('0 / 2 项任务已完成', { exact: true })).toBeVisible();
  await expect(card).not.toHaveClass(/task-complete/);
  await expect(page.getByText('已撤销本次状态更改', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('task-card')).toHaveCount(2);
});
test('秒表只更新计时数字，主体不随每秒变化；结束后出现非模态总结', async ({ page }) => {
  await home(page);
  await create(page, '专注时保持页面安静');
  await page.clock.install();
  await page.getByRole('button', { name: '开始学习', exact: true }).click();
  await expect(page.getByRole('region', { name: '学习计时器' })).toBeVisible();
  await page.evaluate(() => {
    const root = document.querySelector('main')!;
    const w = window as unknown as { mainMutations: number; mainObserver: MutationObserver };
    w.mainMutations = 0;
    w.mainObserver = new MutationObserver((list) => {
      w.mainMutations += list.length;
    });
    w.mainObserver.observe(root, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
    });
  });
  await page.clock.fastForward(5000);
  await expect(page.getByTestId('timer-value')).not.toHaveText('00:00');
  expect(
    await page.evaluate(() => (window as unknown as { mainMutations: number }).mainMutations),
  ).toBe(0);
  await page.getByRole('button', { name: '暂停计时', exact: true }).click();
  const paused = await page.getByTestId('timer-value').innerText();
  await page.clock.fastForward(3000);
  await expect(page.getByTestId('timer-value')).toHaveText(paused);
  await page.getByRole('button', { name: '结束计时', exact: true }).click();
  await expect(page.getByRole('region', { name: '本次学习总结' })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: '标记完成', exact: true }).click();
  await expect(page.getByText('1 / 1 项任务已完成', { exact: true })).toBeVisible();
});
test('任务抽屉收起可选项、即时预算、Escape未保存保护和焦点返回', async ({ page }) => {
  await home(page);
  const trigger = page.getByRole('button', { name: '新建任务', exact: true });
  await trigger.click();
  await expect(page.getByLabel('任务名称', { exact: true })).toBeFocused();
  await expect(page.getByText('课程、练习与更多选项', { exact: false })).toBeVisible();
  await expect(page.getByLabel('网课名称', { exact: true })).not.toBeVisible();
  await page.getByLabel('任务名称', { exact: true }).fill('未保存的小目标');
  await page.getByLabel('预计时长（分钟）', { exact: true }).fill('150');
  await expect(page.getByRole('dialog').getByText(/超出预算/)).toBeVisible();
  page.once('dialog', (d) => d.dismiss());
  await page.keyboard.press('Escape');
  await expect(page.getByLabel('任务名称', { exact: true })).toHaveValue('未保存的小目标');
  page.once('dialog', (d) => d.accept());
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(trigger).toBeFocused();
});
test('客户端往返保留计划筛选和日期，不重新加载整个文档', async ({ page }) => {
  await home(page);
  await page.getByRole('link', { name: '全部计划', exact: true }).click();
  await expect(page.getByRole('heading', { name: '学习计划', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '列表', exact: true }).click();
  await page.getByLabel('计划状态筛选', { exact: true }).selectOption('partial');
  await page.evaluate(() => {
    (window as unknown as { navigationSentinel: boolean }).navigationSentinel = true;
  });
  await page.getByRole('link', { name: '今日学习', exact: true }).click();
  await expect(page.getByRole('heading', { name: '今日学习', exact: true })).toBeVisible();
  await page.getByRole('link', { name: '全部计划', exact: true }).click();
  await expect(page.getByLabel('计划状态筛选', { exact: true })).toHaveValue('partial');
  await expect(page.getByRole('button', { name: '列表', exact: true })).toHaveClass(/selected/);
  expect(
    await page.evaluate(
      () => (window as unknown as { navigationSentinel: boolean }).navigationSentinel,
    ),
  ).toBe(true);
});
test('减少动态效果关闭页面和任务过渡，键盘焦点清晰', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await home(page);
  await create(page, '减少动态效果下学习');
  expect(
    await page.locator('.route-scene').evaluate((el) => getComputedStyle(el).animationName),
  ).toBe('none');
  const button = page.getByRole('button', { name: '完成 减少动态效果下学习', exact: true });
  await page.keyboard.press('Tab');
  await button.focus();
  expect(await button.evaluate((el) => getComputedStyle(el).outlineStyle)).not.toBe('none');
  const transition = await button.evaluate((el) => getComputedStyle(el).transitionDuration);
  expect(transition.split(',').every((v) => parseFloat(v) < 0.001)).toBe(true);
  await button.press('Enter');
  await expect(page.getByText('1 / 1 项任务已完成', { exact: true })).toBeVisible();
});
test('笔记行内保存，无新增弹窗；移动与桌面主要区域不溢出', async ({ page }, info) => {
  await home(page);
  await create(page, '轻一点的笔记流程');
  const start = page.getByRole('button', { name: '开始学习', exact: true });
  await expect
    .poll(() =>
      start.evaluate((el) => {
        const r = el.getBoundingClientRect(),
          hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        return hit === el || el.contains(hit);
      }),
    )
    .toBe(true);
  await page.getByRole('button', { name: '查看 轻一点的笔记流程 详情', exact: true }).click();
  await page.getByRole('button', { name: '添加或编辑笔记', exact: true }).click();
  await page.getByLabel('快速学习笔记', { exact: true }).fill('明天继续复习矩阵的秩');
  await page.getByRole('button', { name: '保存笔记', exact: true }).click();
  await expect(page.getByText('笔记：明天继续复习矩阵的秩', { exact: true })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('today-experience.png'), fullPage: true });
  await page.getByRole('button', { name: '编辑 轻一点的笔记流程', exact: true }).click();
  const bounds = await page.getByRole('dialog').boundingBox(),
    viewport = page.viewportSize()!;
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(bounds!.height).toBeLessThanOrEqual(viewport.height);
  await page.screenshot({ path: info.outputPath('task-drawer.png') });
});
test('错题按到期顺序逐道复习，不重复打开列表', async ({ page }) => {
  await page.goto('/mistakes/');
  for (const question of ['第一道复习题', '第二道复习题']) {
    await page.getByRole('button', { name: '新建错题', exact: true }).click();
    await page.getByLabel('题目', { exact: true }).fill(question);
    await page.getByRole('button', { name: '保存错题', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  }
  await page.getByRole('button', { name: '开始今日复习', exact: true }).click();
  const first = await page.locator('.review-question').innerText();
  await page.getByRole('button', { name: '保存并继续下一道', exact: true }).click();
  await expect(page.locator('.review-question')).not.toHaveText(first);
  await page.getByRole('button', { name: '保存复习结果', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText(/今日到期 0 道/)).toBeVisible();
  await page.reload();
  await expect(page.getByText(/复习 1 次/)).toHaveCount(2);
});
test('桌面拖动显示目标区域，移动前必须预览确认', async ({ page }, info) => {
  test.skip(info.project.name !== 'chromium', '原生桌面拖动只测桌面；其他组已有改期替代流程验收');
  await home(page);
  await create(page, '拖到明天的任务');
  await page.getByRole('link', { name: '全部计划', exact: true }).click();
  const destination = format(addDays(new Date(), 1), 'yyyy-MM-dd');
  const source = page.locator('.calendar-task').filter({ hasText: '拖到明天的任务' });
  const target = page
    .getByRole('button', { name: `查看 ${destination} 任务`, exact: true })
    .locator('..');
  const from = await source.boundingBox(),
    to = await target.boundingBox();
  await page.mouse.move(from!.x + 10, from!.y + 8);
  await page.mouse.down();
  await page.mouse.move(from!.x + 20, from!.y + 14, { steps: 4 });
  await page.mouse.move(to!.x + 15, to!.y + 35, { steps: 8 });
  await page.mouse.move(to!.x + 20, to!.y + 40);
  await expect(target).toHaveClass(/drop-target/);
  await page.mouse.up();
  await expect(page.getByRole('heading', { name: '调整日期预览', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '取消调整', exact: true }).click();
  await expect(source).toBeVisible();
});

test('计时中误点完成明确报错，保留未完成状态并允许继续学习', async ({ page }) => {
  await home(page);
  await create(page, '先保留真实计时');
  await page.getByRole('button', { name: '开始学习', exact: true }).click();
  await expect(page.getByRole('region', { name: '学习计时器' })).toBeVisible();
  await page.getByRole('button', { name: '完成 先保留真实计时', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: '请先结束计时' })).toBeVisible();
  await expect(page.getByRole('progressbar', { name: '今日任务完成率' })).toHaveAttribute(
    'aria-valuenow',
    '0',
  );
  await expect(
    page.getByRole('button', { name: '完成 先保留真实计时', exact: true }),
  ).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('button', { name: '结束计时', exact: true }).click();
  await page.getByRole('button', { name: '完成 先保留真实计时', exact: true }).click();
  await expect(page.getByText('1 / 1 项任务已完成', { exact: true })).toBeVisible();
});
test('本地存储打开失败有真实错误与重试入口', async ({ page }) => {
  await page.addInitScript(() => {
    if (sessionStorage.getItem('test-storage-retry') !== '1') {
      sessionStorage.setItem('test-storage-retry', '1');
      indexedDB.open = () => {
        throw new DOMException('测试存储暂不可用', 'SecurityError');
      };
    }
  });
  await page.goto('/');
  await expect(page.getByRole('alert').filter({ hasText: '本地数据库无法打开' })).toBeVisible();
  await page.getByRole('button', { name: '重新打开', exact: true }).click();
  await expect(page.getByRole('heading', { name: '今日学习', exact: true })).toBeVisible();
  await expect(page.getByText('今天的学习，从这里开始')).toBeVisible();
});
