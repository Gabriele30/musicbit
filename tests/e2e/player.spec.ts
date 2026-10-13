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
  await page.goto('/?screen=diagnostics&demo=1');
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

test('normal diagnostics never seeds demos or exports an empty new window', async ({
  page,
}) => {
  let demoRequests = 0;
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/tracks') demoRequests++;
  });
  await page.goto('/?screen=diagnostics');
  await expect(
    page.getByRole('heading', { name: 'Diagnostica', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Esporta JSON' }),
  ).toBeDisabled();
  await expect(
    page.getByText('Nessun tentativo di ascolto registrato', { exact: false }),
  ).toBeVisible();
  expect(demoRequests).toBe(0);
  await expect(
    page.getByRole('button', {
      name: 'Riproduci SoundHelix Song 1',
      exact: true,
    }),
  ).toHaveCount(0);
});

test('recovery bypasses a stale app shell and activates the new worker while retaining login and queue storage', async ({
  page,
}, info) => {
  const id = info.project.name === 'webkit-mobile' ? 'webkit' : 'chromium';
  await page.goto('/api/app-update');
  await page.evaluate(async (id) => {
    localStorage.setItem('musicbit-update-test-queue', 'saved queue');
    document.cookie = 'musicbit-update-test=retained; Path=/; SameSite=Lax';
    await navigator.serviceWorker.register(`/__test_update_sw/${id}.js`, {
      scope: '/',
    });
    await navigator.serviceWorker.ready;
  }, id);
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'Stale MusicBit' }),
  ).toBeVisible();
  await page.request.post(`/__test_update_sw/${id}/ready`);
  await page.goto('/api/app-update');
  await expect(
    page.getByRole('heading', { name: 'Aggiorna MusicBit' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Aggiorna e apri MusicBit' }).click();
  await expect(
    page.getByRole('heading', { name: 'Fresh MusicBit' }),
  ).toBeVisible();
  expect(
    await page.evaluate(() =>
      localStorage.getItem('musicbit-update-test-queue'),
    ),
  ).toBe('saved queue');
  expect(await page.evaluate(() => document.cookie)).toContain(
    'musicbit-update-test=retained',
  );
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

test('a signed-in user advances to a prefetched unheard song when its upstream becomes unavailable', async ({
  page,
}, info) => {
  const id =
    info.project.name === 'webkit-mobile' ? 'prefetch002' : 'prefetch001';
  const registered = await page.request.post('/api/auth/register', {
    headers: { 'x-musicbit-request': '1' },
    data: {
      username: `handoff_${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`,
      password: 'test-password-123',
    },
  });
  expect(registered.ok()).toBe(true);
  await page.request.post(`/__test_prefetch/reset/${id}`);
  await page.route('**/api/tracks', async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    data.tracks[1].audioUrl = `/api/audio/${id}`;
    await route.fulfill({ response, json: data });
  });
  await fixture(page);
  await page.locator('audio').evaluate((audio) => {
    audio.dataset.instance = 'prefetch-owner';
    audio.dataset.explicitLoads = '0';
    const load = audio.load.bind(audio);
    audio.load = () => {
      audio.dataset.explicitLoads = String(
        Number(audio.dataset.explicitLoads) + 1,
      );
      load();
    };
  });
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await openDiagnostics(page);
  await expect(
    page.getByText('upcoming:ready', { exact: false }),
  ).toBeAttached();
  await page.request.post(`/__test_prefetch/block/${id}`);
  try {
    await openPlayer(page);
    await page.getByRole('slider').fill('29.7');
    await expect(
      page.getByRole('heading', { name: 'SoundHelix Song 2', exact: true }),
    ).toBeVisible();
    await expect
      .poll(() =>
        page
          .locator('audio')
          .evaluate((audio: HTMLAudioElement) => audio.currentSrc),
      )
      .toContain(`/api/audio/${id}`);
    await expect
      .poll(() =>
        page
          .locator('audio')
          .evaluate((audio: HTMLAudioElement) => audio.currentTime),
      )
      .toBeGreaterThan(0.5);
    await expect(page.locator('audio')).toHaveCount(1);
    await expect(page.locator('audio')).toHaveAttribute(
      'data-instance',
      'prefetch-owner',
    );
    await expect(page.locator('audio')).toHaveAttribute(
      'data-explicit-loads',
      '0',
    );
  } finally {
    await page.request.post(`/__test_prefetch/reset/${id}`);
  }
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
