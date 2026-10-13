import { expect, it, vi } from 'vitest';
import { emptyLibrary, emptyTaste, type CatalogItem } from '@musicbit/shared';
import { ArtistDiscoveryService } from './discovery.js';
import { AiPlaylistService } from './ai-playlists.js';
import { CatalogService } from '../catalog/service.js';

it('verifies AI artist names, respects blocked artists and caches each account separately', async () => {
  const artist: CatalogItem = {
    id: 'UCabcdefghijklmnopqrstuv',
    provider: 'youtube',
    kind: 'artist',
    title: 'New Artist',
    artist: 'New Artist',
    sourceUrl: 'https://music.youtube.com/channel/UCabcdefghijklmnopqrstuv',
    playback: { available: false },
  };
  const library = emptyLibrary();
  library.taste = emptyTaste();
  library.followedArtists = [
    { ...artist, id: 'UC1234567890123456789012', title: 'Seed Artist' },
  ];
  library.taste!.artistPreferences = [
    { artist: 'Blocked Artist', preference: 'blocked' },
  ];
  const plan = vi.fn(async () => ({
    name: 'Discovery',
    description: 'Similar artists',
    songs: [
      'Seed Artist',
      'Blocked Artist',
      'New Artist',
      'Invented Artist',
    ].map((artist) => ({ title: 'Song', artist })),
  }));
  const ai = new AiPlaylistService(plan);
  const catalog = new CatalogService({
    id: 'youtube',
    search: vi.fn(async (q) => (q.q === 'New Artist' ? [artist] : [])),
    details: vi.fn(async () => ({
      ...artist,
      artworkUrl: 'https://lh3.googleusercontent.com/portrait',
    })),
  });
  const service = new ArtistDiscoveryService();
  const result = await service.get('first-account', library, catalog, ai);
  expect(result).toMatchObject({
    source: 'ai',
    basedOn: ['Seed Artist'],
    artists: [
      {
        title: 'New Artist',
        artworkUrl: 'https://lh3.googleusercontent.com/portrait',
      },
    ],
  });
  expect(result.artists).toHaveLength(1);
  expect(plan.mock.calls[0]).toBeDefined();
  await service.get('first-account', library, catalog, ai);
  expect(plan).toHaveBeenCalledOnce();
  await service.get('second-account', library, catalog, ai);
  expect(plan).toHaveBeenCalledTimes(2);
  catalog.close();
});

it('does not call the AI before an account has a listening profile', async () => {
  const plan = vi.fn();
  const catalog = new CatalogService();
  const result = await new ArtistDiscoveryService().get(
    'new-user',
    emptyLibrary(),
    catalog,
    new AiPlaylistService(plan),
  );
  expect(result).toEqual({ artists: [], basedOn: [], source: 'empty' });
  expect(plan).not.toHaveBeenCalled();
  catalog.close();
});
