import { defineConfig } from 'vite';
export default defineConfig({
  base: '/__playback/',
  publicDir: false,
  build: { target: 'safari16.4' },
});
