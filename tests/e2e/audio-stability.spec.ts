import { test, expect } from '@playwright/test';
import { writeFile, mkdir } from 'node:fs/promises';

test.use({ serviceWorkers: 'block' });
const tracks = Array.from({ length: 12 }, (_, index) => ({
  id: `stress${String(index + 1).padStart(5, '0')}`,
  title: `Stress track ${index + 1}`,
  artist: `Original tone ${index + 1}`,
  album: 'Native audio stability',
  audioUrl: `/__test_media/stress-${index + 1}.wav`,
  artworkUrl: '/artwork/cover-1.svg',
  mimeType: 'audio/wav',
  sourceUrl: 'https://example.com/original-test-audio',
  permission: 'Original test tone',
  attribution: 'MusicBit test fixture',
  durationSeconds: 12 + (index % 4) * 3,
}));
test('twelve native sources keep stable clocks through rates, rapid skips, replay and real ended events', async ({
  page,
}, info) => {
  test.setTimeout(60000);
  await page.route('**/api/tracks', (route) =>
    route.fulfill({ json: { provider: 'demo', tracks } }),
  );
  await page.route('**/api/recommendations/*', (route) =>
    route.fulfill({
      json: {
        seedId: new URL(route.request().url()).pathname.split('/').at(-1),
        items: [],
        timing: { cache: 'hit', elapsedMs: 0 },
      },
    }),
  );
  await page.goto('/?screen=player&demo=1');
  await expect(
    page.getByRole('heading', { name: tracks[0]!.title, exact: true }),
  ).toBeVisible();
  const owner = await page.locator('audio').elementHandle();
  await page.locator('audio').evaluate((audio: HTMLAudioElement) => {
    const events: unknown[] = [];
    Object.defineProperty(window, '__audioStressEvents', { value: events });
    for (const name of [
      'loadstart',
      'playing',
      'waiting',
      'stalled',
      'error',
      'ended',
      'ratechange',
    ])
      audio.addEventListener(name, () =>
        events.push({
          event: name,
          at: performance.now(),
          time: audio.currentTime,
          rate: audio.playbackRate,
          source: audio.currentSrc,
          error: audio.error?.code,
        }),
      );
  });
  await page.getByRole('switch', { name: 'Ascolto infinito' }).click();
  const speed = page.getByLabel('Velocità di riproduzione', { exact: true });
  const rates = [0.75, 1, 1.25, 1.5, 2];
  const metrics: {
    track: string;
    rate: number;
    requestedAt: number;
    progressVerifiedMs: number;
    duration: number;
    position: number;
  }[] = [];
  for (let index = 0; index < tracks.length; index++) {
    const rate = rates[index % rates.length]!;
    await speed.selectOption(String(rate));
    const started = await page.evaluate(() => performance.now());
    await page
      .getByRole('button', {
        name: index === 0 ? 'Play' : 'Traccia successiva',
        exact: true,
      })
      .click();
    await expect
      .poll(() =>
        page.locator('audio').evaluate((audio: HTMLAudioElement) => ({
          path: new URL(audio.currentSrc || location.href).pathname,
          paused: audio.paused,
          ready: audio.readyState >= 2,
        })),
      )
      .toEqual({ path: tracks[index]!.audioUrl, paused: false, ready: true });
    await expect
      .poll(() =>
        page
          .locator('audio')
          .evaluate((audio: HTMLAudioElement) => audio.currentTime),
      )
      .toBeGreaterThan(0.15);
    const current = await page
      .locator('audio')
      .evaluate((audio: HTMLAudioElement) => ({
        time: audio.currentTime,
        duration: audio.duration,
        rate: audio.playbackRate,
        now: performance.now(),
        error: audio.error?.code,
      }));
    expect(current.rate).toBe(rate);
    expect(current.error).toBeUndefined();
    expect(current.duration).toBeCloseTo(tracks[index]!.durationSeconds, 1);
    const samples = await page
      .locator('audio')
      .evaluate(async (audio: HTMLAudioElement) => {
        const samples = [];
        for (let step = 0; step < 3; step++) {
          samples.push({
            position: audio.currentTime,
            at: performance.now(),
            paused: audio.paused,
          });
          await new Promise((resolve) => setTimeout(resolve, 150));
        }
        return samples;
      });
    for (let step = 1; step < samples.length; step++) {
      expect(samples[step]!.position).toBeGreaterThanOrEqual(
        samples[step - 1]!.position - 0.03,
      );
      expect(samples[step]!.paused).toBe(false);
    }
    const progression = samples.at(-1)!.position - samples[0]!.position;
    const wall = (samples.at(-1)!.at - samples[0]!.at) / 1000;
    expect(progression).toBeGreaterThan(wall * rate * 0.4);
    expect(progression).toBeLessThan(wall * rate * 1.6 + 0.1);
    metrics.push({
      track: tracks[index]!.id,
      rate,
      requestedAt: started,
      progressVerifiedMs: current.now - started,
      duration: current.duration,
      position: current.time,
    });
  }
  // Dispatch real UI gestures without waiting for native loading to settle.
  // Each render must update the disabled state at the end of the queue.
  for (let i = 0; i < 10; i++) {
    await page
      .getByRole('button', { name: 'Traccia precedente', exact: true })
      .click();
    await page
      .getByRole('button', { name: 'Traccia successiva', exact: true })
      .click();
  }
  await page
    .getByRole('button', { name: 'Traccia precedente', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: tracks[10]!.title, exact: true }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page
        .locator('audio')
        .evaluate((audio: HTMLAudioElement) => audio.currentSrc),
    )
    .toContain('stress-11.wav');
  await expect
    .poll(() =>
      page
        .locator('audio')
        .evaluate((audio: HTMLAudioElement) => audio.currentTime),
    )
    .toBeGreaterThan(0.15);
  await page
    .getByRole('button', { name: 'Traccia successiva', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: tracks[11]!.title, exact: true }),
  ).toBeVisible();
  await page.getByRole('slider', { name: 'Posizione nella traccia' }).fill('5');
  await page
    .getByRole('button', {
      name: `Riproduci ${tracks[11]!.title}`,
      exact: true,
    })
    .click();
  await expect
    .poll(() =>
      page
        .locator('audio')
        .evaluate((audio: HTMLAudioElement) => audio.currentTime),
    )
    .toBeLessThan(1);
  await speed.selectOption('2');
  await page
    .getByRole('button', { name: 'Ripetizione: disattivata', exact: true })
    .click();
  for (let step = 0; step < 3; step++) {
    const duration = await page
      .locator('audio')
      .evaluate((audio: HTMLAudioElement) => audio.duration);
    await page
      .getByRole('slider', { name: 'Posizione nella traccia' })
      .fill(String(duration - 0.4));
    const expected = tracks[step]!;
    await expect(
      page.getByRole('heading', { name: expected.title, exact: true }),
    ).toBeVisible();
    await expect
      .poll(() =>
        page.locator('audio').evaluate((audio: HTMLAudioElement) => ({
          path: new URL(audio.currentSrc || location.href).pathname,
          playing: !audio.paused && audio.currentTime > 0,
        })),
      )
      .toEqual({ path: expected.audioUrl, playing: true });
  }
  expect(
    await owner!.evaluate((audio) => audio === document.querySelector('audio')),
  ).toBe(true);
  await expect(page.locator('audio')).toHaveCount(1);
  const events = await page.evaluate(
    () =>
      (
        window as unknown as {
          __audioStressEvents: { event: string; at: number; source: string }[];
        }
      ).__audioStressEvents,
  );
  expect(events.filter((entry) => entry.event === 'error')).toEqual([]);
  expect(
    events.filter((entry) => entry.event === 'ended').length,
  ).toBeGreaterThanOrEqual(3);
  const measured = metrics.map((metric, index) => {
    // WebKit can coalesce `playing` events while switching an already-playing
    // element. The source and advancing native clock above are authoritative;
    // keep the event latency as optional diagnostic evidence.
    const playing = events.find(
      (event) =>
        event.event === 'playing' &&
        event.at >= metric.requestedAt &&
        event.at < (metrics[index + 1]?.requestedAt ?? Infinity) &&
        event.source &&
        new URL(event.source).pathname === tracks[index]!.audioUrl,
    );
    const playingEventMs = playing ? playing.at - metric.requestedAt : null;
    expect(metric.progressVerifiedMs).toBeLessThan(3000);
    if (playingEventMs !== null) expect(playingEventMs).toBeLessThan(3000);
    return { ...metric, playingEventMs };
  });
  await mkdir('artifacts/black-audio', { recursive: true });
  await writeFile(
    `artifacts/black-audio/${info.project.name}.json`,
    JSON.stringify({ metrics: measured, events }, null, 2),
  );
});
