import { test, expect, type Page } from '@playwright/test';

// API routes are deterministic mocks; SW installation/offline behavior has its
// own production-bundle test in player.spec.ts. SW fetch bypasses page routing.
test.use({ serviceWorkers: 'block' });

const track = {
  id: 'abcdefghijk',
  provider: 'youtube',
  kind: 'track',
  title: 'Catalog song',
  artist: 'Catalog artist',
  artworkUrl: 'https://i.ytimg.com/vi/abcdefghijk/default.jpg',
  sourceUrl: 'https://music.youtube.com/watch?v=abcdefghijk',
  durationSeconds: 123,
  playback: { available: false, reason: 'catalog-only' },
};
const artist = {
  ...track,
  id: 'UCabcdefghijklmnopqrstuv',
  kind: 'artist',
  title: 'Catalog artist',
  sourceUrl: 'https://music.youtube.com/channel/UCabcdefghijklmnopqrstuv',
};
const album = {
  ...track,
  id: 'MPRalbum123',
  kind: 'album',
  title: 'Catalog album',
  sourceUrl: 'https://music.youtube.com/browse/MPRalbum123',
};
const timing = { cache: 'miss', elapsedMs: 123 };
const items = { track, artist, album };
async function mocks(page: Page) {
  await page.route('https://i.ytimg.com/**', (route) =>
    route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#d6f68a"/></svg>',
    }),
  );
  await page.route('**/api/providers', (route) =>
    route.fulfill({
      json: {
        providers: [
          {
            id: 'youtube',
            name: 'YouTube Music',
            state: 'available',
            capabilities: ['catalog'],
          },
        ],
      },
    }),
  );
  await page.route('**/api/search?*', (route) => {
    const kind = new URL(route.request().url()).searchParams.get(
      'type',
    ) as keyof typeof items;
    return route.fulfill({
      json: { provider: 'youtube', type: kind, items: [items[kind]], timing },
    });
  });
  await page.route('**/api/catalog/youtube/**', (route) => {
    const kind = new URL(route.request().url()).pathname
      .split('/')
      .at(-2) as keyof typeof items;
    return route.fulfill({
      json: {
        item: {
          ...items[kind],
          ...(kind === 'album' ? { tracks: [track] } : {}),
        },
        timing,
      },
    });
  });
}

test('debounced search and track details keep native demo audio playing', async ({
  page,
}, info) => {
  await mocks(page);
  const requests: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/search?')) requests.push(request.url());
  });
  await page.goto('/');
  await page
    .getByRole('button', { name: 'Riproduci SoundHelix Song 1', exact: true })
    .click();
  await expect
    .poll(() =>
      page
        .locator('audio')
        .evaluate((audio: HTMLAudioElement) => audio.currentTime),
    )
    .toBeGreaterThan(0);
  const original = await page
    .locator('audio')
    .evaluate((audio: HTMLAudioElement) => {
      audio.dataset.instance = 'catalog-preserved';
      return { src: audio.currentSrc, time: audio.currentTime };
    });
  await page
    .getByRole('navigation', { name: 'Navigazione mobile' })
    .getByRole('button', { name: 'Cerca', exact: true })
    .click();
  await page
    .getByLabel('Cerca nel catalogo')
    .pressSequentially('Bach', { delay: 30 });
  await page.getByRole('button', { name: 'Dettagli Catalog song' }).click();
  const panel = page.getByRole('region', { name: 'Catalogo musicale' });
  await expect(
    panel.getByRole('heading', { name: track.title, exact: true }),
  ).toBeVisible();
  await expect(panel.getByText('2:03')).toBeVisible();
  await expect(
    panel.getByText('Riproduzione non disponibile in MusicBit.'),
  ).toBeVisible();
  await expect(
    panel.getByRole('button', { name: /play|riproduci/i }),
  ).toHaveCount(0);
  await expect(
    panel.getByRole('link', { name: 'Apri su YouTube Music' }),
  ).toHaveAttribute('rel', 'noopener noreferrer');
  expect(requests).toHaveLength(1);
  await expect(page.locator('audio')).toHaveCount(1);
  await expect(page.locator('audio')).toHaveAttribute(
    'data-instance',
    'catalog-preserved',
  );
  const after = await page
    .locator('audio')
    .evaluate((audio: HTMLAudioElement) => ({
      src: audio.currentSrc,
      time: audio.currentTime,
      paused: audio.paused,
    }));
  expect(after.src).toBe(original.src);
  expect(after.time).toBeGreaterThan(original.time);
  expect(after.paused).toBe(false);
  await page
    .getByRole('button', { name: 'Torna ai risultati', exact: false })
    .click();
  await expect(page.getByLabel('Cerca nel catalogo')).toHaveValue('Bach');
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `artifacts/${info.project.name}-catalog-m3.png`,
    fullPage: true,
  });
});

test('artist and album navigation exposes only metadata including album tracks', async ({
  page,
}) => {
  await mocks(page);
  await page.goto('/?screen=search');
  await page.getByLabel('Cerca nel catalogo').fill('Bach');
  await page.getByRole('button', { name: 'Artisti', exact: true }).click();
  await page.getByRole('button', { name: 'Dettagli Catalog artist' }).click();
  await expect(
    page.getByRole('heading', { name: artist.title, exact: true }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Torna ai risultati', exact: false })
    .click();
  await page.getByRole('button', { name: 'Album', exact: true }).click();
  await page.getByRole('button', { name: 'Dettagli Catalog album' }).click();
  await expect(
    page.getByRole('heading', { name: 'Brani dell’album · solo metadati' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Dettagli Catalog song' }).click();
  await expect(
    page.getByRole('heading', { name: track.title, exact: true }),
  ).toBeVisible();
  await expect(page.locator('audio')).toHaveCount(1);
  expect(
    await page
      .locator('audio')
      .evaluate((audio: HTMLAudioElement) => audio.paused),
  ).toBe(true);
});

test('empty results, provider failures and detail failures have working recovery', async ({
  page,
}) => {
  await mocks(page);
  let failed = true;
  await page.route('**/api/search?*', (route) =>
    failed
      ? route.fulfill({ status: 503, json: { code: 'UNAVAILABLE' } })
      : route.fulfill({
          json: { provider: 'youtube', type: 'track', items: [], timing },
        }),
  );
  await page.goto('/?screen=search');
  await page.getByLabel('Cerca nel catalogo').fill('Bach');
  await expect(page.getByRole('alert')).toContainText(
    'Provider non disponibile',
  );
  failed = false;
  await page.getByRole('button', { name: 'Riprova ricerca' }).click();
  await expect(
    page.getByText('Nessun risultato. Prova un altro nome.'),
  ).toBeVisible();
  await page.unroute('**/api/search?*');
  await page.route('**/api/search?*', (route) =>
    route.fulfill({
      json: { provider: 'youtube', type: 'track', items: [track], timing },
    }),
  );
  await page.getByLabel('Cerca nel catalogo').fill('Mozart');
  await page.route('**/api/catalog/youtube/**', (route) =>
    route.fulfill({ status: 504, json: { code: 'TIMEOUT' } }),
  );
  await page.getByRole('button', { name: 'Dettagli Catalog song' }).click();
  await expect(page.getByRole('alert')).toContainText('troppo tempo');
  await page.unroute('**/api/catalog/youtube/**');
  await page.route('**/api/catalog/youtube/**', (route) =>
    route.fulfill({ json: { item: track, timing } }),
  );
  await page.getByRole('button', { name: 'Riprova dettagli' }).click();
  await expect(page.getByText('2:03')).toBeVisible();
});

test('a superseded request cannot overwrite the newest search or an empty field', async ({
  page,
}) => {
  await mocks(page);
  let slowStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    slowStarted = resolve;
  });
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/search?*', async (route) => {
    const slow =
      new URL(route.request().url()).searchParams.get('q') === 'lento';
    if (slow) {
      slowStarted();
      await held;
    }
    await route
      .fulfill({
        json: {
          provider: 'youtube',
          type: 'track',
          items: [{ ...track, title: slow ? 'Old result' : 'Latest result' }],
          timing,
        },
      })
      .catch(() => {});
  });
  await page.goto('/?screen=search');
  await page.getByLabel('Cerca nel catalogo').fill('lento');
  await started;
  await page.getByLabel('Cerca nel catalogo').fill('veloce');
  await expect(
    page.getByRole('button', { name: 'Dettagli Latest result' }),
  ).toBeVisible();
  release();
  await expect(
    page.getByRole('button', { name: 'Dettagli Old result' }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Cancella ricerca' }).click();
  await expect(
    page.getByText('Scrivi almeno due caratteri per iniziare.'),
  ).toBeVisible();
  await expect(page.locator('.catalog-result')).toHaveCount(0);
});
