import { AsyncLocalStorage } from 'node:async_hooks';
import { describe, expect, it, vi } from 'vitest';
import { isCatalogItem } from '@musicbit/shared';
import {
  metadataFetch,
  YouTubeCatalogProvider,
  type MusicMetadataGateway,
} from './youtube.js';

const id = 'abcdefghijk';
const artistId = 'UCabcdefghijklmnopqrstuv';
const thumbnail = {
  url: 'https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg',
  width: 480,
};
const song = {
  id,
  item_type: 'song',
  title: 'A song',
  artists: [{ name: 'Artist' }],
  thumbnails: [thumbnail],
  duration: { seconds: 123 },
  album: { name: 'Album' },
  streaming_data: { secret: 'must never be returned' },
};
const abort = () => new AbortController().signal;
function gateway(): MusicMetadataGateway {
  return {
    search: vi.fn(async () => ({
      contents: [{ title: 'Localized shelf', contents: [song, song] }],
    })),
    details: vi.fn(async () => ({ ...song, video_id: id })),
  };
}

describe('YouTube catalog provider with deterministic metadata mocks', () => {
  it('normalizes tracks, deduplicates and never returns media or playback capability', async () => {
    const provider = new YouTubeCatalogProvider(gateway());
    const items = await provider.search(
      { q: 'song', type: 'track', limit: 5 },
      abort(),
    );
    expect(items).toHaveLength(1);
    expect(isCatalogItem(items[0])).toBe(true);
    expect(items[0]).toMatchObject({
      title: 'A song',
      artist: 'Artist',
      album: 'Album',
      durationSeconds: 123,
      playback: { available: false },
    });
    expect(JSON.stringify(items)).not.toContain('streaming');
    expect(await provider.listTracks()).toEqual([]);
    expect(await provider.getTrack()).toBeUndefined();
    expect(provider.catalog).toBe(provider);
  });
  it('handles artists, albums, unknown nodes and unsafe thumbnails', async () => {
    const client = gateway();
    client.search = vi.fn(async () => ({
      contents: [
        {
          contents: [
            {
              item_type: 'artist',
              id: artistId,
              name: 'A name',
              thumbnails: [{ url: 'https://evil.example/secret' }],
            },
            {
              item_type: 'album',
              id: 'MPRalbum123',
              title: 'An album',
              author: { name: 'A name' },
              year: '2024',
              thumbnail: { contents: [thumbnail] },
            },
            { item_type: 'artist', id: 'invalid', name: 'Malformed' },
            { item_type: 'playlist', id: 'PLignore' },
          ],
        },
      ],
    }));
    const provider = new YouTubeCatalogProvider(client);
    const artists = await provider.search(
      { q: 'name', type: 'artist', limit: 1 },
      abort(),
    );
    expect(artists[0]).toMatchObject({
      id: artistId,
      title: 'A name',
      artist: 'A name',
    });
    expect(artists[0]?.artworkUrl).toBeUndefined();
    const albums = await provider.search(
      { q: 'name', type: 'album', limit: 2 },
      abort(),
    );
    expect(albums[0]).toMatchObject({
      id: 'MPRalbum123',
      year: '2024',
      artist: 'A name',
      artworkUrl: thumbnail.url,
    });
  });
  it('normalizes selected track and album listing without recommendations', async () => {
    const client = gateway();
    const provider = new YouTubeCatalogProvider(client);
    expect(await provider.details('track', id, abort())).toMatchObject({
      id,
      title: 'A song',
    });
    client.details = vi.fn(async () => ({
      header: {
        title: { toString: () => 'Album title' },
        strapline_text_one: { toString: () => 'Artist' },
        thumbnail: { contents: [thumbnail] },
      },
      contents: [song],
      sections: ['unrelated recommendations'],
    }));
    const detail = await provider.details('album', 'MPRalbum123', abort());
    expect(detail).toMatchObject({
      title: 'Album title',
      artist: 'Artist',
      tracks: [{ id }],
    });
    expect(JSON.stringify(detail)).not.toContain('recommendations');
    client.details = vi.fn(async () => undefined);
    expect(await provider.details('track', id, abort())).toBeUndefined();
  });
  it('returns empty results on missing shelves and respects cancelled signals', async () => {
    const client = gateway();
    client.search = vi.fn(async () => ({}));
    const provider = new YouTubeCatalogProvider(client);
    expect(
      await provider.search({ q: 'none', type: 'track', limit: 5 }, abort()),
    ).toEqual([]);
    const controller = new AbortController();
    controller.abort();
    await expect(
      provider.search(
        { q: 'none', type: 'track', limit: 5 },
        controller.signal,
      ),
    ).rejects.toThrow();
  });
  it('blocks player, media hosts, redirects and propagates the request signal', async () => {
    const scope = new AsyncLocalStorage<AbortSignal>();
    const upstream = vi.fn<typeof fetch>(async () => new Response('{}'));
    const guarded = metadataFetch(scope, upstream);
    await expect(
      guarded('https://www.youtube.com/youtubei/v1/player'),
    ).rejects.toThrow('METADATA_ENDPOINT_ONLY');
    await expect(guarded('https://x.googlevideo.com/audio')).rejects.toThrow(
      'METADATA_ENDPOINT_ONLY',
    );
    await expect(
      guarded('https://evil.example/youtubei/v1/search'),
    ).rejects.toThrow('METADATA_ENDPOINT_ONLY');
    const controller = new AbortController();
    await scope.run(controller.signal, () =>
      guarded('https://music.youtube.com/youtubei/v1/search', {
        method: 'POST',
      }),
    );
    const init = upstream.mock.calls[0]?.[1];
    expect(init?.redirect).toBe('error');
    controller.abort();
    expect(init?.signal?.aborted).toBe(true);
    expect(upstream).toHaveBeenCalledTimes(1);
  });
});
