import { defineConfig, devices } from '@playwright/test';
import { mkdirSync } from 'node:fs';
mkdirSync('.platform-test', { recursive: true });
export default defineConfig({
  testDir: './tests/platform-e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 60000,
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report/platform', open: 'never' }],
    ['json', { outputFile: 'playwright-report/platform/results.json' }],
  ],
  use: { baseURL: 'http://127.0.0.1:3011', trace: 'retain-on-failure', actionTimeout: 10000 },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } },
    },
    {
      name: 'mobile',
      use: {
        ...devices['iPhone 13'],
        defaultBrowserType: 'chromium',
        viewport: { width: 375, height: 812 },
      },
    },
    {
      name: 'tablet',
      use: { ...devices['Desktop Chrome'], viewport: { width: 768, height: 1024 } },
    },
    { name: 'webkit', use: { ...devices['iPhone 13'], viewport: { width: 375, height: 812 } } },
  ],
  webServer: {
    command: 'npm start',
    url: 'http://127.0.0.1:3011/api/platform/health',
    reuseExistingServer: false,
    timeout: 60000,
    env: {
      PORT: '3011',
      HOST: '127.0.0.1',
      STAR_STUDY_TEST_DATABASE: `.platform-test/db-${Date.now()}`,
      PUBLIC_URL: 'http://127.0.0.1:3011',
      ALLOW_INSECURE_LOCAL: '1',
      SESSION_SECRET: 'isolated-browser-tests-not-production-'.repeat(2),
      SETUP_TOKEN: 'isolated-browser-setup-only',
    },
  },
});
