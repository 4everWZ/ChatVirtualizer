import { defineConfig } from '@playwright/test';

const fixturePort = Number(process.env.FIXTURE_PORT ?? 4173);

export default defineConfig({
  testDir: './tests/playwright',
  timeout: 30_000,
  fullyParallel: false,
  reporter: 'list',
  use: {
    headless: true
  },
  webServer: {
    command: `node ./tests/fixtures/server.mjs ${fixturePort}`,
    port: fixturePort,
    reuseExistingServer: !process.env.CI
  }
});
