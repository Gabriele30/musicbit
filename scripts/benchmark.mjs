import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

// Live network experiment, separate from deterministic CI. No audio files saved.
const base = process.env.MUSICBIT_BASE_URL ?? 'http://127.0.0.1:4173';
const label = process.env.BENCHMARK_LABEL ?? 'manual';
if (!/^[a-z0-9-]+$/i.test(label)) throw new Error('Invalid BENCHMARK_LABEL');
const prepared = process.env.BENCHMARK_PREPARE === '1';
const direct = process.env.BENCHMARK_DIRECT === '1';
const runs = Number(process.env.BENCHMARK_RUNS ?? 3);
if (!Number.isInteger(runs) || runs < 1 || runs > 20)
  throw new Error('BENCHMARK_RUNS: 1–20');
const browser = await chromium.launch({
  args: direct ? ['--no-proxy-server'] : [],
});
const samples = [];
try {
  for (let i = 0; i < runs; i++) {
    const context = await browser.newContext({ serviceWorkers: 'block' });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    const requests = new Map();
    cdp.on('Network.requestWillBeSent', (event) => {
      if (event.request.url.includes('SoundHelix-Song-1.mp3'))
        requests.set(event.requestId, {
          start: event.timestamp,
          wallTimeMs: event.wallTime * 1000,
          url: event.request.url,
        });
    });
    cdp.on('Network.responseReceived', (event) => {
      const request = requests.get(event.requestId);
      if (!request) return;
      Object.assign(request, {
        status: event.response.status,
        protocol: event.response.protocol,
        timing: event.response.timing,
        cache: event.response.fromDiskCache,
      });
    });
    cdp.on('Network.dataReceived', (event) => {
      const request = requests.get(event.requestId);
      if (request && request.firstByteMs === undefined)
        request.firstByteMs = (event.timestamp - request.start) * 1000;
    });
    await page.addInitScript(() => {
      window.benchmarkEvents = [];
      for (const event of [
        'loadstart',
        'loadeddata',
        'canplay',
        'playing',
        'waiting',
        'error',
      ])
        document.addEventListener(
          event,
          (e) => {
            if (e.target instanceof HTMLAudioElement)
              window.benchmarkEvents.push({ event, at: performance.now() });
          },
          true,
        );
    });
    await page.goto(base);
    const play = page.getByRole('button', {
      name: 'Riproduci SoundHelix Song 1',
      exact: true,
    });
    await play.waitFor();
    await page.locator('audio').evaluate((audio) => {
      audio.volume = 0;
    });
    let preparationHarnessMs;
    let error;
    if (prepared) {
      const start = Date.now();
      const prepare = page.getByRole('button', {
        name: 'Prepara traccia',
        exact: true,
      });
      await prepare.evaluate((button) =>
        button.addEventListener(
          'click',
          () => {
            window.benchmarkPrepare = performance.now();
          },
          { once: true, capture: true },
        ),
      );
      await prepare.click();
      try {
        await page.waitForFunction(
          () => document.querySelector('audio').readyState >= 3,
          {},
          { timeout: 25000 },
        );
      } catch (e) {
        error = `Preparation failed: ${e.message.split('\n')[0]}`;
      }
      preparationHarnessMs = Date.now() - start;
    }
    await play.evaluate((button) => {
      button.addEventListener(
        'click',
        () => {
          window.benchmarkClick = performance.now();
        },
        { once: true, capture: true },
      );
    });
    try {
      if (error) throw new Error(error);
      await play.click();
      await page.waitForFunction(
        () =>
          window.benchmarkEvents.some(
            (e) => e.event === 'playing' && e.at >= window.benchmarkClick,
          ),
        {},
        { timeout: 25000 },
      );
    } catch (e) {
      error = e.message.split('\n')[0];
    }
    const sample = await page.evaluate(() => {
      const click = window.benchmarkClick;
      const api = performance
        .getEntriesByType('resource')
        .find((e) => e.name.endsWith('/api/tracks'));
      const events = window.benchmarkEvents;
      return {
        timeOrigin: performance.timeOrigin,
        preparationMs:
          window.benchmarkPrepare === undefined
            ? undefined
            : events.find(
                (e) => e.event === 'canplay' && e.at >= window.benchmarkPrepare,
              )?.at - window.benchmarkPrepare,
        clickAt: click,
        events,
        clickToPlayingMs:
          events.find((e) => e.event === 'playing' && e.at >= click)?.at -
          click,
        api: api
          ? {
              totalMs: api.duration,
              headersMs: api.responseStart - api.startTime,
              bodyMs: api.responseEnd - api.responseStart,
            }
          : null,
        audio: {
          readyState: document.querySelector('audio').readyState,
          error: document.querySelector('audio').error?.message,
        },
      };
    });
    const network = [...requests.values()].map((request) => ({
      ...request,
      startPageAt: request.wallTimeMs - sample.timeOrigin,
      firstChunkPageAt:
        request.firstByteMs === undefined
          ? undefined
          : request.wallTimeMs - sample.timeOrigin + request.firstByteMs,
    }));
    const first = network[0];
    const decoded = sample.events.find((e) => e.event === 'loadeddata');
    samples.push({
      run: i + 1,
      preparationHarnessMs,
      error,
      ...sample,
      network,
      phases: {
        clickToMediaRequestMs:
          prepared || !first ? undefined : first.startPageAt - sample.clickAt,
        requestToHeadersMs: first?.timing
          ? first.timing.receiveHeadersStart - first.timing.sendEnd
          : undefined,
        firstChunkToDecodedApproxMs:
          decoded && first?.firstChunkPageAt !== undefined
            ? decoded.at - first.firstChunkPageAt
            : undefined,
      },
    });
    console.log(JSON.stringify(samples.at(-1)));
    await context.close();
  }
  await mkdir('docs/performance', { recursive: true });
  await writeFile(
    `docs/performance/${label}.json`,
    JSON.stringify(
      {
        testedAt: new Date().toISOString(),
        label,
        base,
        prepared,
        direct,
        browser: browser.version(),
        methodology:
          'Fresh Chromium context each run; HTTP cache disabled, SW blocked, no throttling; OS DNS/TLS caches and remote load uncontrolled. UI/preparation times use performance.now; preparationHarnessMs includes automation overhead. CDP firstByte is first dataReceived event; alignment via CDP wallTime/performance.timeOrigin is approximate. Request-to-headers includes RTT, not pure server compute. Volume zero; no physical sound or iPhone proof.',
        samples,
      },
      null,
      2,
    ) + '\n',
  );
} finally {
  await browser.close();
}
