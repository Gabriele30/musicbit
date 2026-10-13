import { afterEach, expect, it, vi } from 'vitest';
import { emptyLibrary, emptyTaste, type CatalogItem } from '@musicbit/shared';
import { ArtistDiscoveryService } from './discovery.js';
import { AiPlaylistService } from './ai-playlists.js';
import { CatalogService } from '../catalog/service.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
it('uses a short artist-only request for the local model and validates its output', async () => {
  vi.stubEnv('AI_PROVIDER', 'ollama');
  vi.stubEnv('OLLAMA_BASE_URL', 'http://localhost:11434');
  const request = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          done: true,
          response: JSON.stringify({ artists: ['New Artist'] }),
        }),
      ),
  );
  vi.stubGlobal('fetch', request);
  expect(
    await new AiPlaylistService().discoveryArtists(
      ['Seed Artist'],
      new AbortController().signal,
    ),
  ).toEqual(['New Artist']);
  const options = request.mock.calls[0] as unknown as [URL, RequestInit];
  expect(JSON.parse(String(options[1].body))).toMatchObject({
    options: { num_ctx: 1024, num_predict: 128 },
    prompt: JSON.stringify({ artists: ['Seed Artist'], count: 5 }),
  });
  request.mockResolvedValueOnce(
    new Response(
      JSON.stringify({
        done: true,
        response: JSON.stringify({ artists: [42] }),
      }),
    ),
  );
  await expect(
    new AiPlaylistService().discoveryArtists(
      ['Seed Artist'],
      new AbortController().signal,
    ),
  ).rejects.toThrow('Invalid artist names');
});

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
