import { test as base, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync } from 'node:fs';
import path from 'node:path';

// Playwright WebKit's ephemeral IndexedDB backend cannot prepare Blob files.
// Test normal installed-app storage in an isolated persistent profile instead.
// WinCairo also drops cookies when the profile directory contains Unicode test names.
// ASCII hashes and mkdtemp preserve real HTTP Cookie behavior and isolate every run.
// These private profiles stay under the ignored test output directory.
export const test = base.extend({
  context: async ({ browser, browserName, contextOptions }, use, info) => {
    const needsPersistentProfile = browserName === 'webkit';
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
    // Keep the initial blank page until context.close(). Closing the final page of
    // a persistent GTK WebKit context terminates its browser before the page fixture starts.
    // This page never visits the app and cannot change its data or authentication.
    const pageErrors: string[] = [];
    context.on('page', (page) => page.on('pageerror', (error) => pageErrors.push(error.message)));
    try {
      await use(context);
    } finally {
      if (info.status !== info.expectedStatus) {
        const feedback = [];
        for (const page of context.pages()) {
          if (page.isClosed()) continue;
          feedback.push({
            url: page.url(),
            messages: await page
              .locator('[role="alert"], [role="status"]')
              .allTextContents()
              .catch(() => []),
          });
        }
        await info.attach('ui-feedback', {
          body: Buffer.from(JSON.stringify({ pageErrors, feedback }, null, 2)),
          contentType: 'application/json',
        });
      }
      await context.close();
    }
  },
});
export { expect };
