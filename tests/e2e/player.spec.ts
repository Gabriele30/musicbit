import { test, expect, type Page } from '@playwright/test';
import { openPlayer, openQueue, openDiagnostics } from './navigation';

// Test server supplies local PCM WAVs to the real native media pipeline.
async function fixture(page: Page) {
  await page.goto('/?screen=player&demo=1');
  await expect(
    page.getByRole('button', {
      name: 'Riproduci SoundHelix Song 1',
      exact: true,
    }),
  ).toBeVisible();
}

test('explicit preparation keeps one audio element, does not autoplay and exports mobile diagnostics', async ({
  page,
}, info) => {
  await fixture(page);
  await page.locator('audio').evaluate((audio) => {
    audio.dataset.instance = 'prepared';
  });
  await openDiagnostics(page);
  await page
    .getByRole('button', { name: 'Prepara traccia', exact: true })
    .click();
  await expect
    .poll(() =>
      page
        .locator('audio')
        .evaluate((audio: HTMLAudioElement) => audio.readyState),
    )
    .toBeGreaterThanOrEqual(3);
  expect(
    await page
      .locator('audio')
      .evaluate((audio: HTMLAudioElement) => audio.paused),
  ).toBe(true);
  const loads = await page
    .locator('audio')
    .evaluate((audio: HTMLAudioElement) => audio.currentSrc);
  await openPlayer(page);
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(
    page.getByRole('status').filter({ hasText: /^In riproduzione$/ }),
  ).toBeVisible();
  await openDiagnostics(page);
  await page.getByRole('button', { name: 'Suono udito' }).click();
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Esporta JSON' }).click();
  const download = await downloadEvent;
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream!) chunks.push(chunk);
  const data = JSON.parse(Buffer.concat(chunks).toString());
  expect(data.state.attempts.at(-1).kind).toBe('prepared');
  expect(data.state.attempts.at(-1).audibleAt).toBeGreaterThanOrEqual(
    data.state.attempts.at(-1).playingAt,
  );
  expect(data.state.catalog.readyAt).toBeGreaterThanOrEqual(
    data.state.catalog.headersAt,
  );
  expect(data.state.buffer.readyState).toBeGreaterThanOrEqual(2);
  expect(data.state.buffer.ahead).toBeGreaterThanOrEqual(0);
  // Native WebKit can play without exposing buffered TimeRanges on Windows.
  expect(Array.isArray(data.state.buffer.ranges)).toBe(true);
  expect(
    await page
      .locator('audio')
      .evaluate((audio: HTMLAudioElement) => audio.currentSrc),
  ).toBe(loads);
  await expect(page.locator('audio')).toHaveCount(1);
  await expect(page.locator('audio')).toHaveAttribute(
    'data-instance',
    'prepared',
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `artifacts/${info.project.name}-diagnostics-m2.png`,
    fullPage: true,
  });
});

test('diagnostics deep link can play and rapid track changes preserve the latest command', async ({
  page,
}) => {
  await page.goto('/?screen=diagnostics');
  const controls = page.locator('.diagnostic-controls');
  await expect(
    controls.getByRole('button', { name: 'Play', exact: true }),
  ).toBeEnabled();
  await controls.getByRole('button', { name: 'Play', exact: true }).click();
  await page.getByRole('button', { name: 'Successiva', exact: true }).click();
  await page.getByRole('button', { name: 'Successiva', exact: true }).click();
  await expect
    .poll(() =>
      page
        .locator('audio')
        .evaluate((audio: HTMLAudioElement) => audio.currentTime),
    )
    .toBeGreaterThan(0);
  expect(
    await page
      .locator('audio')
      .evaluate((audio: HTMLAudioElement) => audio.currentSrc),
  ).toContain('soundhelix-3.wav');
  await expect(page.getByRole('button', { name: 'Suono udito' })).toBeEnabled();
  await expect(page.locator('audio')).toHaveCount(1);
});

test('native audio survives screens and supports controls, seeking and queue changes', async ({
  page,
}, info) => {
  await fixture(page);
  await page.evaluate(() => {
    const audio = document.querySelector('audio')!;
    audio.dataset.instance = 'original';
    audio.volume = 0;
  });
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(
    page.getByRole('status').filter({ hasText: /^In riproduzione$/ }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page
        .locator('audio')
        .evaluate((audio: HTMLAudioElement) => audio.currentTime),
    )
    .toBeGreaterThan(0);
  await page
    .getByRole('button', { name: 'Traccia successiva', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'SoundHelix Song 2', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('status').filter({ hasText: /^In riproduzione$/ }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page
        .locator('audio')
        .evaluate((audio: HTMLAudioElement) => audio.duration),
    )
    .toBe(30);
  await page.getByRole('button', { name: 'Pausa', exact: true }).click();
  await expect(
    page.getByRole('status').filter({ hasText: /^In pausa$/ }),
  ).toBeVisible();
  await page.getByRole('slider').fill('10');
  await expect
    .poll(() =>
      page
        .locator('audio')
        .evaluate((audio: HTMLAudioElement) => audio.currentTime),
    )
    .toBeGreaterThanOrEqual(9.9);
  await openDiagnostics(page);
  await expect(
    page.getByRole('heading', { name: 'Diagnostica', exact: true }),
  ).toBeVisible();
  await expect(page.locator('.metric').last()).not.toHaveText(/—/);
  await expect(page.locator('audio')).toHaveCount(1);
  await expect(page.locator('audio')).toHaveAttribute(
    'data-instance',
    'original',
  );
  await openQueue(page);
  await page.getByRole('button', { name: 'Rimuovi posizione 3' }).click();
  await expect(page.locator('.queue-list li')).toHaveCount(2);
  await openPlayer(page);
  const width = await page.evaluate(() => ({
    content: document.documentElement.scrollWidth,
    viewport: window.innerWidth,
  }));
  expect(width.content).toBeLessThanOrEqual(width.viewport);
  await page.screenshot({
    path: `artifacts/${info.project.name}-player.png`,
    fullPage: true,
  });
});

test('automatically advances after the real ended event', async ({ page }) => {
  await fixture(page);
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(
    page.getByRole('status').filter({ hasText: /^In riproduzione$/ }),
  ).toBeVisible();
  await page.getByRole('slider').fill('29.7');
  await expect(
    page.getByRole('heading', { name: 'SoundHelix Song 2', exact: true }),
  ).toBeVisible({ timeout: 10000 });
  await expect(
    page.getByRole('status').filter({ hasText: /^In riproduzione$/ }),
  ).toBeVisible();
});

test('shows a failed source and recovers by selecting another track', async ({
  page,
}) => {
  await page.route('**/api/tracks', async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    data.tracks[0].audioUrl = '/__test_media/missing.wav';
    await route.fulfill({ json: data });
  });
  await page.goto('/?screen=player&demo=1');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await page
    .getByRole('button', { name: 'Traccia successiva', exact: true })
    .click();
  await expect(
    page.getByRole('status').filter({ hasText: /^In riproduzione$/ }),
  ).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('production PWA has install metadata and an offline shell without cached media', async ({
  page,
  context,
  request,
}) => {
  const response = await request.get('/manifest.webmanifest');
  const manifest = await response.json();
  expect(manifest.name).toBe('MusicBit');
  expect(manifest.display).toBe('standalone');
  expect(
    manifest.icons.some((icon: { sizes: string }) => icon.sizes === '512x512'),
  ).toBe(true);
  await page.goto('/?screen=player&demo=1');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await expect
    .poll(() =>
      page.evaluate(() => Boolean(navigator.serviceWorker.controller)),
    )
    .toBe(true);
  await context.setOffline(true);
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'SoundHelix Song 1', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('API');
  const cached = await page.evaluate(async () =>
    (
      await Promise.all(
        (await caches.keys()).map(async (key) =>
          (await (await caches.open(key)).keys()).map((entry) => entry.url),
        ),
      )
    ).flat(),
  );
  expect(
    cached.some(
      (url) =>
        url.includes('soundhelix.com') ||
        url.includes('/api/tracks') ||
        url.includes('/__test_media/'),
    ),
  ).toBe(false);
  await context.setOffline(false);
});

test('reload restores queue order, repeat and position without autoplay', async ({
  page,
}) => {
  await fixture(page);
  await page
    .getByRole('button', { name: 'Traccia successiva', exact: true })
    .click();
  await expect(
    page.getByRole('status').filter({ hasText: /^In riproduzione$/ }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Pausa', exact: true }).click();
  await page
    .getByRole('slider', { name: 'Posizione nella traccia' })
    .fill('12');
  await page
    .getByRole('button', { name: 'Ripetizione: disattivata', exact: true })
    .click();
  await openQueue(page);
  await page.getByRole('button', { name: 'Rimuovi posizione 3' }).click();
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Coda di riproduzione' }),
  ).toBeVisible();
  await expect(page.locator('.queue-list li')).toHaveCount(2);
  expect(
    await page.locator('audio').evaluate((audio: HTMLAudioElement) => ({
      paused: audio.paused,
      source: audio.getAttribute('src'),
    })),
  ).toEqual({ paused: true, source: null });
  await openPlayer(page);
  await expect(
    page.getByRole('button', {
      name: 'Ripetizione: tutta la coda',
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'SoundHelix Song 2', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect
    .poll(() =>
      page
        .locator('audio')
        .evaluate((audio: HTMLAudioElement) => audio.currentTime),
    )
    .toBeGreaterThanOrEqual(11.9);
  await expect(page.locator('audio')).toHaveCount(1);
});
