import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL: 'http://127.0.0.1:4174', trace: 'retain-on-failure' },
  projects: [
    {
      name: 'chromium-mobile',
      use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' },
    },
    { name: 'webkit-mobile', use: { ...devices['iPhone 13'] } },
  ],
  webServer: [
    {
      command: 'pnpm --filter @musicbit/api start',
      url: 'http://127.0.0.1:3001/health',
      reuseExistingServer: !process.env.CI,
    },
    {
      command: 'node scripts/e2e-server.mjs',
      url: 'http://127.0.0.1:4174',
      reuseExistingServer: false,
    },
  ],
});
