import { expect, test, chromium, type BrowserContext, type Page } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

let context: BrowserContext;
let extensionId: string;
let userDataDir: string;

test.describe.serial('extension fixture flows', () => {
  test.beforeAll(async () => {
    userDataDir = mkdtempSync(join(tmpdir(), 'ecv-extension-'));
    const extensionPath = resolve('dist');

    context = await chromium.launchPersistentContext(userDataDir, {
      channel: 'chromium',
      headless: false,
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]
    });

    let serviceWorker = context.serviceWorkers()[0];
    if (!serviceWorker) {
      serviceWorker = await context.waitForEvent('serviceworker');
    }

    extensionId = serviceWorker.url().split('/')[2] ?? '';
  });

  test.afterAll(async () => {
    await context?.close();
    if (userDataDir) {
      rmSync(userDataDir, { force: true, recursive: true });
    }
  });

  test('virtualizes long threads and restores history after top scroll', async () => {
    const page = await openFixturePage('/c/local-session');

    await expect(page.locator('.ecv-placeholder')).toHaveCount(2);

    await page.evaluate(() => {
      const container = document.querySelector<HTMLElement>('[data-ecv-scroll-container]');
      if (!container) {
        throw new Error('missing scroll container');
      }

      container.scrollTop = 400;
      container.dispatchEvent(new Event('scroll'));
      container.scrollTop = 0;
      container.dispatchEvent(new Event('scroll'));
    });

    await expect(page.locator('.ecv-placeholder')).toHaveCount(0);
    await page.close();
  });

  test('reads popup stats and restores search hits from the injected overlay', async () => {
    const page = await openFixturePage('/c/local-session');
    await expect(page.locator('.ecv-placeholder')).toHaveCount(2);

    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/src/popup/index.html`);

    await expect(popup.locator('#mountedCount')).toHaveText('10');
    await page.evaluate(() => {
      const host = document.querySelector<HTMLElement>('.ecv-search-overlay-host');
      if (!host) {
        throw new Error('missing search overlay host');
      }

      host.style.display = 'block';
    });

    const input = page.locator('input[type="search"]');
    await expect(input).toBeVisible();
    await input.fill('Question 1');

    const result = page.locator('button[data-record-id]').first();
    await expect(result).toBeVisible();
    await result.click();

    await expect(page.locator('.ecv-placeholder')).toHaveCount(0);
    await popup.close();
    await page.close();
  });

  test('degrades safely on unsupported layouts', async () => {
    const page = await openFixturePage('/c/unknown-session');

    await expect(page.locator('.ecv-placeholder')).toHaveCount(0);
    await expect(page.locator('.ecv-record-root')).toHaveCount(0);
    await page.close();
  });
});

async function openFixturePage(path: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:4173${path}`);
  return page;
}
