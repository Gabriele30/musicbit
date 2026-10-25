import { expect, test, type Page } from '@playwright/test';
import { emptyLibrary } from '../../packages/shared/dist/index.js';
import { openDiagnostics, openPlayer, openQueue } from './navigation';

test.use({ serviceWorkers: 'block' });

async function fixture(
  page: Page,
  metadataDelayMs = 0,
  rolling = false,
  longLive = false,
) {
  await page.goto('/api/app-update');
  const supported = await page.evaluate(() =>
    document
      .createElement('audio')
      .canPlayType('application/vnd.apple.mpegurl'),
  );
  test.skip(
    !supported,
    'This platform has no native HLS decoder; progressive playback is covered separately.',
  );
  // Authentication has its own real-API suite. Decoder fixtures use isolated
  // account state, so parallel media tests do not exhaust the shared IP limit.
  const user = {
    id: crypto.randomUUID(),
    username: 'hls_fixture',
    displayName: 'HLS fixture',
    color: '#ddf896',
    createdAt: Date.now(),
  };
  await page.route('**/api/auth/session', (route) =>
    route.fulfill({ json: { user, registrationEnabled: false } }),
  );
  await page.route('**/api/me/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    const data = route.request().postDataJSON();
    const json =
      path === '/api/me/library'
        ? {
            revision: 0,
            library: data?.library ?? emptyLibrary(),
            updatedAt: Date.now(),
          }
        : path === '/api/me/playback'
          ? {
              revision: 0,
              session: data?.session ?? null,
              deviceId: data?.deviceId ?? null,
              updatedAt: Date.now(),
            }
          : path === '/api/me/audio-cache'
            ? { enabled: false }
            : { items: [], artists: [], accepted: data?.events?.length ?? 0 };
    return route.fulfill({ json });
  });
  await page.route('**/api/me/continuous', (route) =>
    route.fulfill({ json: { enabled: true } }),
  );
  await page.route('**/api/me/continuous/*', async (route) => {
    const request = route.request();
    const response = await route.fetch({
      url: request.url().replace('/api/me/continuous/', '/__test_continuous/'),
      ...(request.method() === 'POST'
        ? {
            postData: {
              ...request.postDataJSON(),
              metadataDelayMs,
              rolling,
              longLive,
            },
          }
        : {}),
    });
    await route.fulfill({ response });
  });
  await page.route('**/api/tracks', async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    data.tracks.forEach(
      (
        track: { id: string; audioUrl: string; durationSeconds: number },
        index: number,
      ) => {
        track.id = longLive
          ? `longtone${String(index + 1).padStart(3, '0')}`
          : rolling
            ? `rolltone${String(index).padStart(3, '0')}`
            : `hlstone000${index + 1}`;
        track.audioUrl = `/api/audio/${track.id}`;
        track.durationSeconds = longLive ? 45 : rolling ? 0.522 : 8;
      },
    );
    await route.fulfill({ response, json: data });
  });
  await page.goto('/?screen=player&demo=1');
  await expect(
    page.getByRole('heading', { name: 'SoundHelix Song 1', exact: true }),
  ).toBeVisible();
  await openDiagnostics(page);
  await expect(
    page.getByText('continuous:enabled', { exact: false }),
  ).toBeAttached();
  await openPlayer(page);
  if (rolling) {
    await page.route('**/api/me/radio/*', (route) =>
      route.fulfill({
        json: {
          seedId: new URL(route.request().url()).pathname.split('/').at(-1),
          items: [],
          timing: { cache: 'hit', elapsedMs: 0 },
          retry: true,
        },
      }),
    );
    await page.getByRole('switch', { name: 'Ascolto infinito' }).click();
  }
  await page.locator('audio').evaluate((audio) => {
    audio.dataset.instance = 'native-hls-owner';
    const descriptor = Object.getOwnPropertyDescriptor(
      HTMLMediaElement.prototype,
      'currentTime',
    )!;
    Object.defineProperty(audio, 'currentTime', {
      configurable: true,
      get: () => descriptor.get!.call(audio),
      set: (value: number) => {
        const seeks: number[] = JSON.parse(audio.dataset.seeks ?? '[]');
        audio.dataset.seeks = JSON.stringify([...seeks, value]);
        descriptor.set!.call(audio, value);
      },
    });
  });
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect
    .poll(
      () =>
        page
          .locator('audio')
          .evaluate((audio: HTMLAudioElement) => audio.currentTime),
      { timeout: 15000 },
    )
    .toBeGreaterThan(0.25);
  const source = await page
    .locator('audio')
    .evaluate((audio: HTMLAudioElement) => audio.currentSrc);
  expect(source).toMatch(/\/api\/continuous\/[a-f0-9-]{36}\/index\.m3u8$/);
  return source;
}

test('native HLS never reapplies a consumed seek when delayed metadata and rebuffer events arrive', async ({
  page,
}) => {
  await fixture(page, 7000);
  await expect
    .poll(() =>
      page
        .locator('audio')
        .evaluate((audio: HTMLAudioElement) => audio.currentTime),
    )
    .toBeGreaterThan(1.5);
  const clock = await page
    .locator('audio')
    .evaluate((audio: HTMLAudioElement) => {
      const before = audio.currentTime;
      const seeks = JSON.parse(audio.dataset.seeks ?? '[]').length;
      // Reproduce event ordering at recovery while the timeline request is late.
      audio.dispatchEvent(new Event('waiting'));
      audio.dispatchEvent(new Event('canplay'));
      audio.dispatchEvent(new Event('playing'));
      return {
        before,
        after: audio.currentTime,
        seeks,
        nextSeeks: JSON.parse(audio.dataset.seeks ?? '[]').length,
      };
    });
  expect(clock.after).toBeGreaterThanOrEqual(clock.before - 0.05);
  expect(clock.nextSeeks).toBe(clock.seeks);
  await expect
    .poll(() =>
      page
        .locator('audio')
        .evaluate((audio: HTMLAudioElement) => audio.currentTime),
    )
    .toBeGreaterThan(clock.before + 0.5);
  await expect(page.locator('audio')).toHaveCount(1);
  await expect(page.locator('audio')).toHaveAttribute(
    'data-instance',
    'native-hls-owner',
  );
});

test('native HLS A halfway to B and back to A starts from zero while pause and play retain position', async ({
  page,
}) => {
  const source = await fixture(page);
  await expect(
    page.getByRole('slider', { name: 'Posizione nella traccia' }),
  ).toHaveAttribute('max', /8/);
  await page
    .getByRole('slider', { name: 'Posizione nella traccia' })
    .fill('3.5');
  await expect
    .poll(() =>
      page
        .locator('audio')
        .evaluate((audio: HTMLAudioElement) => audio.currentTime),
    )
    .toBeGreaterThanOrEqual(3.4);
  await page
    .getByRole('button', { name: 'Traccia successiva', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'SoundHelix Song 2', exact: true }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page
        .locator('audio')
        .evaluate((audio: HTMLAudioElement) => audio.currentTime),
    )
    .toBeGreaterThan(8);
  await page.getByRole('slider', { name: 'Posizione nella traccia' }).fill('3');
  await expect
    .poll(() =>
      page
        .locator('audio')
        .evaluate((audio: HTMLAudioElement) => audio.currentTime),
    )
    .toBeGreaterThan(10.9);
  await openQueue(page);
  await page
    .getByRole('button', {
      name: 'Riproduci posizione 1: SoundHelix Song 1',
      exact: true,
    })
    .click();
  await expect
    .poll(() =>
      page
        .locator('audio')
        .evaluate((audio: HTMLAudioElement) => audio.currentTime),
    )
    .toBeLessThan(1.5);
  await openPlayer(page);
  await expect(
    page.getByRole('heading', { name: 'SoundHelix Song 1', exact: true }),
  ).toBeVisible();
  await page.getByRole('slider', { name: 'Posizione nella traccia' }).fill('2');
  await page.getByRole('button', { name: 'Pausa', exact: true }).click();
  const paused = await page
    .locator('audio')
    .evaluate((audio: HTMLAudioElement) => audio.currentTime);
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect
    .poll(() =>
      page
        .locator('audio')
        .evaluate((audio: HTMLAudioElement) => audio.currentTime),
    )
    .toBeGreaterThan(paused);
  expect(
    await page
      .locator('audio')
      .evaluate((audio: HTMLAudioElement) => audio.currentTime),
  ).toBeLessThan(paused + 1.5);
  expect(
    await page
      .locator('audio')
      .evaluate((audio: HTMLAudioElement) => audio.currentSrc),
  ).toBe(source);
  await expect(page.locator('audio')).toHaveAttribute(
    'data-instance',
    'native-hls-owner',
  );
});

test('native HLS crosses a real AAC discontinuity without a new source or a backwards seek', async ({
  page,
}) => {
  const source = await fixture(page);
  await page.locator('audio').evaluate(async (audio) => {
    const context = new AudioContext();
    const analyser = context.createAnalyser();
    context.createMediaElementSource(audio).connect(analyser);
    analyser.connect(context.destination);
    const samples = new Float32Array(analyser.fftSize);
    Object.defineProperty(window, '__hlsDecodedRms', {
      value: () => {
        analyser.getFloatTimeDomainData(samples);
        return Math.sqrt(
          samples.reduce((sum, value) => sum + value * value, 0) /
            samples.length,
        );
      },
    });
    await context.resume();
  });
  const decodedRms = () =>
    page.evaluate(() =>
      (window as Window & { __hlsDecodedRms: () => number }).__hlsDecodedRms(),
    );
  await expect.poll(decodedRms).toBeGreaterThan(0.001);
  await expect(
    page.getByRole('slider', { name: 'Posizione nella traccia' }),
  ).toHaveAttribute('max', /8/);
  await page
    .getByRole('slider', { name: 'Posizione nella traccia' })
    .fill('7.4');
  await expect
    .poll(() =>
      page
        .locator('audio')
        .evaluate((audio: HTMLAudioElement) => audio.currentTime),
    )
    .toBeGreaterThan(7.3);
  const seeks = await page
    .locator('audio')
    .evaluate((audio) => audio.dataset.seeks);
  await expect(
    page.getByRole('heading', { name: 'SoundHelix Song 2', exact: true }),
  ).toBeVisible({ timeout: 10000 });
  await expect
    .poll(() =>
      page
        .locator('audio')
        .evaluate((audio: HTMLAudioElement) => audio.currentTime),
    )
    .toBeGreaterThan(8.25);
  // A moving native clock alone does not establish decoded sound. Sample actual
  // PCM after the discontinuity through the same element's native decoder.
  await expect.poll(decodedRms).toBeGreaterThan(0.001);
  expect(
    await page.locator('audio').evaluate((audio) => audio.dataset.seeks),
  ).toBe(seeks);
  expect(
    await page
      .locator('audio')
      .evaluate((audio: HTMLAudioElement) => audio.currentSrc),
  ).toBe(source);
  const id = source.match(/\/continuous\/([^/]+)/)![1];
  const stats = await page.request
    .get(`/__test_continuous/${id}/stats`)
    .then((response) => response.json());
  expect(stats.manifests).toBeGreaterThan(0);
  expect(stats.segments).toContain(1);
  await expect(page.locator('audio')).toHaveCount(1);
  await expect(page.locator('audio')).toHaveAttribute(
    'data-instance',
    'native-hls-owner',
  );
});

test('native HLS advances while page JavaScript is suspended and catches up without rewinding on resume', async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'Script suspension uses Chromium CDP.');
  const source = await fixture(page);
  await expect(
    page.getByRole('slider', { name: 'Posizione nella traccia' }),
  ).toHaveAttribute('max', /8/);
  await page.getByRole('slider', { name: 'Posizione nella traccia' }).fill('7');
  await expect
    .poll(() =>
      page
        .locator('audio')
        .evaluate((audio: HTMLAudioElement) => audio.currentTime),
    )
    .toBeGreaterThanOrEqual(6.9);
  const seeks = await page
    .locator('audio')
    .evaluate((audio) => audio.dataset.seeks);
  const devtools = await page.context().newCDPSession(page);
  try {
    await devtools.send('Emulation.setScriptExecutionDisabled', {
      value: true,
    });
    // Native HTTP/AAC playback stays active while React, timers and timeupdate
    // handlers cannot run. This is a controlled page suspension, not an iOS test.
    await new Promise((done) => setTimeout(done, 2800));
  } finally {
    await devtools.send('Emulation.setScriptExecutionDisabled', {
      value: false,
    });
    await devtools.detach();
  }
  expect(
    await page
      .locator('audio')
      .evaluate((audio: HTMLAudioElement) => audio.currentTime),
  ).toBeGreaterThan(9);
  await expect(
    page.getByRole('heading', { name: 'SoundHelix Song 2', exact: true }),
  ).toBeVisible();
  expect(
    await page.locator('audio').evaluate((audio) => audio.dataset.seeks),
  ).toBe(seeks);
  expect(
    await page
      .locator('audio')
      .evaluate((audio: HTMLAudioElement) => audio.currentSrc),
  ).toBe(source);
  await expect(page.locator('audio')).toHaveCount(1);
});

test('native infinite HLS keeps its absolute clock and compacts the queue when the real segment window rolls', async ({
  page,
}) => {
  const source = await fixture(page, 0, true);
  const id = source.match(/\/continuous\/([^/]+)/)![1];
  const clockSamples: number[] = [];
  let stats: {
    queueStart: number;
    manifestStarts: number[];
    available: number;
    trackDuration: number;
  };
  await expect
    .poll(
      async () => {
        clockSamples.push(
          await page
            .locator('audio')
            .evaluate((audio: HTMLAudioElement) => audio.currentTime),
        );
        stats = await page.request
          .get(`/__test_continuous/${id}/stats`)
          .then((response) => response.json());
        return Math.min(stats.queueStart, Math.max(...stats.manifestStarts));
      },
      { timeout: 25000, intervals: [250] },
    )
    .toBeGreaterThanOrEqual(3);
  for (let index = 1; index < clockSamples.length; index++)
    expect(clockSamples[index]).toBeGreaterThanOrEqual(
      clockSamples[index - 1] - 0.05,
    );
  expect(clockSamples.at(-1)).toBeGreaterThan(10);
  await openQueue(page);
  await expect(
    page.getByRole('button', {
      name: 'Riproduci posizione 1: SoundHelix Song 1',
      exact: true,
    }),
  ).toHaveCount(0);
  await expect
    .poll(() => page.locator('.queue-list li').count())
    .toBeLessThan(33);
  expect(
    await page
      .locator('audio')
      .evaluate((audio: HTMLAudioElement) => audio.currentTime),
  ).toBeGreaterThan(stats!.queueStart * stats!.trackDuration);
  expect(
    await page
      .locator('audio')
      .evaluate((audio: HTMLAudioElement) => audio.currentSrc),
  ).toBe(source);
  await expect(page.locator('audio')).toHaveAttribute(
    'data-instance',
    'native-hls-owner',
  );
  await expect(page.locator('audio')).toHaveCount(1);
});

test('native AAC HLS keeps its source and clock through rate changes and rapid skips', async ({
  page,
}) => {
  const source = await fixture(page);
  const owner = await page.locator('audio').elementHandle();
  const speed = page.getByLabel('Velocità di riproduzione', { exact: true });
  await speed.selectOption('2');
  await page.getByRole('slider', { name: 'Posizione nella traccia' }).fill('2');
  await expect
    .poll(() =>
      page
        .getByRole('slider', { name: 'Posizione nella traccia' })
        .inputValue()
        .then(Number),
    )
    .toBeGreaterThan(2.2);
  await page
    .getByRole('button', { name: 'Traccia successiva', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Traccia successiva', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'SoundHelix Song 3', exact: true }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page
        .getByRole('slider', { name: 'Posizione nella traccia' })
        .inputValue()
        .then(Number),
    )
    .toBeGreaterThan(0.2);
  expect(
    await page
      .locator('audio')
      .evaluate((audio: HTMLAudioElement) => audio.playbackRate),
  ).toBe(2);
  expect(
    await page
      .locator('audio')
      .evaluate((audio: HTMLAudioElement) => audio.currentSrc),
  ).toBe(source);
  await speed.selectOption('0.75');
  const start = Number(
    await page
      .getByRole('slider', { name: 'Posizione nella traccia' })
      .inputValue(),
  );
  await expect
    .poll(() =>
      page
        .getByRole('slider', { name: 'Posizione nella traccia' })
        .inputValue()
        .then(Number),
    )
    .toBeGreaterThan(start + 0.25);
  expect(
    await owner!.evaluate((audio) => audio === document.querySelector('audio')),
  ).toBe(true);
  await expect(page.locator('audio')).toHaveCount(1);
});

test('healthy live HLS remains native until an unsupported manual seek needs AAC recovery', async ({
  page,
}) => {
  await fixture(page, 0, false, true);
  const owner = await page.locator('audio').elementHandle();
  await page.waitForTimeout(3200);
  await expect
    .poll(
      () =>
        page
          .locator('audio')
          .evaluate((a: HTMLAudioElement) => new URL(a.currentSrc).pathname),
      { timeout: 10000 },
    )
    .toMatch(/^\/api\/continuous\/[a-f0-9-]+\/index\.m3u8$/);
  await expect
    .poll(() =>
      page.locator('audio').evaluate((a: HTMLAudioElement) => a.currentTime),
    )
    .toBeGreaterThan(0.25);
  const signal = await page
    .locator('audio')
    .evaluate(async (audio: HTMLAudioElement) => {
      const context = new AudioContext(),
        analyser = context.createAnalyser();
      analyser.fftSize = 2048;
      context.createMediaElementSource(audio).connect(analyser);
      analyser.connect(context.destination);
      await context.resume();
      let peak = 0;
      for (let i = 0; i < 5; i++) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        const samples = new Float32Array(analyser.fftSize);
        analyser.getFloatTimeDomainData(samples);
        peak = Math.max(
          peak,
          Math.sqrt(
            samples.reduce((sum, value) => sum + value * value, 0) /
              samples.length,
          ),
        );
      }
      // Keep the context alive until this page closes; closing it would mute its source.
      Object.defineProperty(window, '__liveRegressionContext', {
        value: context,
      });
      return peak;
    });
  expect(signal).toBeGreaterThan(0.001);
  await page
    .getByRole('slider', { name: 'Posizione nella traccia' })
    .fill('20');
  await expect
    .poll(() =>
      page
        .locator('audio')
        .evaluate((a: HTMLAudioElement) => new URL(a.currentSrc).pathname),
    )
    .toBe('/api/audio/longtone001');
  await expect
    .poll(() =>
      page.locator('audio').evaluate((a: HTMLAudioElement) => a.currentTime),
    )
    .toBeGreaterThan(20.2);
  await page
    .getByRole('button', { name: 'Traccia successiva', exact: true })
    .click();
  await expect
    .poll(() =>
      page
        .locator('audio')
        .evaluate((a: HTMLAudioElement) => new URL(a.currentSrc).pathname),
    )
    .toBe('/api/audio/longtone002');
  await expect
    .poll(() =>
      page.locator('audio').evaluate((a: HTMLAudioElement) => a.currentTime),
    )
    .toBeGreaterThan(0.25);
  expect(
    await owner!.evaluate((a) => a === document.querySelector('audio')),
  ).toBe(true);
  await expect(page.locator('audio')).toHaveCount(1);
});
