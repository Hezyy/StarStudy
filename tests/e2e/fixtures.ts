import { test as base, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync } from 'node:fs';
import path from 'node:path';

// Windows WebKit's ephemeral IndexedDB backend cannot prepare Blob files.
// Test normal installed-app storage in an isolated persistent profile instead.
// WinCairo also drops cookies when the profile directory contains Unicode test names.
// ASCII hashes and mkdtemp preserve real HTTP Cookie behavior and isolate every run.
// These private profiles stay under the ignored test output directory.
export const test = base.extend({
  context: async ({ browser, browserName, contextOptions }, use, info) => {
    const needsPersistentProfile = browserName === 'webkit' && process.platform === 'win32';
    let profile: string | undefined;
    if (needsPersistentProfile) {
      const root = path.join(info.project.outputDir, '.webkit-profiles');
      mkdirSync(root, { recursive: true });
      const hash = createHash('sha256').update(info.testId).digest('hex').slice(0, 16);
      profile = mkdtempSync(path.join(root, `test-${hash}-`));
    }
    const context =
      needsPersistentProfile
        ? await browser.browserType().launchPersistentContext(profile!, {
            ...contextOptions,
            headless: true,
          })
        : await browser.newContext(contextOptions);
    if (needsPersistentProfile) for (const page of context.pages()) await page.close();
    await use(context);
    await context.close();
  },
});
export { expect };
