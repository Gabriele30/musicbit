import {
  catalogItemToTrack,
  emptyLibrary,
  emptyTaste,
  personalRecommendations,
} from '../../../packages/shared/dist/index.js';
export const artists = [
  'Toni Zeno',
  'Nu Genea',
  'Khruangbin',
  'Massive Attack',
  'Nujabes',
  'Bonobo',
];
const titles = [
  'DISISA',
  'Una sarpa',
  'Time (You and I)',
  'Unfinished Sympathy',
  'Feather (feat. Cise Starr & Akin)',
  'Cirrus',
  'Montescuderi (feat. Calì)',
  'Tienaté',
  'A Love International',
  'Teardrop',
  'Aruarian Dance',
  'Kerala',
];
export const songs = Array.from({ length: 24 }, (_, i) => ({
  id: `audit${String(i + 1).padStart(6, '0')}`,
  kind: 'track',
  provider: 'youtube',
  title:
    i === 18
      ? 'Una notte lunghissima tra le stelle, il mare e tutte le strade che non abbiamo percorso (feat. un altro artista)'
      : `${titles[i % 12]}${i >= 12 ? ' — Live Session' : ''}`,
  artist: artists[i % artists.length],
  album: i % 6 === 0 ? 'TRUVATURA' : 'Sessioni e nuove scoperte',
  artworkUrl: `https://i.ytimg.com/vi/audit${String(i + 1).padStart(6, '0')}/hqdefault.jpg`,
  audioUrl: `/__test_media/soundhelix-${(i % 3) + 1}.wav`,
  sourceUrl: `https://music.youtube.com/watch?v=audit${String(i + 1).padStart(6, '0')}`,
  durationSeconds: 30,
  playback: { available: true },
}));
export const artistItems = artists.map((name, i) => ({
  ...songs[i],
  id: `UC${String(i + 1).padStart(22, 'a')}`,
  kind: 'artist',
  durationSeconds: undefined,
  audioUrl: undefined,
  title: name,
  artist: name,
  playback: { available: false },
}));
export const albums = artists.map((name, i) => ({
  ...songs[i],
  id: `MPRaudit${i}`,
  kind: 'album',
  durationSeconds: 360,
  audioUrl: undefined,
  title: i === 0 ? 'TRUVATURA' : `Le sessioni complete di ${name}`,
  artist: name,
  playback: { available: false },
}));
const timing = { cache: 'hit', elapsedMs: 2 };
export function libraryFixture() {
  const library = emptyLibrary();
  library.favorites = songs.slice(0, 8).map(catalogItemToTrack);
  library.history = songs.slice(0, 12).map((item, i) => ({
    track: catalogItemToTrack(item),
    playedAt: Date.now() - i * 60000,
  }));
  library.savedAlbums = albums.slice(0, 3);
  library.followedArtists = artistItems.slice(0, 3);
  library.playlists = [
    {
      id: 'audit-evening',
      name: 'La sera, senza fretta',
      tracks: songs.slice(0, 12).map(catalogItemToTrack),
      updatedAt: Date.now(),
    },
    {
      id: 'audit-long',
      name: 'Per tutti i viaggi lunghissimi e le notti che non finiscono mai',
      tracks: songs.slice(12).map(catalogItemToTrack),
      updatedAt: Date.now(),
    },
  ];
  library.taste = {
    ...emptyTaste(),
    signals: [
      { id: songs[0].id, completed: 8, skipped: 0 },
      { id: songs[3].id, completed: 0, skipped: 6 },
    ],
  };
  return library;
}
export async function installFixtures(context) {
  await context.route('https://i.ytimg.com/vi/**', (route) => {
    const index =
      Number(new URL(route.request().url()).pathname.split('/')[2].slice(-6)) -
      1;
    const colors = [
      '#b56848',
      '#516c6c',
      '#8f8174',
      '#524b6c',
      '#aa995c',
      '#385b4a',
    ];
    return route.fulfill({
      contentType: 'image/svg+xml',
      body: `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600"><rect width="600" height="600" fill="${colors[index % 6]}"/><circle cx="300" cy="260" r="160" fill="#ffffff18"/><path d="M0 430 Q200 240 400 460 T800 350 V600 H0" fill="#0005"/><text x="40" y="555" fill="#fff" font-family="sans-serif" font-size="38">${artists[index % 6]}</text></svg>`,
    });
  });
  await context.route('**/api/providers', (route) =>
    route.fulfill({ json: { providers: [] } }),
  );
  await context.route('**/api/feed', (route) =>
    route.fulfill({
      json: {
        sections: [
          {
            id: 'fresh',
            title: 'Nuove uscite per te',
            items: songs.slice(12, 20),
          },
          { id: 'albums', title: 'Album da esplorare', items: albums },
        ],
        timing,
      },
    }),
  );
  await context.route('**/api/search?*', (route) => {
    const params = new URL(route.request().url()).searchParams;
    const type = params.get('type');
    const q = params.get('q').toLowerCase();
    const pool =
      type === 'artist' ? artistItems : type === 'album' ? albums : songs;
    return route.fulfill({
      json: {
        provider: 'youtube',
        type,
        items: pool.filter((item) =>
          `${item.title} ${item.artist} ${item.album}`
            .toLowerCase()
            .includes(q),
        ),
        timing,
      },
    });
  });
  await context.route('**/api/catalog/**', (route) => {
    const [kind, id] = new URL(route.request().url()).pathname
      .split('/')
      .slice(-2);
    const item = [...songs, ...albums, ...artistItems].find(
      (item) => item.id === id,
    );
    if (!item)
      return route.fulfill({
        status: 404,
        json: { error: 'Elemento non trovato' },
      });
    const tracks =
      kind === 'album'
        ? songs.slice(0, 12).map((track) => ({
            ...track,
            album: item.title,
            artist: item.artist,
            artworkUrl: item.artworkUrl,
          }))
        : songs.filter((song) => song.artist === item.artist);
    return route.fulfill({
      json: {
        item: {
          ...item,
          tracks,
          albums: albums.filter((album) => album.artist === item.artist),
          related: artistItems.filter((artist) => artist.id !== id),
          description:
            'Una selezione tra ascolti familiari, nuove scoperte e sessioni dal vivo.',
        },
        timing,
      },
    });
  });
  await context.route('**/api/me/recommendations', async (route) => {
    const response = await context.request.get(
      new URL('/api/me/library', route.request().url()).href,
    );
    const data = await response.json();
    return route.fulfill({
      json: { items: personalRecommendations(data.library, songs), timing },
    });
  });
  await context.route('**/api/me/discovery/artists', (route) =>
    route.fulfill({
      json: {
        artists: artistItems.slice(3),
        basedOn: artists.slice(0, 3),
        source: 'related',
      },
    }),
  );
  await context.route('**/api/recommendations/*', (route) =>
    route.fulfill({
      json: {
        seedId: new URL(route.request().url()).pathname.split('/').at(-1),
        items: songs.slice(12),
        timing,
      },
    }),
  );
  await context.route('**/api/me/radio/*', (route) =>
    route.fulfill({
      json: {
        seedId: new URL(route.request().url()).pathname.split('/').at(-1),
        items: songs.slice(12),
        timing,
      },
    }),
  );
  await context.route('**/api/charts/spotify?*', (route) =>
    route.fulfill({
      json: {
        market: 'it',
        date: '2026-10-24',
        sourceUrl: 'https://kworb.net/spotify/country/it_daily.html',
        officialUrl: 'https://charts.spotify.com',
        stale: false,
        entries: songs.slice(0, 10).map((song, i) => ({
          position: i + 1,
          title: song.title,
          artist: song.artist,
          streams: 100000 - i * 2500,
          spotifyUrl: `https://open.spotify.com/track/${String(i).padStart(22, '0')}`,
          change: '=',
        })),
      },
    }),
  );
  await context.route('**/api/me/stats?*', (route) =>
    route.fulfill({
      json: {
        from: '2026-01-01',
        to: '2026-12-31',
        seconds: 86400,
        plays: 638,
        activeDays: 83,
        distinctArtists: 45,
        distinctTracks: 206,
        topTracks: songs.slice(0, 8).map((song, i) => ({
          track: catalogItemToTrack(song),
          seconds: 3600 - i * 300,
          plays: 20 - i,
        })),
        topArtists: artists.map((artist, i) => ({
          artist,
          seconds: 6000 - i * 300,
          plays: 20 - i,
        })),
        months: Array.from({ length: 12 }, (_, i) => ({
          month: `2026-${String(i + 1).padStart(2, '0')}`,
          seconds: 6000 + i * 400,
        })),
      },
    }),
  );
}
