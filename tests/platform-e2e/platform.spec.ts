import {
  devices,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Page,
  type TestInfo,
} from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync } from 'node:fs';
import path from 'node:path';
import { test, expect } from '../e2e/fixtures';
import example from '../../public/templates/study-plan.minimal.json';
let admin: { csrf: string; id: string; cookie: string };
async function api(request: APIRequestContext, path: string, method = 'GET', data?: unknown) {
  return request.fetch(`/api/platform${path}`, {
    method,
    headers: {
      Origin: 'http://127.0.0.1:3011',
      'Content-Type': 'application/json',
      ...(admin
        ? { 'X-CSRF-Token': admin.csrf, 'X-Star-Study-Account': admin.id, Cookie: admin.cookie }
        : {}),
    },
    ...(data === undefined ? {} : { data }),
  });
}
test.beforeAll(async ({ request }) => {
  const status = await (await request.get('/api/platform/status')).json();
  const path = status.setupRequired ? '/setup' : '/login';
  const res = await api(request, path, 'POST', {
    email: 'platform-admin@example.test',
    name: 'Admin',
    password: 'browser-test-only-password',
    ...(status.setupRequired ? { setupToken: 'isolated-browser-setup-only' } : {}),
  });
  expect(res.ok(), await res.text()).toBe(true);
  const auth = await res.json();
  admin = { csrf: auth.csrf, id: auth.user.id, cookie: res.headers()['set-cookie'].split(';')[0] };
});
async function newAccount(page: Page, request: APIRequestContext) {
  const email = `learner-${Date.now()}-${Math.random().toString(16).slice(2)}@example.test`;
  const invite = await (await api(request, '/admin/invite', 'POST', {})).json();
  await page.goto('/');
  await page.getByRole('button', { name: '有邀请码？注册账户' }).click();
  await page.getByLabel('昵称', { exact: true }).fill('独立学习者');
  await page.getByLabel('邮箱', { exact: true }).fill(email);
  await page.getByLabel('密码（至少12位）', { exact: true }).fill('browser-test-only-password');
  await page.getByLabel('邀请码', { exact: true }).fill(invite.code);
  await page.getByRole('button', { name: '注册并登录', exact: true }).click();
  await expect(page.getByRole('heading', { name: '先找到适合自己的节奏' })).toBeVisible();
  await page.getByLabel('目标院校', { exact: true }).fill('自己的目标院校');
  await page.getByLabel('目标专业', { exact: true }).fill('自己的专业');
  await page.getByRole('button', { name: '保存，进入学习空间', exact: true }).click();
  await expect(page.getByRole('heading', { name: /^今日学习/ })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: '账户数据已同步' })).toBeVisible();
  return { email };
}
async function create(page: Page, title: string) {
  await page.getByRole('button', { name: '新建任务', exact: true }).click();
  await page.getByLabel('任务名称', { exact: true }).fill(title);
  await page.getByRole('button', { name: '保存任务', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}
async function secondDevice(
  browser: Browser,
  current: BrowserContext,
  info: TestInfo,
  email: string,
) {
  if (browser.browserType().name() !== 'webkit')
    return browser.newContext({
      storageState: await current.storageState(),
      viewport: { width: 375, height: 812 },
    });
  const root = path.join(info.project.outputDir, '.webkit-profiles');
  mkdirSync(root, { recursive: true });
  const id = createHash('sha256').update(info.testId).digest('hex').slice(0, 16);
  const profile = mkdtempSync(path.join(root, `device-${id}-`));
  const device = await browser.browserType().launchPersistentContext(profile, {
    ...devices['iPhone 13'],
    viewport: { width: 375, height: 812 },
    baseURL: 'http://127.0.0.1:3011',
    headless: true,
  });
  try {
    // Preserve the initial blank page: GTK WebKit exits when its final persistent
    // page closes, including between this real login and the caller's new page.
    const login = await device.newPage();
    await login.goto('/');
    await login.getByLabel('邮箱', { exact: true }).fill(email);
    await login.getByLabel('密码（至少12位）', { exact: true }).fill('browser-test-only-password');
    await login.getByRole('button', { name: '登录', exact: true }).click();
    await expect(login.getByRole('heading', { name: /^今日学习/ })).toBeVisible();
    await login.close();
    return device;
  } catch (cause) {
    await device.close();
    throw cause;
  }
}
test('新用户个性化、真实任务自动同步、第二设备读取、离线修改与恢复', async ({
  page,
  context,
  browser,
  request,
}, info) => {
  const account = await newAccount(page, request);
  await create(page, '本账户独立任务');
  await expect(page.getByRole('heading', { name: '本账户独立任务' })).toBeVisible();
  await expect
    .poll(async () => {
      const r = await context.request.get('/api/platform/data');
      const d = await r.json();
      return d.backup.data.tasks.length;
    })
    .toBe(1);
  const device = await secondDevice(browser, context, info, account.email);
  const second = await device.newPage();
  await second.goto('/');
  await expect(second.getByRole('heading', { name: '本账户独立任务' })).toBeVisible();
  await second.getByRole('button', { name: '完成 本账户独立任务', exact: true }).click();
  await expect
    .poll(async () => {
      const d = await (await device.request.get('/api/platform/data')).json();
      return d.backup.data.tasks[0].status;
    })
    .toBe('completed');
  await device.close();
  await page.reload();
  await expect(page.getByRole('button', { name: '将 本账户独立任务 设为未完成' })).toBeVisible();
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: /^今日学习/ })).toBeVisible();
  await create(page, '离线账户任务');
  await context.setOffline(false);
  await expect
    .poll(async () => {
      const d = await (await context.request.get('/api/platform/data')).json();
      return d.backup.data.tasks.length;
    })
    .toBe(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('account-today.png'), fullPage: true });
});
test('AI向导预览、确认、重复导入；无密钥状态；移动表单不溢出', async ({ page, request }, info) => {
  await newAccount(page, request);
  await page.goto('/plan/import-ai/');
  await page.getByRole('button', { name: '生成提示词', exact: true }).click();
  await expect(page.getByLabel('AI提示词')).toHaveValue(/StarStudy Plan Schema/);
  await page.getByRole('button', { name: '已取得计划，开始导入' }).click();
  await page
    .getByLabel('计划内容', { exact: true })
    .fill('```json\n' + JSON.stringify(example) + '\n```');
  await page.getByRole('button', { name: '校验并预览' }).click();
  await expect(page.getByRole('heading', { name: example.planName })).toBeVisible();
  await expect(page.getByText('将新增 1 项', { exact: false })).toBeVisible();
  await page.screenshot({ path: info.outputPath('import-preview.png'), fullPage: true });
  await page.getByRole('button', { name: '确认导入', exact: true }).click();
  await expect(page.getByRole('heading', { name: '计划已准备好，开始今天的一小步' })).toBeVisible();
  await page.goto('/integrations/');
  await expect(page.getByRole('heading', { name: 'AI与账户同步' })).toBeVisible();
  await expect(page.getByRole('button', { name: '发送并获取建议' })).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('账户备份恢复需要确认，替换后同步一致；丢失光标可以明确选择服务器副本', async ({
  page,
  context,
  request,
}) => {
  await newAccount(page, request);
  await create(page, '恢复时保留的任务');
  await expect
    .poll(async () => {
      const d = await (await context.request.get('/api/platform/data')).json();
      return d.backup.data.tasks.length;
    })
    .toBe(1);
  const snapshot = await (await context.request.get('/api/platform/data')).json();
  await create(page, '恢复时经确认移除的任务');
  await page.getByRole('button', { name: '完成 恢复时经确认移除的任务', exact: true }).click();
  await expect
    .poll(async () => {
      const d = await (await context.request.get('/api/platform/data')).json();
      return d.backup.data.tasks.filter((t: { status: string }) => t.status === 'completed').length;
    })
    .toBe(1);
  await page.goto('/account/');
  await page.getByLabel('选择 JSON 备份', { exact: true }).setInputFiles({
    name: 'synthetic-backup.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(snapshot.backup)),
  });
  await expect(page.getByRole('heading', { name: '恢复预览', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '确认恢复', exact: true })).toBeDisabled();
  expect(
    (await (await context.request.get('/api/platform/data')).json()).backup.data.tasks,
  ).toHaveLength(2);
  await page.getByRole('checkbox', { name: '我已检查预览，确认用该备份替换当前数据。' }).check();
  await page.getByRole('button', { name: '确认恢复', exact: true }).click();
  await expect(page.getByRole('heading', { name: '恢复预览', exact: true })).toHaveCount(0);
  await expect
    .poll(async () => {
      const d = await (await context.request.get('/api/platform/data')).json();
      return d.backup.data.tasks.length;
    })
    .toBe(1);
  const auth = await (await context.request.get('/api/platform/session')).json();
  await page.evaluate((id) => localStorage.removeItem(`star-sync:${id}`), auth.user.id);
  await page.reload();
  await expect(page.getByRole('status').filter({ hasText: '缓存缺少同步基线' })).toBeVisible();
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: '使用服务器版本', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: '账户数据已同步' })).toBeVisible();
});

test.describe('同步并发确认', () => {
  // Hold a real API response to deterministically exercise the in-flight queue.
  // Actual Service Worker cold/offline operation is covered by the first test.
  test.use({ serviceWorkers: 'block' });
  test('两设备各自修改时保留本机、预览冲突并在确认后采用服务器数据', async ({
    page,
    context,
    browser,
    request,
  }, info) => {
    const account = await newAccount(page, request);
    await create(page, '共同的起点');
    await expect
      .poll(async () => {
        const d = await (await context.request.get('/api/platform/data')).json();
        return d.backup.data.tasks.length;
      })
      .toBe(1);
    const device = await secondDevice(browser, context, info, account.email);
    const second = await device.newPage();
    await second.goto('/');
    await expect(second.getByRole('heading', { name: '共同的起点' })).toBeVisible();
    await context.setOffline(true);
    await create(page, '本机离线新增');
    await create(second, '另一设备新增');
    await expect
      .poll(async () => {
        const d = await (await device.request.get('/api/platform/data')).json();
        return d.backup.data.tasks.length;
      })
      .toBe(2);
    await context.setOffline(false);
    await expect(page.getByRole('status').filter({ hasText: '另一设备也有修改' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '本机离线新增' })).toBeVisible();
    const saved = page.waitForEvent('download');
    await page.getByRole('button', { name: '导出本机副本', exact: true }).click();
    expect((await saved).suggestedFilename()).toContain('同步冲突本机副本');
    let releaseVersion!: () => void;
    const versionReady = new Promise<void>((resolve) => {
      releaseVersion = resolve;
    });
    let heldVersion = false;
    await page.route('**/api/platform/data/version', async (route) => {
      if (heldVersion) {
        await route.continue();
        return;
      }
      const response = await route.fetch();
      heldVersion = true;
      await versionReady;
      await route.fulfill({ response });
    });
    let remoteApplied = false;
    page.on('response', (response) => {
      if (
        response.url().endsWith('/api/platform/data') &&
        response.request().method() === 'GET' &&
        response.ok()
      )
        remoteApplied = true;
    });
    try {
      await page.evaluate(() => {
        window.dispatchEvent(new Event('star-study:sync'));
      });
      await expect
        .poll(() => heldVersion, { message: '后台同步应停留在已发起的版本检查' })
        .toBe(true);
      page.once('dialog', (dialog) => dialog.accept());
      await page.getByRole('button', { name: '使用服务器版本', exact: true }).click();
      await expect(
        page.getByRole('button', { name: '使用服务器版本', exact: true }),
      ).toHaveAttribute('aria-busy', 'true');
      await expect(page.getByRole('status').filter({ hasText: /等待|排队/ })).toBeVisible();
      await create(page, '等待确认期间新增');
    } finally {
      releaseVersion();
    }
    await expect(
      page.getByRole('status').filter({ hasText: '等待同步期间本机数据变化' }),
    ).toBeVisible();
    await expect(page.getByRole('heading', { name: '等待确认期间新增' })).toBeVisible();
    expect(remoteApplied).toBe(false);
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: '使用服务器版本', exact: true }).click();
    await expect
      .poll(() => remoteApplied, { message: '重新确认后必须读取真实服务器副本' })
      .toBe(true);
    await expect(page.getByRole('heading', { name: '另一设备新增' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '本机离线新增' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: '等待确认期间新增' })).toHaveCount(0);
    await device.close();
  });
});

test('切换账户隔离筛选上下文，重新登录本人账户恢复原筛选', async ({ page, request }) => {
  const first = await newAccount(page, request);
  await page.goto('/resources/');
  await page.getByLabel('搜索资料', { exact: true }).fill('仅属于第一个账户的筛选');
  await page.goto('/account/');
  await page.getByRole('button', { name: '退出登录', exact: true }).click();
  await expect(page.getByRole('heading', { name: '欢迎回来', exact: true })).toBeVisible();
  await newAccount(page, request);
  await page.goto('/resources/');
  await expect(page.getByLabel('搜索资料', { exact: true })).toHaveValue('');
  await page.getByLabel('搜索资料', { exact: true }).fill('第二账户筛选');
  await page.goto('/account/');
  await page.getByRole('button', { name: '退出登录', exact: true }).click();
  await expect(page.getByRole('heading', { name: '欢迎回来', exact: true })).toBeVisible();
  await page.getByLabel('邮箱', { exact: true }).fill(first.email);
  await page.getByLabel('密码（至少12位）', { exact: true }).fill('browser-test-only-password');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.getByRole('heading', { name: '账户与配置', exact: true })).toBeVisible();
  await page.goto('/resources/');
  await expect(page.getByLabel('搜索资料', { exact: true })).toHaveValue('仅属于第一个账户的筛选');
});

test('账户清空计划会同步归档，并保留完成与真实计时记录', async ({ page, context, request }) => {
  await newAccount(page, request);
  await create(page, '账户待清空任务');
  await create(page, '账户完成记录');
  await create(page, '账户计时记录');
  await page.getByRole('button', { name: '完成 账户完成记录', exact: true }).click();
  const timed = page
    .getByTestId('task-card')
    .filter({ has: page.getByRole('heading', { name: '账户计时记录', exact: true }) });
  await timed.getByRole('button', { name: '开始学习', exact: true }).click();
  await page.getByRole('button', { name: '结束计时', exact: true }).click();
  await expect
    .poll(async () => {
      const data = await (await context.request.get('/api/platform/data')).json();
      return {
        tasks: data.backup.data.tasks.length,
        sessions: data.backup.data.sessions.filter(
          (session: { state: string }) => session.state === 'ended',
        ).length,
      };
    })
    .toEqual({ tasks: 3, sessions: 1 });
  const before = await (await context.request.get('/api/platform/data')).json();
  await page.goto('/plan/');
  await page.getByRole('button', { name: '列表', exact: true }).click();
  await page.getByRole('button', { name: '清空计划', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('status')).toContainText(
    '可清空 1 项 · 受保护 2 项',
  );
  await page.getByRole('button', { name: '确认清空 1 项', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect
    .poll(async () => {
      const data = await (await context.request.get('/api/platform/data')).json();
      return data.backup.data.tasks.filter((task: { deletedAt?: string }) => !task.deletedAt)
        .length;
    })
    .toBe(2);
  const after = await (await context.request.get('/api/platform/data')).json();
  expect(after.backup.data.sessions).toEqual(before.backup.data.sessions);
  expect(
    after.backup.data.tasks.find((task: { title: string }) => task.title === '账户完成记录').status,
  ).toBe('completed');
  expect(
    after.backup.data.tasks.find((task: { title: string }) => task.title === '账户待清空任务')
      .deletedAt,
  ).toBeTruthy();
  await page.reload();
  await expect(page.getByRole('heading', { name: '账户待清空任务', exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '账户完成记录', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '账户计时记录', exact: true })).toBeVisible();
});
