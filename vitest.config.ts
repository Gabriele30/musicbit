import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'apps/**/*.test.{ts,tsx}',
      'packages/**/*.test.ts',
      'experiments/playback/**/*.test.ts',
      'experiments/youtube-playback/**/*.test.ts',
    ],
    projects: [
      {
        test: {
          name: 'api',
          environment: 'node',
          include: ['apps/api/**/*.test.ts', 'packages/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'web',
          environment: 'jsdom',
          include: [
            'apps/web/**/*.test.{ts,tsx}',
            'experiments/playback/src/**/*.test.ts',
            'experiments/youtube-playback/src/**/*.test.ts',
          ],
          setupFiles: ['apps/web/src/test/setup.ts'],
        },
      },
    ],
  },
});
