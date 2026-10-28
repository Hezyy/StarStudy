import { type APIRequestContext, type Page } from '@playwright/test';
import { test, expect } from '../e2e/fixtures';

const origin = 'http://127.0.0.1:3011';
const password = 'browser-test-only-password';
let admin: { csrf: string; id: string; cookie: string };

async function adminRequest(
  request: APIRequestContext,
  path: string,
  method = 'GET',
  data?: unknown,
) {
  return request.fetch(`/api/platform${path}`, {
    method,
    headers: {
      Origin: origin,
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
  const response = await adminRequest(request, status.setupRequired ? '/setup' : '/login', 'POST', {
    email: 'platform-admin@example.test',
    name: 'Admin',
    password,
    ...(status.setupRequired ? { setupToken: 'isolated-browser-setup-only' } : {}),
  });
  expect(response.ok(), await response.text()).toBe(true);
  const auth = await response.json();
  admin = {
    csrf: auth.csrf,
    id: auth.user.id,
    cookie: response.headers()['set-cookie'].split(';')[0],
  };
});

async function register(page: Page, request: APIRequestContext) {
  const response = await adminRequest(request, '/admin/invite', 'POST', {});
  expect(response.ok()).toBe(true);
  const invitation = await response.json();
  await page.goto('/');
  await page.getByRole('button', { name: '有邀请码？注册账户' }).click();
  await page.getByLabel('昵称', { exact: true }).fill('账户交互测试者');
  await page
    .getByLabel('邮箱', { exact: true })
    .fill(`account-ui-${Date.now()}-${Math.random().toString(16).slice(2)}@example.test`);
  await page.getByLabel('密码（至少12位）', { exact: true }).fill(password);
  await page.getByLabel('邀请码', { exact: true }).fill(invitation.code);
  const registration = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/platform/register') && response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: '注册并登录', exact: true }).click();
  const registered = await registration;
  expect(registered.ok(), '注册请求应真实成功').toBe(true);
  await registered.finished();
  await expect
    .poll(
      async () =>
        (await page.context().cookies(origin)).some((cookie) => cookie.name === 'star_session'),
      {
        message: '浏览器应接受同源注册响应的HttpOnly会话Cookie',
      },
    )
    .toBe(true);
  await expect(page.getByRole('heading', { name: '先找到适合自己的节奏' })).toBeVisible();
  await page.getByLabel('目标院校', { exact: true }).fill('本人目标院校');
  await page.getByLabel('目标专业', { exact: true }).fill('本人目标专业');
  await page
    .getByLabel('数学、英语、专业课基础与当前进度', { exact: true })
    .fill('数学基础复习，英语阅读巩固，专业课重新开始。');
}

async function finishOnboarding(page: Page) {
  await page.getByRole('button', { name: '保存，进入学习空间', exact: true }).click();
  await expect(page.getByRole('heading', { name: '今日学习', exact: true })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: '账户数据已同步' })).toBeVisible();
}

async function noHorizontalOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
}

test('新手引导网络失败可重试，基础设置幂等保存且选用本人科目', async ({
  page,
  request,
  context,
}, info) => {
  await register(page, request);
  await page.getByLabel('数学', { exact: true }).selectOption('数学三');
  await page.getByLabel('英语', { exact: true }).selectOption('英语二');
  await page.getByLabel('平日分钟', { exact: true }).fill('70');
  await page.getByLabel('周末分钟', { exact: true }).fill('150');
  await page.getByLabel('寒暑假分钟', { exact: true }).fill('240');
  await noHorizontalOverflow(page);
  let failed = false;
  await page.route('**/api/platform/account', async (route) => {
    if (route.request().method() === 'PATCH' && !failed) {
      failed = true;
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: '临时断线，请重试' }),
      });
    } else await route.continue();
  });
  await page.getByRole('button', { name: '保存，进入学习空间', exact: true }).click();
  await expect(page.locator('.onboarding-space [role="alert"]')).toContainText('临时断线，请重试');
  await expect(page.getByRole('button', { name: '保存，进入学习空间', exact: true })).toBeEnabled();
  await page.screenshot({ path: info.outputPath('onboarding-retry.png'), fullPage: true });
  await finishOnboarding(page);
  await expect
    .poll(async () => {
      const data = await (await context.request.get('/api/platform/data')).json();
      return data.backup.data.settings.filter(
        (setting: { key: string }) => setting.key === 'foundation',
      ).length;
    })
    .toBe(1);
  const data = await (await context.request.get('/api/platform/data')).json();
  expect(
    data.backup.data.subjects
      .filter((subject: { active: boolean }) => subject.active)
      .map((subject: { name: string }) => subject.name),
  ).toEqual(expect.arrayContaining(['数学三', '英语二']));
  expect(data.backup.data.examTargets[0].university).toBe('本人目标院校');
  const preferences = data.backup.data.settings.find(
    (setting: { key: string }) => setting.key === 'preferences',
  ).value;
  expect(preferences.weekdayMinutes).toBe(70);
  expect(preferences.weekendMinutes).toBe(150);
  await noHorizontalOverflow(page);
});

test.describe('账户表单与AI状态反馈', () => {
  // Deterministic response gating requires route interception. Offline/PWA coverage
  // remains enabled in platform.spec.ts; only this form-feedback scenario blocks SW.
  // https://playwright.dev/docs/service-workers#how-to-disable-service-workers
  test.use({ serviceWorkers: 'block' });
  test('账户科目去重、密码确认、未配置AI加载反馈和普通用户后台权限', async ({
    page,
    request,
    context,
  }, info) => {
    await register(page, request);
    await finishOnboarding(page);
    await page.goto('/account/');
    await page.getByLabel('科目名称', { exact: true }).fill('自命题专项');
    await page.getByRole('button', { name: '添加科目', exact: true }).click();
    await expect(
      page.getByRole('button', { name: '自命题专项 · 启用', exact: true }),
    ).toBeVisible();
    await page.getByLabel('自命题专项优先级', { exact: true }).selectOption('3');
    await page.getByLabel('科目名称', { exact: true }).fill('自命题专项');
    await page.getByRole('button', { name: '添加科目', exact: true }).click();
    await expect(page.getByRole('alert').filter({ hasText: '这个科目已经存在' })).toBeVisible();
    await page.getByLabel('科目名称', { exact: true }).fill('');
    let passwordRequests = 0;
    page.on('request', (request) => {
      if (request.url().endsWith('/api/platform/password') && request.method() === 'POST')
        passwordRequests++;
    });
    await page.getByLabel('当前密码', { exact: true }).fill(password);
    await page.getByLabel('新密码', { exact: true }).fill('changed-test-only-password');
    await page.getByLabel('再次输入新密码', { exact: true }).fill('different-test-password');
    await page.getByRole('button', { name: '更新密码', exact: true }).click();
    await expect(page.getByText('两次输入的新密码不一致。', { exact: true })).toBeVisible();
    expect(passwordRequests).toBe(0);
    await page.getByLabel('再次输入新密码', { exact: true }).fill('changed-test-only-password');
    await page.getByRole('button', { name: '更新密码', exact: true }).click();
    await expect(page.getByText('密码已更新，其他登录已失效', { exact: true })).toBeVisible();
    expect(passwordRequests).toBe(1);
    await noHorizontalOverflow(page);
    await page.screenshot({ path: info.outputPath('account-controls.png'), fullPage: true });
    let releaseStatus!: () => void;
    const statusReady = new Promise<void>((resolve) => {
      releaseStatus = resolve;
    });
    await page.route('**/api/platform/ai/status', async (route) => {
      const response = await route.fetch();
      await statusReady;
      await route.fulfill({ response });
    });
    try {
      await page.goto('/integrations/', { waitUntil: 'domcontentloaded' });
      await expect(page.getByText('正在检查服务配置…', { exact: true })).toBeVisible();
    } finally {
      releaseStatus();
    }
    await expect(page.getByText('AI尚未启用', { exact: false })).toBeVisible();
    await expect(page.getByRole('button', { name: '发送并获取建议', exact: true })).toBeDisabled();
    await page.getByLabel('允许本账户在此页面发送AI请求').uncheck();
    await expect(
      page.getByText('已关闭。外部AI提示词与计划导入仍可使用', { exact: false }),
    ).toBeVisible();
    const secondTab = await context.newPage();
    try {
      await secondTab.goto('/integrations/');
      const otherPreference = secondTab.getByLabel('允许本账户在此页面发送AI请求');
      await expect(otherPreference).not.toBeChecked();
      await otherPreference.check();
      // A second real UI writes the same account database, as a sync pull would do.
      await expect(page.getByLabel('允许本账户在此页面发送AI请求')).toBeChecked();
    } finally {
      await secondTab.close();
    }
    await page.evaluate(() => {
      const original = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (value: unknown, key?: IDBValidKey) {
        if (
          this.name === 'settings' &&
          value &&
          typeof value === 'object' &&
          'key' in value &&
          value.key === 'ai-enabled'
        ) {
          IDBObjectStore.prototype.put = original;
          throw new DOMException('模拟存储空间不足', 'QuotaExceededError');
        }
        return key === undefined ? original.call(this, value) : original.call(this, value, key);
      };
    });
    await page.getByLabel('允许本账户在此页面发送AI请求').click();
    await expect(
      page.getByRole('alert').filter({ hasText: '模拟存储空间不足' }).first(),
    ).toBeVisible();
    await expect(page.getByLabel('允许本账户在此页面发送AI请求')).toBeChecked();
    await page.getByLabel('允许本账户在此页面发送AI请求').uncheck();
    await expect(
      page.getByText('已关闭。外部AI提示词与计划导入仍可使用', { exact: false }),
    ).toBeVisible();
    await noHorizontalOverflow(page);
    await page.screenshot({ path: info.outputPath('ai-not-configured.png'), fullPage: true });
    await page.goto('/admin/');
    await expect(page.getByText('此页面仅供部署管理员使用。', { exact: false })).toBeVisible();
    await expect(page.getByRole('button', { name: '创建邀请码', exact: true })).toHaveCount(0);
    expect((await context.request.get('/api/platform/admin')).status()).toBe(403);
  });
});

test('管理员设置未保存提示、公开注册取消不写入、唯一管理员保护和邀请码复制入口', async ({
  page,
  request,
  context,
}, info) => {
  const profile = await adminRequest(request, '/account', 'PATCH', {
    name: 'Admin',
    onboarded: true,
  });
  expect(profile.ok()).toBe(true);
  await context.addCookies([
    { name: 'star_session', value: admin.cookie.slice('star_session='.length), url: origin },
  ]);
  await page.goto('/admin/');
  await expect(page.getByRole('heading', { name: '服务概况', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '创建邀请码', exact: true }).click();
  await expect(page.getByLabel('邀请码（仅此时显示）', { exact: true })).not.toHaveValue('');
  await expect(page.getByRole('button', { name: '复制邀请码', exact: true })).toBeVisible();
  const currentAdmin = page
    .locator('.platform-user')
    .filter({ hasText: 'platform-admin@example.test' });
  await expect(
    currentAdmin.getByRole('button', { name: '设为普通用户', exact: true }),
  ).toBeDisabled();
  let settingsRequests = 0;
  page.on('request', (request) => {
    if (request.url().endsWith('/api/platform/admin/settings') && request.method() === 'PUT')
      settingsRequests++;
  });
  await page.getByLabel('注册模式', { exact: true }).selectOption('public');
  await expect(page.getByText('有未保存的服务设置', { exact: true })).toBeVisible();
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.getByRole('button', { name: '保存服务设置', exact: true }).click();
  expect(settingsRequests).toBe(0);
  await expect(page.getByRole('button', { name: '保存服务设置', exact: true })).toBeEnabled();
  await page.getByLabel('注册模式', { exact: true }).selectOption('invite');
  await expect(page.getByRole('button', { name: '保存服务设置', exact: true })).toBeDisabled();
  await noHorizontalOverflow(page);
  await page.screenshot({ path: info.outputPath('admin-controls.png'), fullPage: true });
});
