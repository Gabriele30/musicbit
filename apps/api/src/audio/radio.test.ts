import { expect, it, vi } from 'vitest';
import {
  catalogItemToTrack,
  emptyLibrary,
  emptyTaste,
  type CatalogItem,
} from '@musicbit/shared';
import { personalRadio } from './radio.js';

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
