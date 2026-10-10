import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '../..', '');
  const devPort = Number(env.WEB_DEV_PORT || 4175);
  if (!Number.isInteger(devPort) || devPort < 1 || devPort > 65535) {
    throw new Error('WEB_DEV_PORT deve essere tra 1 e 65535');
  }
  const proxy = {
    '/api': { target: env.API_PROXY_TARGET || 'http://127.0.0.1:3001' },
    '/health': { target: env.API_PROXY_TARGET || 'http://127.0.0.1:3001' },
  };
  return {
    envDir: '../..',
    plugins: [
      react(),
      VitePWA({
        registerType: 'prompt',
        includeAssets: ['favicon.svg', 'apple-touch-icon.png', 'artwork/*.png'],
        manifest: {
          id: '/',
          name: 'MusicBit',
          short_name: 'MusicBit',
          lang: 'it',
          description:
            'La tua musica, nel tuo spazio. Player personale self-hosted.',
          start_url: '/',
          scope: '/',
          display: 'standalone',
          orientation: 'any',
          theme_color: '#101312',
          background_color: '#101312',
          icons: [
            {
              src: '/icons/icon-192.png',
              sizes: '192x192',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: '/icons/icon-512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: '/icons/maskable-512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
        workbox: {
          // App shell only. No runtime media/API cache or Range request interception.
          globPatterns: ['**/*.{js,css,html,png,svg,webmanifest}'],
          navigateFallbackDenylist: [/^\/api(?:\/|$)/, /^\/health(?:\/|$)/],
          cleanupOutdatedCaches: true,
          clientsClaim: true,
        },
        devOptions: { enabled: false },
      }),
    ],
    server: { port: devPort, strictPort: true, proxy },
    preview: { port: 4173, strictPort: true, proxy },
    build: { target: 'safari16.4' },
  };
});
