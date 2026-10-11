import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import { buildYouTubePlaybackLab } from '../apps/api/dist/youtube-playback/lab.js';
import { YouTubePlaybackProvider } from '../apps/api/dist/youtube-playback/provider.js';
import { loadPermissions } from '../apps/api/dist/youtube-playback/permissions.js';

// Explicit live metadata requests. Direct media is gated by operator-provided permissions.
// No fixtures, downloads, proxy, retries, tokens or alternative clients in this benchmark.
const runs = Number(process.env.YOUTUBE_PLAYBACK_BENCHMARK_RUNS ?? 5);
if (!Number.isInteger(runs) || runs < 1 || runs > 10)
  throw new Error('M5 benchmark runs: 1–10');
const permissions = await loadPermissions(
  process.env.YOUTUBE_PLAYBACK_PERMISSIONS_FILE,
);
const enabled = process.env.YOUTUBE_PLAYBACK_LAB_ENABLED === 'true';
const officialRequested = process.env.YOUTUBE_OFFICIAL_CONTROL === 'true';
const query =
  process.env.YOUTUBE_PLAYBACK_BENCHMARK_QUERY ?? 'Kevin MacLeod Carefree';
const startedAt = new Date().toISOString();
const catalog = [],
  resolutions = [],
  playback = [],
  official = [];
const browser = await chromium.launch();
try {
  for (let run = 1; run <= runs; run++) {
    const provider = new YouTubePlaybackProvider(enabled, permissions);
    const app = buildYouTubePlaybackLab({}, provider);
    const origin = await app.listen({ host: '127.0.0.1', port: 0 });
    try {
      let items = [];
      let failed = false;
      for (const phase of ['cold', 'warm']) {
        // A failed cold request is not retried as a purported warm-cache request.
        if (failed) break;
        const start = performance.now();
        const response = await fetch(
          `${origin}/__youtube/api/search?q=${encodeURIComponent(query)}`,
          { signal: AbortSignal.timeout(15000) },
        );
        const data = await response.json();
        failed = !response.ok;
        items = data.items ?? [];
        catalog.push({
          run,
          phase,
          status: response.status,
          totalMs: performance.now() - start,
          serverMs: data.timing?.elapsedMs ?? null,
          cache: data.timing?.cache ?? null,
          count: items.length,
          error: data.code ?? null,
        });
      }
      const permitted = new Set(provider.availability().authorizedVideoIds);
      const chosen = items.find((item) => permitted.has(item.id)) ?? items[0];
      if (!chosen) {
        resolutions.push({
          run,
          outcome: 'NO_SEARCH_RESULT',
          upstreamMs: null,
        });
        continue;
      }
      let result;
      for (const phase of ['cold', 'warm']) {
        const start = performance.now();
        const response = await fetch(`${origin}/__youtube/api/resolve`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            catalogProvider: 'youtube',
            catalogId: chosen.id,
          }),
          signal: AbortSignal.timeout(15000),
        });
        result = await response.json();
        resolutions.push({
          run,
          phase,
          videoId: chosen.id,
          totalMs: performance.now() - start,
          serverMs: result.timing?.elapsedMs ?? null,
          cache: result.timing?.cache ?? null,
          outcome: result.diagnostic?.outcome ?? result.resolution.status,
          upstreamMs: result.diagnostic?.upstreamMs ?? null,
          resolution: result.resolution.status,
          httpStatus: result.diagnostic?.httpStatus ?? null,
          formats: result.diagnostic?.formats ?? [],
          validUntil: result.diagnostic?.validUntil ?? null,
        });
        // Unavailable/error results are never cached or retried against the remote service.
        if (result.resolution.status !== 'available') break;
      }
      if (result?.resolution.status === 'available') {
        for (const mode of ['direct', 'prepared']) {
          const context = await browser.newContext({ serviceWorkers: 'block' });
          const page = await context.newPage();
          const cdp = await context.newCDPSession(page);
          await cdp.send('Network.enable');
          await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
          const media = new Map();
          cdp.on('Network.requestWillBeSent', (event) => {
            if (
              new URL(event.request.url).hostname.endsWith('.googlevideo.com')
            )
              media.set(event.requestId, { start: event.timestamp });
          });
          cdp.on('Network.responseReceived', (event) => {
            const request = media.get(event.requestId);
            if (request)
              Object.assign(request, {
                status: event.response.status,
                headersMs: (event.timestamp - request.start) * 1000,
              });
          });
          cdp.on('Network.dataReceived', (event) => {
            const request = media.get(event.requestId);
            if (request)
              request.firstChunkMs ??= (event.timestamp - request.start) * 1000;
          });
          let error = null;
          try {
            await page.goto(`${origin}/__youtube/`);
            await page.locator('#video-id').fill(chosen.id);
            await page
              .getByRole('button', { name: 'Seleziona ID', exact: true })
              .click();
            await page.locator('#resolve').click();
            await page.locator('#play').waitFor({ state: 'visible' });
            await page.waitForFunction(
              () => !document.querySelector('#play').disabled,
            );
            await page.locator('audio').evaluate((audio) => {
              audio.volume = 0;
            });
            if (mode === 'prepared') {
              await page.locator('#prepare').click();
              await page.waitForFunction(
                () => document.querySelector('audio').readyState >= 3,
                undefined,
                { timeout: 20000 },
              );
            }
            await page.locator('#play').click();
            await page.waitForFunction(
              () =>
                JSON.parse(document.querySelector('#diagnostic').textContent)
                  .native.clickToPlayingMs !== null,
              undefined,
              { timeout: 20000 },
            );
            const next = items.find(
              (item) => item.id !== chosen.id && permitted.has(item.id),
            );
            if (next) {
              await page.locator('#video-id').fill(next.id);
              await page
                .getByRole('button', { name: 'Seleziona ID', exact: true })
                .click();
              await page.locator('#stage').click();
              await page.waitForFunction(
                () => !document.querySelector('#next').disabled,
              );
              await page.locator('#next').click();
              await page.waitForFunction(
                () => {
                  const attempt = JSON.parse(
                    document.querySelector('#diagnostic').textContent,
                  ).native.attempts.at(-1);
                  return (
                    attempt?.kind === 'next' && attempt.playingAt !== undefined
                  );
                },
                undefined,
                { timeout: 20000 },
              );
            }
          } catch {
            error = 'BROWSER_PLAYBACK_NOT_DEMONSTRATED';
          }
          const state = await page.locator('#diagnostic').textContent();
          playback.push({
            run,
            mode,
            error,
            diagnostic: state ? JSON.parse(state) : null,
            network: [...media.values()].map(
              ({ status, headersMs, firstChunkMs }) => ({
                status,
                headersMs,
                firstChunkMs,
              }),
            ),
          });
          await context.close();
          if (error) break; // Do not retry a blocked media URL with another mode/client.
        }
      }
      // Optional official iframe control ONLY for the independently licensed Carefree track.
      // Its success is explicitly excluded from native stream feasibility.
      if (officialRequested && run === 1) {
        const controlTrack = items.find(
          (item) =>
            /^carefree$/i.test(item.title) &&
            /kevin macleod/i.test(item.artist),
        );
        if (!controlTrack)
          official.push({ outcome: 'LICENSED_CONTROL_NOT_FOUND' });
        else {
          const context = await browser.newContext({ serviceWorkers: 'block' });
          const page = await context.newPage();
          const httpFailures = [];
          page.on('response', (response) => {
            const url = new URL(response.url());
            if (
              (url.hostname.endsWith('.youtube.com') ||
                url.hostname.endsWith('.googlevideo.com') ||
                url.hostname.endsWith('.ytimg.com')) &&
              response.status() >= 400
            )
              httpFailures.push({
                host: url.hostname,
                status: response.status(),
              });
          });
          let outcome = 'NOT_PLAYED';
          try {
            await page.goto(`${origin}/__youtube/`);
            await page.locator('#video-id').fill(controlTrack.id);
            await page
              .getByRole('button', { name: 'Seleziona ID', exact: true })
              .click();
            await page.locator('#official-load').click();
            await page.waitForFunction(
              () => !document.querySelector('#official-play').disabled,
              undefined,
              { timeout: 15000 },
            );
            await page.locator('#official-play').click();
            await page.waitForFunction(
              () => {
                const events = JSON.parse(
                  document.querySelector('#diagnostic').textContent,
                ).official;
                return events.some(
                  (e) =>
                    e.event === 'error' ||
                    (e.event === 'state' && e.code === 1),
                );
              },
              undefined,
              { timeout: 20000 },
            );
            const events = JSON.parse(
              await page.locator('#diagnostic').textContent(),
            ).official;
            outcome = events.some((e) => e.event === 'state' && e.code === 1)
              ? 'FOREGROUND_IFRAME_STATE_PLAYING'
              : 'IFRAME_ERROR';
          } catch {
            outcome = 'IFRAME_SDK_OR_PLAYBACK_UNAVAILABLE';
          }
          official.push({
            videoId: controlTrack.id,
            outcome,
            httpFailures,
            contentLicenseReference:
              'https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1400037',
            diagnostic: JSON.parse(
              await page.locator('#diagnostic').textContent(),
            ).official,
          });
          await context.close();
        }
      }
    } finally {
      await app.close();
    }
  }
} finally {
  await browser.close();
}
const distribution = (values) => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  return {
    n: sorted.length,
    p50Ms: sorted[Math.max(0, Math.ceil(sorted.length * 0.5) - 1)] ?? null,
    p95Ms: sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] ?? null,
  };
};
const summary = {
  catalog: ['cold', 'warm'].map((phase) => ({
    phase,
    totalMs: distribution(
      catalog
        .filter((r) => r.phase === phase && r.status === 200)
        .map((r) => r.totalMs),
    ),
  })),
  resolved: resolutions.filter((r) => r.resolution === 'available').length,
  blocked: resolutions.filter((r) =>
    ['DISABLED', 'NO_AUTHORIZED_SOURCE'].includes(r.outcome),
  ).length,
  failed: resolutions.filter((r) => r.resolution === 'error').length,
  upstreamResolutionMs: distribution(
    resolutions.filter((r) => r.phase === 'cold').map((r) => r.upstreamMs),
  ),
  nativeClickToPlayingMs: distribution(
    playback.map((r) => r.diagnostic?.native.clickToPlayingMs),
  ),
  nativePreparationMs: distribution(
    playback.flatMap(
      (r) =>
        r.diagnostic?.native.preparations.map((p) =>
          p.readyAt === undefined ? null : p.readyAt - p.startedAt,
        ) ?? [],
    ),
  ),
  nativeNextClickToPlayingMs: distribution(
    playback.flatMap(
      (r) =>
        r.diagnostic?.native.attempts
          .filter((a) => a.kind === 'next')
          .map((a) =>
            a.playingAt === undefined ? null : a.playingAt - a.clickAt,
          ) ?? [],
    ),
  ),
};
const report = {
  startedAt,
  completedAt: new Date().toISOString(),
  node: process.version,
  os: process.platform,
  chromium: browser.version(),
  library: 'youtubei.js@18.1.0',
  runs,
  directEnabled: enabled,
  officialRequested,
  summary,
  catalog,
  resolutions,
  playback,
  official,
  definition:
    'Cold: new API/provider/in-memory cache per sample. Warm: immediate repeat, successful results only. OS/DNS/TLS/remote caches uncontrolled. p50/p95 nearest rank; small sample. Blocked results are not stream failures and null metrics are not zero. Media/CDP and playing events are desktop observations, not audible iPhone output. Iframe control is not native playback. No signed media URLs, cookies, tokens or raw error bodies retained.',
};
await mkdir('docs/performance', { recursive: true });
await writeFile(
  'docs/performance/m5-live.json',
  `${JSON.stringify(report, null, 2)}\n`,
);
console.log(
  JSON.stringify(
    {
      path: 'docs/performance/m5-live.json',
      summary,
      official: official.map(({ outcome, httpFailures }) => ({
        outcome,
        httpFailures,
      })),
    },
    null,
    2,
  ),
);
if (catalog.some((r) => r.status !== 200) || playback.some((r) => r.error))
  process.exitCode = 1;
