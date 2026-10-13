import { test, expect, type Page } from '@playwright/test';
import {
  catalogItemToTrack,
  emptyLibrary,
} from '../../packages/shared/dist/index.js';
test.use({ serviceWorkers: 'block' });
const item = {
  id: 'abcdefghijk',
  kind: 'track' as const,
  provider: 'youtube' as const,
  title: 'Caffè di notte',
  artist: 'Night Artist',
  sourceUrl: 'https://music.youtube.com/watch?v=abcdefghijk',
  audioUrl: '/__test_media/soundhelix-2.wav',
  artworkUrl: '/artwork/cover-1.svg',
  durationSeconds: 30,
  playback: { available: true },
};
const track = catalogItemToTrack(item),
  timing = { cache: 'hit', elapsedMs: 1 };
async function catalog(page: Page) {
  await page.route('**/api/feed', (r) =>
    r.fulfill({
      json: {
        sections: [{ id: 'test', title: 'Scoperte', items: [item] }],
        timing,
      },
    }),
  );
  await page.route('**/api/me/recommendations', (r) =>
    r.fulfill({ json: { items: [] } }),
  );
  await page.route('**/api/providers', (r) =>
    r.fulfill({ json: { providers: [] } }),
  );
  await page.route('**/api/search?*', (r) =>
    r.fulfill({
      json: {
        provider: 'youtube',
        type: new URL(r.request().url()).searchParams.get('type'),
        items: [],
        timing,
      },
    }),
  );
  await page.route('**/api/recommendations/*', (r) =>
    r.fulfill({
      json: {
        seedId: new URL(r.request().url()).pathname.split('/').at(-1),
        items: [],
        timing,
      },
    }),
  );
}
async function register(page: Page) {
  const username = `exp_${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`;
  await page.goto('/?screen=profile');
  await page
    .getByRole('button', { name: 'Crea un account', exact: true })
    .click();
  await page.getByLabel('Nome utente', { exact: true }).fill(username);
  await page.getByLabel('Password', { exact: true }).fill('test-password-123');
  await page.getByRole('button', { name: 'Crea account', exact: true }).click();
  await expect(page.getByLabel(`Profilo di ${username}`)).toBeVisible();
  await page.getByLabel(`Profilo di ${username}`).click();
  await expect(
    page.getByRole('heading', { name: username, exact: true }),
  ).toBeVisible();
  return username;
}
test('personal home replaces generic quick picks and Wrapped fits narrow iPhones with a full year of data', async ({
  page,
}, info) => {
  await catalog(page);
  const artist = {
    ...item,
    id: 'UCabcdefghijklmnopqrstuv',
    kind: 'artist',
    title: 'New Artist',
    artist: 'New Artist',
    artworkUrl: 'https://lh3.googleusercontent.com/test-portrait',
    playback: { available: false },
  };
  await page.route(artist.artworkUrl, (r) =>
    r.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="#357859"/></svg>',
    }),
  );
  await page.route('**/api/me/discovery/artists', (r) =>
    r.fulfill({
      json: { artists: [artist], basedOn: ['Night Artist'], source: 'ai' },
    }),
  );
  await page.route('**/api/feed', (r) =>
    r.fulfill({
      json: {
        sections: [
          {
            id: 'generic',
            title: 'Scelte veloci',
            items: [
              {
                ...item,
                id: 'lmnopqrstuv',
                title: 'Fixed generic song',
                artworkUrl: undefined,
              },
            ],
          },
        ],
        timing,
      },
    }),
  );
  await register(page);
  const previous = await (await page.request.get('/api/me/library')).json();
  const saved = await page.request.put('/api/me/library', {
    headers: { 'x-musicbit-request': '1' },
    data: {
      revision: previous.revision,
      library: {
        ...emptyLibrary(),
        history: [{ track, playedAt: Date.now() }],
      },
    },
  });
  expect(saved.ok()).toBe(true);
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'Scelte veloci', exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByLabel('Le tue scelte veloci')
      .getByRole('button', { name: `Riascolta ${track.title}` }),
  ).toBeVisible();
  await expect(
    page.getByLabel('Le tue scelte veloci').getByText('Fixed generic song'),
  ).toHaveCount(0);
  const discovery = page.getByLabel('Scoperta artisti personalizzata');
  await expect(
    discovery.getByText('New Artist', { exact: true }),
  ).toBeVisible();
  await expect(discovery.locator('img')).toHaveAttribute(
    'src',
    artist.artworkUrl,
  );
  await expect(discovery).toContainText('Suggeriti dall’AI');
  await expect(
    page
      .getByLabel('Classifica Spotify')
      .getByRole('link', { name: /Top Italia/ }),
  ).toHaveAttribute(
    'href',
    'https://charts.spotify.com/charts/view/regional-it-daily/latest',
  );
  const year = new Date().getUTCFullYear();
  await page.route('**/api/me/stats?*', (r) =>
    r.fulfill({
      json: {
        from: `${year}-01-01`,
        to: `${year}-12-31`,
        seconds: 72000,
        plays: 1200,
        activeDays: 90,
        distinctArtists: 200,
        distinctTracks: 500,
        topTracks: [
          {
            track: {
              ...track,
              title:
                'Una canzone con un titolo molto lungo per verificare il layout su iPhone',
            },
            seconds: 3600,
            plays: 30,
          },
        ],
        topArtists: [
          {
            artist: 'Un artista con un nome particolarmente lungo',
            seconds: 3600,
            plays: 30,
          },
        ],
        months: Array.from({ length: 12 }, (_, i) => ({
          month: `${year}-${String(i + 1).padStart(2, '0')}`,
          seconds: (i + 1) * 6000,
        })),
      },
    }),
  );
  await page.goto('/?screen=wrapped');
  await expect(page.locator('.listening-months button')).toHaveCount(12);
  for (const width of [320, 375, 390, 430]) {
    await page.setViewportSize({ width, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    const bounds = await page.locator('.wrapped-page').boundingBox();
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    expect(
      await page
        .locator('.listening-months')
        .evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: `artifacts/${info.project.name}-wrapped-responsive.png`,
    fullPage: true,
  });
});
test('a second device resumes the cloud queue and position only after a tap; Wrapped uses saved real-time counters', async ({
  page,
  browser,
  baseURL,
}, info) => {
  await catalog(page);
  const username = await register(page);
  await page.goto('/?screen=player&demo=1');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect
    .poll(() =>
      page.locator('audio').evaluate((a: HTMLAudioElement) => a.paused),
    )
    .toBe(false);
  await page.getByRole('button', { name: 'Pausa', exact: true }).click();
  await page
    .getByRole('slider', { name: 'Posizione nella traccia' })
    .fill('12');
  await expect
    .poll(
      async () =>
        (await (await page.request.get('/api/me/playback')).json()).session
          ?.position,
      { timeout: 12000 },
    )
    .toBeGreaterThanOrEqual(11.9);
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    serviceWorkers: 'block',
  });
  try {
    const second = await context.newPage();
    await catalog(second);
    await second.goto(`${baseURL}/?screen=profile`);
    await second.getByLabel('Nome utente', { exact: true }).fill(username);
    await second
      .getByLabel('Password', { exact: true })
      .fill('test-password-123');
    await second.getByRole('button', { name: 'Accedi', exact: true }).click();
    await expect(
      second.getByRole('button', { name: 'Riprendi qui', exact: true }),
    ).toBeVisible();
    expect(
      await second.locator('audio').evaluate((a: HTMLAudioElement) => ({
        paused: a.paused,
        src: a.getAttribute('src'),
      })),
    ).toEqual({ paused: true, src: null });
    const audio = await second.locator('audio').elementHandle();
    await second
      .getByRole('button', { name: 'Riprendi qui', exact: true })
      .click();
    await expect
      .poll(() =>
        second
          .locator('audio')
          .evaluate((a: HTMLAudioElement) => a.currentTime),
      )
      .toBeGreaterThanOrEqual(11.9);
    expect(
      await audio!.evaluate((a) => a === document.querySelector('audio')),
    ).toBe(true);
    const at = Date.now();
    await second.request.post(`${baseURL}/api/me/listening`, {
      headers: { 'x-musicbit-request': '1' },
      data: {
        events: [
          {
            id: crypto.randomUUID(),
            track,
            at,
            seconds: 60,
            starts: 1,
            completed: true,
          },
        ],
      },
    });
    await second.goto(`${baseURL}/?screen=wrapped`);
    await expect(
      second.getByRole('heading', { name: 'MusicBit Wrapped.' }),
    ).toBeVisible();
    await expect(
      second.locator('.wrapped-metrics article').first(),
    ).toContainText('1');
    await expect(
      second.getByRole('button', {
        name: 'Riascolta dalla classifica Caffè di notte',
      }),
    ).toBeVisible();
    expect(
      await second.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await second.screenshot({
      path: `artifacts/${info.project.name}-wrapped.png`,
      fullPage: true,
    });
  } finally {
    await context.close();
  }
});
test('immediate local suggestions, editable Taste Profile and automatic mix snapshots', async ({
  page,
}, info) => {
  await catalog(page);
  await page.addInitScript((track) => {
    const library = {
      version: 1,
      favorites: [track],
      history: [{ track, playedAt: Date.now() }],
      playlists: [],
      savedAlbums: [],
      followedArtists: [],
    };
    if (!localStorage.getItem('musicbit.library.v1'))
      localStorage.setItem('musicbit.library.v1', JSON.stringify(library));
  }, track);
  await page.goto('/?screen=search');
  const input = page.getByRole('combobox', { name: 'Cerca nel catalogo' });
  await input.fill('caffe');
  await expect(
    page.getByRole('listbox', { name: 'Suggerimenti di ricerca' }),
  ).toContainText('Caffè di notte');
  await input.press('ArrowDown');
  await input.press('Enter');
  await expect
    .poll(() =>
      page.locator('audio').evaluate((a: HTMLAudioElement) => a.paused),
    )
    .toBe(false);
  await page.goto('/?screen=profile');
  await expect(
    page.getByRole('heading', { name: 'Taste Profile', exact: true }),
  ).toBeVisible();
  await page.getByLabel('Preferenza per Night Artist').selectOption('blocked');
  await page.reload();
  await expect(page.getByLabel('Preferenza per Night Artist')).toHaveValue(
    'blocked',
  );
  await page.getByLabel('Preferenza per Night Artist').selectOption('more');
  await page.screenshot({
    path: `artifacts/${info.project.name}-taste-profile.png`,
    fullPage: true,
  });
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'Mix che cambiano con te' }),
  ).toBeVisible();
  await page
    .locator('.mix-card')
    .first()
    .getByRole('button', { name: 'Salva mix', exact: true })
    .click();
  await expect(
    page
      .getByRole('status')
      .filter({ hasText: 'salvato come playlist modificabile' }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem('musicbit.library.v1')!).playlists[0]
            ?.tracks.length,
      ),
    )
    .toBeGreaterThan(0);
});
test('AI playlist preview can exclude a track before saving without exposing provider credentials', async ({
  page,
}, info) => {
  await catalog(page);
  await register(page);
  await page.route('**/api/me/ai-playlists/status', (r) =>
    r.fulfill({ json: { available: true, provider: 'OpenAI', maxTracks: 20 } }),
  );
  const second = { ...track, id: 'lmnopqrstuv', title: 'Second song' };
  await page.route('**/api/me/ai-playlists', async (r) => {
    expect(r.request().postDataJSON()).toEqual({
      prompt: 'Un viaggio notturno',
      count: 12,
      useTaste: false,
    });
    return r.fulfill({
      json: {
        name: 'Notte in viaggio',
        description: 'Un mix per la notte.',
        tracks: [track, second],
        unmatched: [{ title: 'Missing song', artist: 'Missing artist' }],
      },
    });
  });
  await page.goto('/?screen=ai-playlist');
  await page.getByLabel('Che playlist immagini?').fill('Un viaggio notturno');
  await page
    .getByRole('button', { name: 'Crea playlist con AI', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Notte in viaggio', exact: true }),
  ).toBeVisible();
  await page
    .locator('.ai-track-choice')
    .filter({ hasText: 'Second song' })
    .getByRole('checkbox')
    .uncheck();
  await page.screenshot({
    path: `artifacts/${info.project.name}-ai-playlist.png`,
    fullPage: true,
  });
  await page
    .getByRole('button', { name: 'Salva playlist nella libreria', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Notte in viaggio', exact: true }),
  ).toBeVisible();
  await expect
    .poll(async () => {
      const lib =
        (await (await page.request.get('/api/me/library')).json()).library ??
        emptyLibrary();
      return lib.playlists[0]?.tracks.map((t: { id: string }) => t.id);
    })
    .toEqual([track.id]);
});
