import { test, expect, type Page } from '@playwright/test';
import { openQueue } from './navigation';

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
  audioUrl: '/__test_media/soundhelix-2.wav',
  playback: { available: true },
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

test('search highlights the matching artist, presents entity grids and supports touch and keyboard at narrow widths', async ({
  page,
}, info) => {
  await mocks(page);
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto('/?screen=search');
  await page.getByLabel('Cerca nel catalogo').fill('Catalog artist');
  await expect(
    page
      .getByRole('region', { name: 'Risultato principale' })
      .getByRole('button', {
        name: 'Apri risultato principale: Catalog artist',
        exact: true,
      }),
  ).toBeVisible();
  await expect(page.locator('.search-entity-grid')).toHaveCount(2);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: info.outputPath('search-mobile.png'),
    fullPage: true,
  });
  const input = page.getByLabel('Cerca nel catalogo');
  await input.press('ArrowDown');
  await expect(
    page.getByRole('listbox', { name: 'Suggerimenti di ricerca' }),
  ).toBeVisible();
  await input.press('Escape');
  await expect(
    page.getByRole('listbox', { name: 'Suggerimenti di ricerca' }),
  ).toHaveCount(0);
  await page
    .getByRole('button', { name: 'Dettagli Catalog artist', exact: true })
    .tap();
  await expect(
    page.getByRole('heading', { name: 'Catalog artist', exact: true }),
  ).toBeVisible();
  await expect(page.locator('audio')).toHaveCount(1);
});

test('authenticated queue preparation sends a server hint without downloading the upcoming song through the phone', async ({
  page,
}) => {
  await mocks(page);
  const registered = await page.request.post('/api/auth/register', {
    headers: { 'x-musicbit-request': '1' },
    data: {
      username: `cache_${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`,
      password: 'test-password-123',
    },
  });
  expect(registered.ok()).toBe(true);
  const plans: string[][] = [];
  await page.route('**/api/me/audio-cache', (route) => {
    if (route.request().method() === 'POST')
      plans.push(route.request().postDataJSON().ids);
    return route.fulfill({
      json: {
        enabled: true,
        bytes: 0,
        tracks: 0,
        preparing: 0,
        quotaBytes: 5_000_000_000,
      },
    });
  });
  const next = {
    ...track,
    id: 'lmnopqrstuv',
    title: 'Next cached song',
    audioUrl: '/api/audio/lmnopqrstuv',
  };
  await page.route('**/api/search?*', (route) =>
    route.fulfill({
      json: {
        provider: 'youtube',
        type: 'track',
        items: [track, next],
        timing,
      },
    }),
  );
  const requests: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === next.audioUrl)
      requests.push(request.url());
  });
  await page.goto('/?screen=search');
  await page.getByRole('button', { name: 'Brani', exact: true }).click();
  await page.getByLabel('Cerca nel catalogo').fill('cache');
  await page
    .getByRole('button', { name: 'Riproduci Catalog song', exact: true })
    .click();
  await expect
    .poll(async () =>
      page.locator('audio').evaluate((el: HTMLAudioElement) => !el.paused),
    )
    .toBe(true);
  await page
    .getByRole('button', {
      name: 'Aggiungi alla coda Next cached song',
      exact: true,
    })
    .click();
  await expect
    .poll(() => plans.some((ids) => ids.includes(next.id)))
    .toBe(true);
  expect(requests).toHaveLength(0);
  await expect(page.locator('audio')).toHaveCount(1);
});

test('home and album details resolve the first visible song before play without loading native audio', async ({
  page,
}) => {
  await mocks(page);
  const first = { ...track, audioUrl: '/api/audio/abcdefghijk' };
  const next = {
    ...track,
    id: 'lmnopqrstuv',
    audioUrl: '/api/audio/lmnopqrstuv',
  };
  const warmed: string[] = [];
  await page.route('**/api/audio/*/info', (route) => {
    warmed.push(new URL(route.request().url()).pathname);
    return route.fulfill({ json: { durationSeconds: 123 } });
  });
  await page.route('**/api/feed', (route) =>
    route.fulfill({
      json: {
        sections: [{ id: 'warmup', title: 'Scoperte', items: [first, album] }],
        timing,
      },
    }),
  );
  await page.route('**/api/catalog/youtube/album/*', (route) =>
    route.fulfill({
      json: {
        item: { ...album, tracks: [next] },
        timing,
      },
    }),
  );
  await page.goto('/');
  await expect.poll(() => warmed).toContain('/api/audio/abcdefghijk/info');
  await page
    .getByRole('button', { name: 'Apri Catalog album', exact: true })
    .click();
  await expect.poll(() => warmed).toContain('/api/audio/lmnopqrstuv/info');
  expect(
    await page.locator('audio').evaluate((audio: HTMLAudioElement) => ({
      paused: audio.paused,
      source: audio.currentSrc,
    })),
  ).toEqual({ paused: true, source: '' });
  await expect(page.locator('audio')).toHaveCount(1);
});
async function mocks(page: Page) {
  await page.route('**/api/feed', (route) =>
    route.fulfill({
      json: {
        sections: [
          {
            id: 'discovery',
            title: 'Scoperte del giorno',
            items: [track, artist, album],
          },
        ],
        timing,
      },
    }),
  );
  await page.route('**/api/recommendations/*', (route) => {
    const id = new URL(route.request().url()).pathname.split('/').at(-1);
    return route.fulfill({
      json: {
        seedId: id,
        items:
          id === track.id
            ? [
                {
                  ...track,
                  id: 'lmnopqrstuv',
                  title: 'Radio song',
                  sourceUrl: 'https://music.youtube.com/watch?v=lmnopqrstuv',
                  audioUrl: '/__test_media/soundhelix-3.wav',
                },
              ]
            : [],
        timing,
      },
    });
  });
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
          ...(kind === 'album'
            ? { tracks: [track] }
            : kind === 'artist'
              ? { tracks: [track], albums: [album] }
              : {}),
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
  await page.goto('/?screen=player&demo=1');
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
  await page.getByRole('button', { name: 'Chiudi player' }).click();
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
    panel.getByRole('button', { name: /^(play|riproduci)/i }),
  ).toHaveCount(1);
  await page
    .getByRole('button', { name: 'Altre opzioni per Catalog song' })
    .click();
  await expect(
    page
      .getByRole('dialog')
      .getByRole('link', { name: 'Apri su YouTube Music' }),
  ).toHaveAttribute('rel', 'noopener noreferrer');
  await page.getByRole('button', { name: 'Chiudi menu' }).click();
  expect(requests).toHaveLength(3);
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

test('combined search survives a failed category and recent queries can be reused and deleted', async ({
  page,
}) => {
  await mocks(page);
  await page.route('**/api/search?*', (route) => {
    const kind = new URL(route.request().url()).searchParams.get(
      'type',
    ) as keyof typeof items;
    return kind === 'album'
      ? route.fulfill({ status: 503, json: {} })
      : route.fulfill({
          json: {
            provider: 'youtube',
            type: kind,
            items: [items[kind]],
            timing,
          },
        });
  });
  await page.goto('/?screen=search');
  await page.getByLabel('Cerca nel catalogo').fill('Bach');
  await expect(
    page.getByRole('region', { name: 'Risultati: Brani' }),
  ).toBeVisible();
  await expect(
    page.getByRole('region', { name: 'Risultati: Artisti' }),
  ).toBeVisible();
  await expect(
    page.getByText('Album temporaneamente non disponibili.'),
  ).toBeVisible();
  await page.getByLabel('Cerca nel catalogo').press('Enter');
  await page.getByRole('button', { name: 'Cancella ricerca' }).click();
  await expect(
    page.getByRole('region', { name: 'Ricerche recenti' }),
  ).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Bach', exact: true }).click();
  await expect(page.getByLabel('Cerca nel catalogo')).toHaveValue('Bach');
  await page
    .getByRole('button', { name: 'Dettagli Catalog song', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Torna ai risultati', exact: false })
    .click();
  await page.getByRole('button', { name: 'Cancella ricerca' }).click();
  await page
    .getByRole('button', { name: 'Rimuovi ricerca Bach', exact: true })
    .click();
  await page.reload();
  await expect(
    page.getByRole('region', { name: 'Ricerche recenti' }),
  ).toHaveCount(0);
});

test('artist and album navigation exposes details and playable album tracks', async ({
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
    page.getByRole('heading', { name: /Brani dell.album \(1\)/ }),
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
    page.getByRole('heading', { name: 'La prossima scoperta comincia qui' }),
  ).toBeVisible();
  await expect(page.locator('.catalog-result')).toHaveCount(0);
});

test('search results survive navigation and Play uses the same native audio element', async ({
  page,
}) => {
  await mocks(page);
  await page.goto('/?screen=search');
  await page.getByLabel('Cerca nel catalogo').fill('Bach');
  const play = page.getByRole('button', {
    name: 'Riproduci Catalog song',
    exact: true,
  });
  await expect(play).toBeVisible();
  await page.locator('audio').evaluate((audio) => {
    audio.dataset.instance = 'search-audio';
  });
  await play.click();
  await expect
    .poll(() =>
      page
        .locator('audio')
        .evaluate((audio: HTMLAudioElement) => audio.currentTime),
    )
    .toBeGreaterThan(0);
  const navigation = page.getByRole('navigation', {
    name: 'Navigazione mobile',
  });
  await openQueue(page);
  await navigation.getByRole('button', { name: 'Cerca', exact: true }).click();
  await expect(page.getByLabel('Cerca nel catalogo')).toHaveValue('Bach');
  await expect(play).toBeVisible();
  await expect(page.locator('audio')).toHaveCount(1);
  await expect(page.locator('audio')).toHaveAttribute(
    'data-instance',
    'search-audio',
  );
  await page.goBack();
  await expect(
    page.getByRole('heading', { name: 'Coda di riproduzione' }),
  ).toBeVisible();
});

test('unavailable tracks have details without actionable playback buttons', async ({
  page,
}) => {
  await mocks(page);
  await page.route('**/api/search?*', (route) =>
    route.fulfill({
      json: {
        provider: 'youtube',
        type: 'track',
        items: [{ ...track, playback: { available: false } }],
        timing,
      },
    }),
  );
  await page.route('**/api/catalog/youtube/**', (route) =>
    route.fulfill({
      json: { item: { ...track, playback: { available: false } }, timing },
    }),
  );
  await page.goto('/?screen=search');
  await page.getByLabel('Cerca nel catalogo').fill('Bach');
  await page.getByRole('button', { name: 'Dettagli Catalog song' }).click();
  const panel = page.getByRole('region', { name: 'Catalogo musicale' });
  await expect(
    panel.getByText('Riproduzione non disponibile in MusicBit.'),
  ).toBeVisible();
  await expect(
    panel.getByRole('button', { name: /riproduci|aggiungi alla coda/i }),
  ).toHaveCount(0);
});

test('favorites persist across reload, can be filtered and played through native audio', async ({
  page,
}, info) => {
  await mocks(page);
  await page.goto('/?screen=search');
  await page.getByLabel('Cerca nel catalogo').fill('Bach');
  await page
    .getByRole('button', { name: 'Dettagli Catalog song', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Salva nei preferiti', exact: true })
    .click();
  await page
    .getByRole('navigation', { name: 'Navigazione mobile' })
    .getByRole('button', { name: 'Libreria', exact: true })
    .click();
  await page.reload();
  await expect(
    page.getByRole('button', {
      name: 'Riproduci preferito Catalog song',
      exact: true,
    }),
  ).toBeVisible();
  expect(
    await page
      .locator('audio')
      .evaluate((audio: HTMLAudioElement) => audio.paused),
  ).toBe(true);
  await page.getByLabel('Filtra i preferiti').fill('nessuno');
  await expect(
    page.getByText('Nessun preferito corrisponde alla ricerca.'),
  ).toBeVisible();
  await page.getByLabel('Filtra i preferiti').fill('Catalog artist');
  await page
    .getByRole('button', { name: 'Riproduci preferiti', exact: true })
    .click();
  await expect
    .poll(() =>
      page
        .locator('audio')
        .evaluate((audio: HTMLAudioElement) => audio.currentTime),
    )
    .toBeGreaterThan(0);
  await expect(page.locator('audio')).toHaveCount(1);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `artifacts/${info.project.name}-library.png`,
    fullPage: true,
  });
  await page
    .getByRole('button', {
      name: 'Rimuovi Catalog song dai preferiti',
      exact: true,
    })
    .click();
  await page.reload();
  await expect(
    page.getByRole('button', { name: 'Trova musica', exact: true }),
  ).toBeVisible();
});

test('home displays discovery and opens real artist and album pages', async ({
  page,
}, info) => {
  await mocks(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'Buon ascolto.',
  );
  await expect(
    page.getByRole('heading', { name: 'Scoperte del giorno' }),
  ).toBeVisible();
  expect(await page.locator('audio').getAttribute('src')).toBeNull();
  await page
    .getByRole('button', { name: 'Apri Catalog artist', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Brani popolari (1)' }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Discografia' }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Segui artista', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Apri Catalog album', exact: true })
    .click();
  await page.getByRole('button', { name: 'Salva album', exact: true }).click();
  await page
    .getByRole('navigation', { name: 'Navigazione mobile' })
    .getByRole('button', { name: 'Home', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Gli artisti che segui' }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'I tuoi album' }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `artifacts/${info.project.name}-home.png`,
    fullPage: true,
  });
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Gli artisti che segui' }),
  ).toBeVisible();
});

test('compact navigation preserves scroll, library filters and the audio through player and queue', async ({
  page,
}, info) => {
  await mocks(page);
  await page.route('**/api/feed', (route) =>
    route.fulfill({
      json: {
        sections: Array.from({ length: 6 }, (_, index) => ({
          id: `shelf-${index}`,
          title: `La tua selezione ${index + 1}`,
          items: [track, album, artist],
        })),
        timing,
      },
    }),
  );
  await page.goto('/');
  const navigation = page.getByRole('navigation', {
    name: 'Navigazione mobile',
  });
  await expect(navigation.getByRole('button')).toHaveCount(3);
  const firstPlay = page
    .getByRole('button', { name: 'Riproduci Catalog song', exact: true })
    .first();
  await expect(firstPlay).toBeInViewport({ ratio: 1 });
  await firstPlay.click();
  await expect
    .poll(() =>
      page
        .locator('audio')
        .evaluate((audio: HTMLAudioElement) => audio.currentTime),
    )
    .toBeGreaterThan(0.2);
  await page.locator('audio').evaluate((audio) => {
    audio.dataset.instance = 'redesign-original';
  });
  await navigation
    .getByRole('button', { name: 'Libreria', exact: true })
    .click();
  const libraryTabs = page.getByRole('group', {
    name: 'Sezioni della libreria',
  });
  await libraryTabs.getByRole('button', { name: 'Album', exact: true }).click();
  await navigation.getByRole('button', { name: 'Home', exact: true }).click();
  await navigation
    .getByRole('button', { name: 'Libreria', exact: true })
    .click();
  await expect(
    libraryTabs.getByRole('button', { name: 'Album', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await navigation.getByRole('button', { name: 'Home', exact: true }).click();
  await page.evaluate(() => window.scrollTo(0, 600));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(600);
  await page.locator('.mini-title').click();
  await expect(navigation).not.toBeVisible();
  await page.getByRole('button', { name: 'Coda', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Coda di riproduzione' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Chiudi coda' }).click();
  await expect(
    page.getByRole('button', { name: 'Chiudi player' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Chiudi player' }).click();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(600);
  await expect(page.locator('audio')).toHaveCount(1);
  await expect(page.locator('audio')).toHaveAttribute(
    'data-instance',
    'redesign-original',
  );
  expect(
    await page
      .locator('audio')
      .evaluate((audio: HTMLAudioElement) => audio.paused),
  ).toBe(false);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: `artifacts/${info.project.name}-redesign-home.png`,
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(
    page.getByRole('navigation', { name: 'Navigazione principale' }),
  ).toBeVisible();
  await expect(navigation).not.toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `artifacts/${info.project.name}-redesign-desktop.png`,
  });
});

test('artist actions work in an accessible menu on narrow screens without replacing the audio', async ({
  page,
}, info) => {
  await mocks(page);
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto('/');
  await page
    .getByRole('button', { name: 'Apri Catalog artist', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Brani popolari (1)' }),
  ).toBeVisible();
  const more = page.getByRole('button', {
    name: 'Altre opzioni per Catalog artist',
  });
  await more.click();
  const menu = page.getByRole('dialog', {
    name: 'Catalog artist',
    exact: true,
  });
  await expect(menu).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).not.toBeVisible();
  await expect(more).toBeFocused();
  await more.click();
  await menu.getByRole('button', { name: 'Accoda brani', exact: true }).click();
  await expect(menu).not.toBeVisible();
  expect(await page.locator('audio').getAttribute('src')).toBeNull();
  await page
    .getByRole('button', { name: 'Riproduci artista', exact: true })
    .click();
  await expect
    .poll(() =>
      page
        .locator('audio')
        .evaluate((audio: HTMLAudioElement) => audio.currentTime),
    )
    .toBeGreaterThan(0.2);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `artifacts/${info.project.name}-redesign-artist-320.png`,
  });
});

test('an empty player offers discovery and never seeds demo music in a normal session', async ({
  page,
}) => {
  await mocks(page);
  await page.goto('/?screen=player');
  await expect(
    page.getByRole('heading', { name: 'Il tuo prossimo ascolto ti aspetta' }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Demo sessions' }),
  ).toHaveCount(0);
  expect(await page.locator('audio').getAttribute('src')).toBeNull();
  await page.getByRole('button', { name: 'Chiudi player' }).click();
  await expect(
    page.getByRole('heading', { name: 'Scoperte del giorno' }),
  ).toBeVisible();
  expect(await page.locator('audio').getAttribute('src')).toBeNull();
});

test('personal playlists support creation, ordering, rename, persistence and deletion', async ({
  page,
}, info) => {
  await mocks(page);
  const second = {
    ...track,
    id: 'lmnopqrstuv',
    title: 'Second song',
    sourceUrl: 'https://music.youtube.com/watch?v=lmnopqrstuv',
    audioUrl: '/__test_media/soundhelix-3.wav',
  };
  await page.route('**/api/catalog/youtube/album/*', (route) =>
    route.fulfill({
      json: { item: { ...album, tracks: [track, second] }, timing },
    }),
  );
  await page.goto('/');
  await page
    .getByRole('button', { name: 'Apri Catalog album', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Altre opzioni per Catalog album' })
    .click();
  await page
    .getByRole('button', { name: 'Aggiungi a playlist', exact: true })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Aggiungi a playlist' });
  await dialog
    .getByLabel('Nuova playlist', { exact: true })
    .fill('Il mio viaggio');
  await dialog.getByRole('button', { name: 'Crea e aggiungi' }).click();
  await expect(dialog).not.toBeVisible();
  await page
    .getByRole('navigation', { name: 'Navigazione mobile' })
    .getByRole('button', { name: 'Libreria', exact: true })
    .click();
  await page.getByRole('button', { name: 'Playlist', exact: true }).click();
  await page.getByRole('button', { name: 'Il mio viaggio 2 brani' }).click();
  await page.getByRole('button', { name: 'Opzioni playlist' }).click();
  await page
    .getByRole('button', { name: 'Modifica brani', exact: true })
    .click();
  await page.getByRole('button', { name: 'Sposta su Second song' }).click();
  await expect(page.locator('.queue-list li').first()).toContainText(
    'Second song',
  );
  await page
    .getByRole('button', { name: 'Fine modifica', exact: true })
    .click();
  await page.getByRole('button', { name: 'Opzioni playlist' }).click();
  await page
    .getByRole('button', { name: 'Rinomina playlist', exact: true })
    .click();
  await page.getByLabel('Nuovo nome playlist').fill('Viaggio serale');
  await page.getByRole('button', { name: 'Rinomina', exact: true }).click();
  const playPosition = await page
    .getByRole('button', { name: 'Riproduci playlist', exact: true })
    .boundingBox();
  const shufflePosition = await page
    .getByRole('button', {
      name: 'Riproduci playlist in ordine casuale',
      exact: true,
    })
    .boundingBox();
  expect(playPosition).not.toBeNull();
  expect(shufflePosition).not.toBeNull();
  expect(Math.abs(playPosition!.y - shufflePosition!.y)).toBeLessThan(4);
  await page
    .getByRole('button', { name: 'Riproduci playlist', exact: true })
    .click();
  await expect
    .poll(() =>
      page
        .locator('audio')
        .evaluate((audio: HTMLAudioElement) => audio.currentTime),
    )
    .toBeGreaterThan(0.2);
  await expect(page.locator('audio')).toHaveCount(1);
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await page.screenshot({
    path: `artifacts/${info.project.name}-playlist.png`,
    fullPage: false,
  });
  await page.reload();
  await page.getByRole('button', { name: 'Playlist', exact: true }).click();
  await page.getByRole('button', { name: 'Viaggio serale 2 brani' }).click();
  await expect(page.locator('.queue-list li').first()).toContainText(
    'Second song',
  );
  await page
    .getByRole('button', { name: 'Opzioni brano Catalog song' })
    .click();
  await page
    .getByRole('button', { name: 'Rimuovi dalla playlist', exact: true })
    .click();
  await expect(page.locator('.queue-list li')).toHaveCount(1);
  await page.getByRole('button', { name: 'Annulla rimozione' }).click();
  await expect(page.locator('.queue-list li')).toHaveCount(2);
  await expect(page.locator('.queue-list li').nth(1)).toContainText(
    'Catalog song',
  );
  await page
    .getByRole('button', { name: 'Riproduci Catalog song', exact: true })
    .click();
  await openQueue(page);
  await expect(page.locator('.queue-list:visible > li')).toHaveCount(2);
  await expect(page.locator('.queue-list:visible > li').first()).toContainText(
    'Second song',
  );
  await expect(page.locator('.queue-list:visible > li').nth(1)).toHaveClass(
    'current-track',
  );
  await page
    .getByRole('navigation', { name: 'Navigazione mobile' })
    .getByRole('button', { name: 'Libreria', exact: true })
    .click();
  await page.getByRole('button', { name: 'Opzioni playlist' }).click();
  await page
    .getByRole('button', { name: 'Elimina playlist', exact: true })
    .click();
  await page.getByRole('button', { name: 'Conferma eliminazione' }).click();
  await expect(
    page.getByRole('button', { name: 'Viaggio serale 1 brani' }),
  ).toHaveCount(0);
});

test('autoplay continues with staged radio tracks using the same native audio and records history', async ({
  page,
}) => {
  await mocks(page);
  await page.goto('/');
  await page
    .getByRole('button', { name: 'Riproduci Catalog song', exact: true })
    .click();
  await expect
    .poll(() =>
      page
        .locator('audio')
        .evaluate((audio: HTMLAudioElement) => audio.currentTime),
    )
    .toBeGreaterThan(0.2);
  await page.locator('audio').evaluate((audio) => {
    audio.dataset.instance = 'autoplay-original';
  });
  await openQueue(page);
  await expect(
    page.getByRole('button', { name: 'Radio song Catalog artist' }),
  ).toBeVisible();
  await page.locator('audio').evaluate((audio: HTMLAudioElement) => {
    audio.currentTime = 29.7;
  });
  await expect(
    page.getByRole('button', { name: 'Riproduci posizione 2: Radio song' }),
  ).toBeVisible({ timeout: 10000 });
  await expect
    .poll(() =>
      page
        .locator('audio')
        .evaluate((audio: HTMLAudioElement) => audio.currentTime),
    )
    .toBeGreaterThan(0.2);
  await expect(page.locator('audio')).toHaveAttribute(
    'data-instance',
    'autoplay-original',
  );
  await expect(page.locator('audio')).toHaveCount(1);
  await page.getByRole('switch', { name: 'Riproduzione automatica' }).click();
  await expect(
    page.getByRole('switch', { name: 'Riproduzione automatica' }),
  ).toHaveAttribute('aria-checked', 'false');
  await page.reload();
  await expect(
    page.getByRole('switch', { name: 'Riproduzione automatica' }),
  ).toHaveAttribute('aria-checked', 'false');
  await page
    .getByRole('navigation', { name: 'Navigazione mobile' })
    .getByRole('button', { name: 'Libreria', exact: true })
    .click();
  await page.getByRole('button', { name: 'Cronologia', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Riascolta Radio song', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Riascolta Catalog song', exact: true }),
  ).toBeVisible();
});
