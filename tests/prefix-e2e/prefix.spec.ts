import { type APIRequestContext, type Page } from '@playwright/test';
import { test, expect } from '../e2e/fixtures';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
const run = promisify(execFile);
const port = Number(process.env.STAR_STUDY_PREFIX_TEST_PORT ?? 3014);
const origin = `http://127.0.0.1:${port}`;
const prefix = process.env.STAR_STUDY_PREFIX_TEST_PATH ?? '/test-prefix';
const url = (pathname: string) => `${prefix}${pathname}`;
const password = 'synthetic-prefix-test-password';
let admin: { csrf: string; id: string; cookie: string };
async function api(request: APIRequestContext, pathname: string, method = 'GET', data?: unknown) {
  return request.fetch(url(`/api/platform${pathname}`), {
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
  const status = await (await request.get(url('/api/platform/status'))).json();
  const response = await api(request, status.setupRequired ? '/setup' : '/login', 'POST', {
    email: 'prefix-admin@example.test',
    password,
    name: 'Prefix test admin',
    ...(status.setupRequired ? { setupToken: 'isolated-prefix-setup-only' } : {}),
  });
  expect(response.ok(), await response.text()).toBe(true);
  const auth = await response.json();
  admin = {
    csrf: auth.csrf,
    id: auth.user.id,
    cookie: response.headers()['set-cookie'].split(';')[0],
  };
});
async function create(page: Page, title: string) {
  await page.getByRole('button', { name: '新建任务', exact: true }).click();
  await page.getByLabel('任务名称', { exact: true }).fill(title);
  await page.getByRole('button', { name: '保存任务', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

test('前缀边界、相对重定向保留端口、图标manifest与构建一致性', async ({ page, request }) => {
  for (const pathname of [
    '/',
    '/api/platform/status',
    '/manifest.webmanifest',
    '/icons/star.svg',
    '/_next/',
    '/source/star-study-source.zip',
  ]) {
    const response = await request.get(pathname, { maxRedirects: 0 });
    expect(response.status()).toBe(404);
    expect(await response.text()).not.toContain(prefix);
  }
  const redirect = await request.get(`${prefix}?check=1`, { maxRedirects: 0 });
  expect(redirect.status()).toBe(307);
  expect(redirect.headers().location).toBe(`${prefix}/?check=1`);
  expect(new URL(redirect.headers().location, origin).port).toBe(String(port));
  expect((await request.get('/api/platform/health')).ok()).toBe(true); // private Docker-loopback contract
  expect((await request.get(url('/.star-study-build.json'))).status()).toBe(404);
  expect((await request.get(`${prefix}-other/`)).status()).toBe(404);
  const manifestResponse = await request.get(url('/manifest.webmanifest'));
  expect(manifestResponse.ok()).toBe(true);
  const manifest = await manifestResponse.json();
  expect(manifest).toMatchObject({
    name: '星研',
    id: url('/'),
    start_url: url('/'),
    scope: url('/'),
  });
  for (const icon of manifest.icons) {
    expect(icon.src.startsWith(url('/icons/'))).toBe(true);
    expect((await request.get(icon.src)).ok()).toBe(true);
  }
  const worker = await request.get(url('/sw.js'));
  expect(worker.ok()).toBe(true);
  expect(worker.headers()['service-worker-allowed']).toBe(url('/'));
  await page.goto(url('/'));
  await expect(page.getByRole('heading', { name: '欢迎回来', exact: true })).toBeVisible();
  expect(await page.locator('link[rel="manifest"]').getAttribute('href')).toBe(
    url('/manifest.webmanifest'),
  );
  for (const icon of await page
    .locator('link[rel="icon"],link[rel="apple-touch-icon"]')
    .evaluateAll((elements) => elements.map((element) => element.getAttribute('href'))))
    expect(icon?.startsWith(url('/'))).toBe(true);
  const icon = page.getByRole('main').locator('img').first();
  expect(await icon.getAttribute('src')).toBe(url('/icons/star.svg'));
  const mismatch = await run(process.execPath, [path.resolve('scripts/serve.mjs')], {
    timeout: 10000,
    env: {
      ...process.env,
      PORT: '3015',
      HOST: '127.0.0.1',
      APP_BASE_PATH: '/mismatch-test',
      DATABASE_URL: '',
      STAR_STUDY_TEST_DATABASE: '',
    },
  }).then(
    () => ({ code: 0, stderr: '', stdout: '' }),
    (error) => ({ code: error.code, stderr: String(error.stderr), stdout: String(error.stdout) }),
  );
  expect(mismatch.code).toBe(1);
  expect(mismatch.stderr).toContain('构建不一致');
  expect(mismatch.stderr + mismatch.stdout).not.toContain(prefix);
});

test('前缀下真实注册登录退出、单页导航、离线刷新及任务重新同步', async ({
  page,
  context,
  request,
}, info) => {
  const paths: string[] = [];
  page.on('request', (request) => {
    const parsed = new URL(request.url());
    if (parsed.origin === origin) paths.push(parsed.pathname);
  });
  const invitation = await (await api(request, '/admin/invite', 'POST', {})).json();
  const email = `prefix-learner-${Date.now()}-${Math.random().toString(16).slice(2)}@example.test`;
  await page.goto(url('/'));
  await page.getByRole('button', { name: '有邀请码？注册账户', exact: true }).click();
  await page.getByLabel('昵称', { exact: true }).fill('前缀学习者');
  await page.getByLabel('邮箱', { exact: true }).fill(email);
  await page.getByLabel('密码（至少12位）', { exact: true }).fill(password);
  await page.getByLabel('邀请码', { exact: true }).fill(invitation.code);
  await page.getByRole('button', { name: '注册并登录', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: '先找到适合自己的节奏', exact: true }),
  ).toBeVisible();
  await page.getByLabel('目标院校', { exact: true }).fill('本人目标院校');
  await page.getByLabel('目标专业', { exact: true }).fill('本人专业');
  await page.getByRole('button', { name: '保存，进入学习空间', exact: true }).click();
  await expect(page.getByRole('heading', { name: /^今日学习/ })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: '账户数据已同步' })).toBeVisible();
  expect(
    (await context.cookies(origin + url('/'))).find((cookie) => cookie.name === 'star_session')
      ?.path,
  ).toBe(url('/'));
  expect(
    (await context.cookies(origin + '/')).some((cookie) => cookie.name === 'star_session'),
  ).toBe(false);
  await page.evaluate(() => {
    document.documentElement.dataset.prefixNavigation = 'kept';
  });
  await page.getByRole('link', { name: '学习计划', exact: true }).filter({ visible: true }).click();
  await expect(page).toHaveURL(origin + url('/plan/'));
  expect(await page.evaluate(() => document.documentElement.dataset.prefixNavigation)).toBe('kept');
  await create(page, '前缀账户的任务');
  await expect
    .poll(async () => {
      const result = await (await context.request.get(url('/api/platform/data'))).json();
      return result.backup.data.tasks.length;
    })
    .toBe(1);
  await page.goto(url('/account/'));
  await expect(page.getByRole('heading', { name: '账户与配置', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '退出登录', exact: true }).click();
  await expect(page.getByRole('heading', { name: '欢迎回来', exact: true })).toBeVisible();
  expect(
    (await context.cookies(origin + url('/'))).some((cookie) => cookie.name === 'star_session'),
  ).toBe(false);
  await page.getByLabel('邮箱', { exact: true }).fill(email);
  await page.getByLabel('密码（至少12位）', { exact: true }).fill(password);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.getByRole('heading', { name: '账户与配置', exact: true })).toBeVisible();
  const scope = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    return registration.scope;
  });
  expect(scope).toBe(origin + url('/'));
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await page.goto(url('/plan/'));
  await page.getByRole('button', { name: '列表', exact: true }).click();
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: '学习计划', exact: true })).toBeVisible();
  await create(page, '前缀离线任务');
  await page.reload();
  await expect(page.getByRole('heading', { name: '前缀离线任务', exact: true })).toBeVisible();
  await context.setOffline(false);
  await expect
    .poll(async () => {
      const data = await (await context.request.get(url('/api/platform/data'))).json();
      return data.backup.data.tasks.length;
    })
    .toBe(2);
  expect(
    paths.filter((pathname) => pathname !== prefix && !pathname.startsWith(prefix + '/')),
  ).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('prefixed-plan.png'), fullPage: true });
});
