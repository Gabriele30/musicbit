import { expect, it, vi } from 'vitest';
import {
  catalogItemToTrack,
  emptyLibrary,
  emptyTaste,
  type CatalogItem,
  isCatalogItem,
} from '@musicbit/shared';
import { cachedRadio, cachedCatalogItem, personalRadio } from './radio.js';

const item = (id: string, artist = id): CatalogItem => ({
  id,
  kind: 'track',
  provider: 'youtube',
  title: id,
  artist,
  audioUrl: `/api/audio/${id}`,
  sourceUrl: `https://music.youtube.com/watch?v=${id}`,
  playback: { available: true },
});
const response = (seedId: string, items: CatalogItem[]) => ({
  seedId,
  items,
  timing: { cache: 'miss' as const, elapsedMs: 0 },
});
it('converts a saved track with a local placeholder into a valid network catalog item', () => {
  const track = {
    ...catalogItemToTrack(item('cached00001', 'Toni Zeno')),
    artworkUrl: '/icons/icon-192.png',
    artistId: 'old-unknown-id',
    durationSeconds: 0,
  };
  const value = cachedCatalogItem(track);
  expect(isCatalogItem(value)).toBe(true);
  expect(value.artworkUrl).toBeUndefined();
  expect(value.artistId).toBeUndefined();
  expect(value.durationSeconds).toBeUndefined();
  expect(isCatalogItem(cachedCatalogItem(catalogItemToTrack(value)))).toBe(
    true,
  );
});
it('exhausts a cached listening pool before repeating the oldest program entries', () => {
  const library = emptyLibrary();
  library.history = Array.from({ length: 24 }, (_, i) => ({
    track: catalogItemToTrack(
      item(`cached${String(i).padStart(5, '0')}`, `Artist ${i}`),
    ),
    playedAt: Date.now() - i,
  }));
  const program = library.history.slice(0, 12).map((e) => e.track.id);
  for (let i = 0; i < 4; i++) {
    const next = cachedRadio(library, () => true, program);
    expect(next).toHaveLength(3);
    expect(next.every((t) => !program.includes(t.id))).toBe(true);
    program.push(...next.map((t) => t.id));
  }
  expect(new Set(program).size).toBe(24);
  expect(cachedRadio(library, () => true, program).map((t) => t.id)).toEqual(
    program.slice(0, 3),
  );
});
it('varies equally relevant radio choices while moving its profile seeds beyond the queued songs', async () => {
  const library = emptyLibrary();
  library.history = [
    'anchor00001',
    'anchor00002',
    'anchor00003',
    'anchor00004',
  ].map((id, i) => ({
    track: catalogItemToTrack(item(id, `Artist ${i}`)),
    playedAt: Date.now() - i,
  }));
  const candidates = Array.from({ length: 8 }, (_, i) =>
    item(`radio${String(i).padStart(6, '0')}`, `New artist ${i}`),
  );
  const catalog = {
    recommendations: vi.fn(async (seed: string) => response(seed, candidates)),
  };
  const random = vi.spyOn(Math, 'random');
  try {
    let draw = 0;
    random.mockImplementation(() => ++draw / 10);
    const a = await personalRadio(
      catalog,
      'original001',
      new AbortController().signal,
      library,
      ['anchor00001', 'anchor00002'],
    );
    expect(catalog.recommendations.mock.calls.map(([id]) => id)).toEqual([
      'original001',
      'anchor00003',
      'anchor00004',
    ]);
    draw = 9;
    random.mockImplementation(() => --draw / 10);
    const b = await personalRadio(
      catalog,
      'original001',
      new AbortController().signal,
      library,
      ['anchor00001', 'anchor00002'],
    );
    expect(a.items.map((t) => t.id)).not.toEqual(b.items.map((t) => t.id));
    expect(new Set(a.items.map((t) => t.id))).toEqual(
      new Set(b.items.map((t) => t.id)),
    );
  } finally {
    random.mockRestore();
  }
});
it('excludes queued songs before applying the ranking limit so cached radio can refill beyond its first twelve', () => {
  const library = emptyLibrary();
  library.history = Array.from({ length: 20 }, (_, i) => ({
    track: catalogItemToTrack(
      item(`cached${String(i).padStart(5, '0')}`, `Artist ${i}`),
    ),
    playedAt: Date.now() - i,
  }));
  const queued = library.history.slice(0, 12).map((entry) => entry.track.id);
  const tracks = cachedRadio(library, () => true, queued, false);
  expect(tracks).toHaveLength(3);
  expect(tracks.every((track) => !queued.includes(track.id))).toBe(true);
});
it('keeps cached radio personal, excludes blocked artists and permits a small cached library to repeat', () => {
  const library = emptyLibrary();
  library.history = [
    'cached00001',
    'cached00002',
    'blocked0001',
    'missing0001',
  ].map((id) => ({
    track: catalogItemToTrack(
      item(id, id === 'blocked0001' ? 'Blocked' : 'Favorite'),
    ),
    playedAt: Date.now(),
  }));
  library.taste = {
    ...emptyTaste(),
    artistPreferences: [{ artist: 'Blocked', preference: 'blocked' }],
  };
  const available = (id: string) => id !== 'missing0001';
  expect(
    cachedRadio(library, available, ['cached00001']).map((track) => track.id),
  ).toEqual(['cached00002']);
  expect(
    new Set(
      cachedRadio(library, available, ['cached00001', 'cached00002']).map(
        (track) => track.id,
      ),
    ),
  ).toEqual(new Set(['cached00001', 'cached00002']));
});
it('ranks fresh listening feedback and filters repeats, blocked artists, dismissed songs and duplicate IDs', async () => {
  const library = emptyLibrary();
  library.favorites = [catalogItemToTrack(item('favorite001', 'Favorite'))];
  library.taste = {
    ...emptyTaste(),
    dismissed: ['dismissed01'],
    artistPreferences: [{ artist: 'Blocked', preference: 'blocked' }],
  };
  const candidates = [
    item('newtrack001', 'Other'),
    item('newtrack002', 'Favorite'),
    item('newtrack002', 'Favorite'),
    item('blocked0001', 'Blocked'),
    item('dismissed01'),
    item('already0001'),
    { ...item('external001'), audioUrl: 'https://external.test/audio' },
  ];
  const catalog = {
    recommendations: vi.fn(async (seed: string) => response(seed, candidates)),
  };
  const first = await personalRadio(
    catalog,
    'original001',
    new AbortController().signal,
    library,
    ['already0001'],
  );
  expect(first.items.map((track) => track.id)).toEqual([
    'newtrack002',
    'newtrack001',
  ]);
  library.taste.artistPreferences = [
    { artist: 'Other', preference: 'more' },
    { artist: 'Blocked', preference: 'blocked' },
  ];
  const second = await personalRadio(
    catalog,
    'original001',
    new AbortController().signal,
    library,
    ['already0001'],
  );
  expect(second.items[0]!.artist).toBe('Other');
});
it('uses recent listening seeds and a feed fallback when a provider radio is empty or fails', async () => {
  const library = emptyLibrary();
  library.history = [
    { track: catalogItemToTrack(item('recent00001')), playedAt: Date.now() },
  ];
  const recommendations = vi.fn(async (seed: string) => {
    if (seed === 'original001') throw new Error('Temporary provider outage');
    return response(seed, [item('related0001')]);
  });
  const fromRecent = await personalRadio(
    { recommendations },
    'original001',
    new AbortController().signal,
    library,
  );
  expect(recommendations.mock.calls.map(([id]) => id)).toEqual([
    'original001',
    'recent00001',
  ]);
  expect(fromRecent).toMatchObject({
    partial: true,
    retry: false,
    items: [{ id: 'related0001' }],
  });
  const home = vi.fn(async () => ({
    sections: [{ id: 'mix', title: 'Mix', items: [item('fallback001')] }],
    timing: { cache: 'hit' as const, elapsedMs: 0 },
  }));
  const fromFeed = await personalRadio(
    {
      recommendations: vi.fn(async (seed: string) => response(seed, [])),
      home,
    },
    'original001',
    new AbortController().signal,
  );
  expect(home).toHaveBeenCalledOnce();
  expect(fromFeed).toMatchObject({
    retry: false,
    items: [{ id: 'fallback001' }],
  });
  const empty = await personalRadio(
    { recommendations: vi.fn(async (seed: string) => response(seed, [])) },
    'original001',
    new AbortController().signal,
  );
  expect(empty.retry).toBe(true);
});
