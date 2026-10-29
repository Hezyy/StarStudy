import { defineConfig, devices } from '@playwright/test';
import { normalizeBasePath } from './scripts/base-path.mjs';
const port = Number(process.env.STAR_STUDY_PREFIX_TEST_PORT ?? 3014);
if (![3014, 3015].includes(port)) throw new Error('前缀验收请使用独立测试端口3014或3015');
const prefix = normalizeBasePath(process.env.STAR_STUDY_PREFIX_TEST_PATH ?? '/test-prefix');
if (!prefix) throw new Error('此套验收需要非空测试路径');
const origin = `http://127.0.0.1:${port}`;
export default defineConfig({
  testDir: './tests/prefix-e2e',
  outputDir: '.platform-test/prefix-results',
  workers: 1,
  fullyParallel: false,
  timeout: 60000,
  reporter: [['list'], ['json', { outputFile: 'playwright-report/prefix/results.json' }]],
  use: { baseURL: origin, trace: 'retain-on-failure', actionTimeout: 10000 },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } },
    },
    { name: 'webkit', use: { ...devices['iPhone 13'], viewport: { width: 375, height: 812 } } },
  ],
  webServer: {
    command: 'npm start',
    url: origin + '/api/platform/health',
    reuseExistingServer: false,
    timeout: 60000,
    env: {
      PORT: String(port),
      HOST: '127.0.0.1',
      APP_BASE_PATH: prefix,
      NEXT_PUBLIC_BASE_PATH: prefix,
      PUBLIC_URL: origin + prefix,
      ALLOW_INSECURE_LOCAL: '1',
      STAR_STUDY_TEST_DATABASE: `.platform-test/prefix-db-${Date.now()}`,
      SESSION_SECRET: 'isolated-prefix-tests-only-'.repeat(3),
      SETUP_TOKEN: 'isolated-prefix-setup-only',
    },
  },
});
