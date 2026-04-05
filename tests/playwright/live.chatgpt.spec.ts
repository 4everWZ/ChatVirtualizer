import { expect, test, chromium } from '@playwright/test';
import { resolve } from 'node:path';

const liveUrl = process.env.ECV_LIVE_CHAT_URL;
const userDataDir = process.env.ECV_LIVE_USER_DATA_DIR;

test.skip(!process.env.LIVE_CHATGPT || !liveUrl || !userDataDir, 'Set LIVE_CHATGPT=1, ECV_LIVE_CHAT_URL, and ECV_LIVE_USER_DATA_DIR to run live smoke tests.');

test('loads the extension on a real ChatGPT conversation', async () => {
  const extensionPath = resolve('dist');
  const context = await chromium.launchPersistentContext(userDataDir!, {
    channel: 'chromium',
    headless: false,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]
  });

  try {
    const page = await context.newPage();
    await page.goto(liveUrl!);
    await expect(page.locator('body')).toBeVisible();
    await expect
      .poll(async () => page.locator('.ecv-record-root, .ecv-collapsed-group').count())
      .toBeGreaterThan(0);
  } finally {
    await context.close();
  }
});
