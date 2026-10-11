import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { buildPlaybackLab } from '../apps/api/dist/playback/lab.js';
import { PlaybackResolver } from '../apps/api/dist/playback/resolver.js';

// Explicit live experiment: authorized SoundHelix MP3, native playback only.
// No media bytes written to disk. Each sample has a new browser context/server cache.
const runs = Number(process.env.PLAYBACK_BENCHMARK_RUNS ?? 5);
if (!Number.isInteger(runs) || runs < 1 || runs > 20)
  throw new Error('PLAYBACK_BENCHMARK_RUNS: 1–20');
const label = process.env.PLAYBACK_BENCHMARK_LABEL ?? 'm4-live';
if (!/^[a-z0-9-]+$/i.test(label)) throw new Error('Invalid label');
const mainBase = process.env.MUSICBIT_BASE_URL ?? 'http://127.0.0.1:4173';
const browser = await chromium.launch();
const samples = [];
const reference = {
  catalogProvider: 'soundhelix-demo',
  catalogId: 'soundhelix-1',
};
const modes = [
  'main-direct',
  'main-prepared',
  'lab-cold-direct',
  'lab-warm-direct',
  'lab-warm-prepared',
];
// Rotate scenario order to reduce systematic ordering bias. OS caches remain uncontrolled.
const schedule = Array.from({ length: runs }, (_, index) =>
  modes.map((_, offset) => ({
    run: index + 1,
    mode: modes[(index + offset) % modes.length],
  })),
).flat();
try {
  for (const { mode, run } of schedule) {
    const lab = mode.startsWith('lab');
    const prepared = mode.endsWith('prepared');
    const resolver = new PlaybackResolver();
    const app = lab ? buildPlaybackLab({}, resolver) : undefined;
    if (lab && mode.includes('warm'))
      await resolver.resolve(reference, new AbortController().signal);
    const origin = app
      ? await app.listen({ host: '127.0.0.1', port: 0 })
      : mainBase;
    const context = await browser.newContext({ serviceWorkers: 'block' });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    const requests = new Map();
    cdp.on('Network.requestWillBeSent', (event) => {
      if (
        /^https:\/\/www\.soundhelix\.com\/examples\/mp3\//.test(
          event.request.url,
        )
      )
        requests.set(event.requestId, {
          start: event.timestamp,
          wallTimeMs: event.wallTime * 1000,
        });
    });
    cdp.on('Network.responseReceived', (event) => {
      const request = requests.get(event.requestId);
      if (request)
        Object.assign(request, {
          status: event.response.status,
          protocol: event.response.protocol,
          timing: event.response.timing,
          fromDiskCache: event.response.fromDiskCache,
        });
    });
    cdp.on('Network.dataReceived', (event) => {
      const request = requests.get(event.requestId);
      if (request && request.firstChunkMs === undefined)
        request.firstChunkMs = (event.timestamp - request.start) * 1000;
    });
    await page.addInitScript(() => {
      window.m4Events = [];
      for (const name of [
        'loadstart',
        'loadeddata',
        'canplay',
        'playing',
        'waiting',
        'error',
      ])
        document.addEventListener(
          name,
          (event) => {
            if (event.target instanceof HTMLAudioElement)
              window.m4Events.push({ event: name, at: performance.now() });
          },
          true,
        );
    });
    let error;
    let next;
    let denied;
    try {
      await page.goto(lab ? `${origin}/__playback/` : origin);
      if (lab) {
        await page.getByRole('button', { name: 'Cerca', exact: true }).click();
        await page
          .getByRole('button', {
            name: 'SoundHelix Song 1 · T. Schürger',
            exact: true,
          })
          .click();
        await page.waitForFunction(
          () => !document.querySelector('#play').disabled,
        );
      }
      await page.locator('audio').evaluate((audio) => {
        audio.volume = 0;
      });
      const play = page.getByRole('button', {
        name: lab ? 'Riproduci' : 'Riproduci SoundHelix Song 1',
        exact: true,
      });
      if (prepared) {
        const button = page.getByRole('button', {
          name: lab ? 'Prepara audio' : 'Prepara traccia',
          exact: true,
        });
        await button.evaluate((element) =>
          element.addEventListener(
            'click',
            () => {
              window.m4Prepare = performance.now();
            },
            { once: true, capture: true },
          ),
        );
        await button.click();
        await page.waitForFunction(
          () => document.querySelector('audio').readyState >= 3,
          undefined,
          { timeout: 20000 },
        );
      }
      await play.evaluate((element) =>
        element.addEventListener(
          'click',
          () => {
            window.m4Click = performance.now();
          },
          { once: true, capture: true },
        ),
      );
      await play.click();
      await page.waitForFunction(
        () =>
          window.m4Events.some(
            (event) => event.event === 'playing' && event.at >= window.m4Click,
          ),
        undefined,
        { timeout: 20000 },
      );
      if (mode === 'lab-warm-direct') {
        const before = await page.locator('audio').evaluate((audio) => ({
          source: audio.currentSrc,
          position: audio.currentTime,
        }));
        const requestCount = requests.size;
        await page
          .getByRole('button', { name: 'Risolvi prossima demo', exact: true })
          .click();
        await page.waitForFunction(() =>
          document
            .querySelector('#next-status')
            .textContent.includes('Descrittore pronto'),
        );
        await page.waitForFunction(
          (position) =>
            document.querySelector('audio').currentTime > position + 0.1,
          before.position,
        );
        const after = await page.locator('audio').evaluate((audio) => ({
          source: audio.currentSrc,
          position: audio.currentTime,
          paused: audio.paused,
        }));
        next = {
          sourceUnchanged: before.source === after.source,
          continuedPlaying: !after.paused && after.position > before.position,
          extraMediaRequestsDuringResolution: requests.size - requestCount,
        };
        await page
          .getByRole('button', { name: 'Riproduci prossima', exact: true })
          .click();
        await page.waitForFunction(
          () => {
            const state = JSON.parse(
              document.querySelector('#diagnostic').textContent,
            );
            return (
              state.attempts.at(-1)?.kind === 'next' &&
              state.attempts.at(-1).playingAt !== undefined
            );
          },
          undefined,
          { timeout: 20000 },
        );
      }
      if (lab)
        denied = await page.evaluate(async () => {
          const start = performance.now();
          const response = await fetch('/__playback/api/resolve', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              catalogProvider: 'youtube',
              catalogId: 'metadata-only',
            }),
          });
          const data = await response.json();
          return {
            elapsedMs: performance.now() - start,
            status: response.status,
            resolution: data.resolution,
          };
        });
    } catch {
      error = 'HARNESS_TIMEOUT_OR_PLAYBACK_FAILURE';
    }
    const result = await page.evaluate(() => {
      const events = window.m4Events ?? [];
      const playing = events.find(
        (event) => event.event === 'playing' && event.at >= window.m4Click,
      );
      const decoded = events.find((event) => event.event === 'loadeddata');
      const load = events.find((event) => event.event === 'loadstart');
      const canplay = events.find(
        (event) => event.event === 'canplay' && event.at >= window.m4Prepare,
      );
      const api = performance
        .getEntriesByType('resource')
        .find((event) => event.name.endsWith('/api/tracks'));
      const diagnostic = document.querySelector('#diagnostic');
      return {
        timeOrigin: performance.timeOrigin,
        clickAt: window.m4Click,
        events,
        clickToPlayingMs: playing ? playing.at - window.m4Click : null,
        preparationMs: canplay ? canplay.at - window.m4Prepare : null,
        initialBufferEstimateMs: decoded && load ? decoded.at - load.at : null,
        apiMs: api?.duration ?? null,
        lab: diagnostic ? JSON.parse(diagnostic.textContent) : null,
        mediaError: document.querySelector('audio')?.error?.code ?? null,
      };
    });
    const network = [...requests.values()].map((request) => ({
      ...request,
      startPageAt: request.wallTimeMs - result.timeOrigin,
    }));
    const first = network[0];
    const decoded = result.events.find((event) => event.event === 'loadeddata');
    const sample = {
      mode,
      run,
      success: result.clickToPlayingMs !== null && !error,
      error: error ?? null,
      ...result,
      network,
      next,
      denied,
      phases: {
        clickToMediaRequestMs:
          prepared || !first ? null : first.startPageAt - result.clickAt,
        requestToHeadersMs: first?.timing
          ? first.timing.receiveHeadersStart - first.timing.sendEnd
          : null,
        firstChunkToDecodedApproxMs:
          decoded && first?.firstChunkMs !== undefined
            ? decoded.at - first.startPageAt - first.firstChunkMs
            : null,
      },
    };
    samples.push(sample);
    console.log(
      JSON.stringify({
        mode,
        run,
        success: sample.success,
        clickToPlayingMs: sample.clickToPlayingMs,
        preparationMs: sample.preparationMs,
      }),
    );
    await context.close();
    if (app) await app.close();
    else resolver.close();
  }
} finally {
  await browser.close();
}
const distribution = (values) => {
  const sorted = values
    .filter((value) => typeof value === 'number' && Number.isFinite(value))
    .sort((a, b) => a - b);
  return {
    n: sorted.length,
    p50: sorted[Math.max(0, Math.ceil(sorted.length * 0.5) - 1)] ?? null,
    p95: sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] ?? null,
  };
};
const summary = Object.fromEntries(
  modes.map((mode) => {
    const selected = samples.filter((sample) => sample.mode === mode);
    return [
      mode,
      {
        success: selected.filter((sample) => sample.success).length,
        failed: selected.filter((sample) => !sample.success).length,
        clickToPlayingMs: distribution(
          selected.map((sample) => sample.clickToPlayingMs),
        ),
        preparationMs: distribution(
          selected.map((sample) => sample.preparationMs),
        ),
        initialBufferEstimateMs: distribution(
          selected.map((sample) => sample.initialBufferEstimateMs),
        ),
        sourceRoundTripMs: distribution(
          selected.map((sample) => sample.lab?.resolutions[0]?.roundTripMs),
        ),
        sourceServerMs: distribution(
          selected.map((sample) => sample.lab?.resolutions[0]?.serverMs),
        ),
        requestToHeadersMs: distribution(
          selected.map((sample) => sample.phases.requestToHeadersMs),
        ),
        nextClickToPlayingMs: distribution(
          selected.map((sample) => {
            const attempt = sample.lab?.attempts.find(
              (item) => item.kind === 'next',
            );
            return attempt?.playingAt === undefined
              ? null
              : attempt.playingAt - attempt.clickAt;
          }),
        ),
      },
    ];
  }),
);
await mkdir('docs/performance', { recursive: true });
await writeFile(
  `docs/performance/${label}.json`,
  JSON.stringify(
    {
      testedAt: new Date().toISOString(),
      environment: {
        node: process.version,
        chromium: browser.version(),
        os: process.platform,
        proxy: 'default browser/system settings',
        context:
          'fresh each sample; HTTP cache disabled; service workers blocked; OS/DNS/TLS cache uncontrolled; muted output',
      },
      runs,
      summary,
      samples,
    },
    null,
    2,
  ) + '\n',
);
console.log(JSON.stringify(summary, null, 2));
if (samples.some((sample) => !sample.success)) process.exitCode = 1;
