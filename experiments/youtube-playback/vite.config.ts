import { defineConfig } from 'vite';
export default defineConfig({
  base: '/__youtube/',
  publicDir: false,
  build: { target: 'safari16.4' },
});
