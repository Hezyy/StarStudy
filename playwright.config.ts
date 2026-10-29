import { defineConfig, devices } from '@playwright/test';
const baseURL=process.env.STAR_STUDY_TEST_URL??'http://localhost:3000';
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report/local', open: 'never' }],
    ['json', { outputFile: 'playwright-report/local/results.json' }],
  ],
  timeout: 45000,
  use: { baseURL, trace: 'retain-on-failure' },
  projects: [
    {
      name: 'chromium',
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
    url: baseURL,
    env:process.env.STAR_STUDY_TEST_URL?{PORT:new URL(baseURL).port,HOST:new URL(baseURL).hostname,DATABASE_URL:'',STAR_STUDY_TEST_DATABASE:''}:undefined,
    reuseExistingServer: !process.env.CI&&!process.env.STAR_STUDY_TEST_URL,
    timeout: 30000,
  },
});
