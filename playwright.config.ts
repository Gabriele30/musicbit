import { defineConfig, devices } from '@playwright/test';

const webBase = `http://127.0.0.1:${process.env.MUSICBIT_E2E_PORT || 4174}`;
const playbackBase = `http://127.0.0.1:${process.env.MUSICBIT_PLAYBACK_E2E_PORT || 4182}`;
const youtubeBase = `http://127.0.0.1:${process.env.MUSICBIT_YOUTUBE_E2E_PORT || 4184}`;
const apiPort = process.env.MUSICBIT_E2E_API_PORT || '4703';
const apiBase = `http://127.0.0.1:${apiPort}`;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL: webBase, trace: 'retain-on-failure' },
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
      url: `${apiBase}/health`,
      reuseExistingServer: false,
      env: {
        API_PORT: apiPort,
        API_HOST: '127.0.0.1',
        MUSICBIT_DB_PATH: ':memory:',
        AUTH_REGISTRATION: 'true',
        AUTH_COOKIE_SECURE: 'false',
        MUSICBIT_REQUIRE_ACCOUNT: 'false',
      },
    },
    {
      command: 'node scripts/e2e-server.mjs',
      env: { MUSICBIT_E2E_API_BASE: apiBase },
      url: webBase,
      reuseExistingServer: false,
    },
    {
      command: 'node scripts/playback-e2e-server.mjs',
      url: `${playbackBase}/__playback/health`,
      reuseExistingServer: false,
    },
    {
      command: 'node scripts/youtube-playback-e2e-server.mjs',
      url: `${youtubeBase}/__youtube/health`,
      reuseExistingServer: false,
    },
  ],
});
