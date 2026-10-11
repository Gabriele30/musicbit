import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, webkit } from '@playwright/test';
import { buildApp } from '../apps/api/dist/app.js';

// Explicit live probe, excluded from deterministic CI. Saves timings, never audio or signed URLs.
const id = process.env.AUDIO_SMOKE_VIDEO_ID || 'dQw4w9WgXcQ';
if (!/^[A-Za-z0-9_-]{11}$/.test(id))
  throw new Error('AUDIO_SMOKE_VIDEO_ID non valido');
const app = buildApp();
const requests = [];
app.addHook('onResponse', async (request, reply) => {
  if (request.url.startsWith('/api/audio/'))
    requests.push({
      method: request.method,
      range: request.headers.range ?? null,
      status: reply.statusCode,
    });
});
const report = {
  checkedAt: new Date().toISOString(),
  videoId: id,
  browsers: [],
  note: 'Desktop native media through the real API proxy. No physical audio, iOS, lock-screen or long-session validation.',
};
try {
  const address = await app.listen({ host: '127.0.0.1', port: 0 });
  for (const [name, engine] of [
    ['chromium', chromium],
    ['webkit', webkit],
  ]) {
    const browser = await engine.launch({ headless: true });
    const start = requests.length;
    try {
      const page = await browser.newPage();
      await page.goto(`${address}/health`);
      await page.setContent(
        '<button id="play">Play</button><audio id="audio" preload="none"></audio>',
      );
      await page.evaluate((url) => {
        const audio = document.querySelector('audio');
        audio.volume = 0;
        document.querySelector('button').addEventListener('click', () => {
          audio.src = url;
          window.clickedAt = performance.now();
          audio.addEventListener('playing', () => {
            window.playingAt ??= performance.now();
          });
          audio.play().catch(() => {
            window.probeError = audio.error?.code ?? 'PLAY_REJECTED';
          });
        });
      }, `${address}/api/audio/${id}`);
      await page.locator('#play').click();
      await page.waitForFunction(
        () =>
          (window.playingAt !== undefined &&
            !document.querySelector('audio').ended &&
            document.querySelector('audio').currentTime > 0.2) ||
          document.querySelector('audio').ended ||
          window.probeError,
        undefined,
        { timeout: 30000 },
      );
      const result = await page.evaluate(() => ({
        clickToPlayingMs: Math.round(window.playingAt - window.clickedAt),
        position: document.querySelector('audio').currentTime,
        duration: document.querySelector('audio').duration,
        error: window.probeError ?? null,
        ended: document.querySelector('audio').ended,
      }));
      if (
        result.error ||
        result.ended ||
        !Number.isFinite(result.clickToPlayingMs) ||
        !(result.position > 0)
      )
        throw new Error(`${name}: native playback failed (${result.error})`);
      await page.evaluate(() => {
        const audio = document.querySelector('audio');
        audio.currentTime = 10;
      });
      await page.waitForFunction(() => {
        const audio = document.querySelector('audio');
        return (
          !audio.seeking && audio.currentTime > 10.2 && audio.readyState >= 2
        );
      });
      await page.evaluate(() => {
        document.querySelector('audio').pause();
      });
      report.browsers.push({ name, ...result, seek: true });
    } finally {
      await browser.close();
    }
    report.browsers.at(-1).requests = requests.slice(start);
  }
} catch (error) {
  report.failure = error instanceof Error ? error.message : 'Probe failed';
  process.exitCode = 1;
} finally {
  await app.close();
  await mkdir('artifacts', { recursive: true });
  await writeFile(
    'artifacts/audio-live-smoke.json',
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
}
