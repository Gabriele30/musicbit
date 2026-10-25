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
  it('prefers square album artwork to a larger video still', async () => {
    const client = gateway();
    client.details = vi.fn(async () => ({
      ...song,
      thumbnails: [
        {
          url: 'https://i.ytimg.com/vi/abcdefghijk/maxresdefault.jpg',
          width: 1280,
          height: 720,
        },
        {
          url: 'https://lh3.googleusercontent.com/album=w600-h600',
          width: 600,
          height: 600,
        },
      ],
    }));
    expect(
      await new YouTubeCatalogProvider(client).details('track', id, abort()),
    ).toMatchObject({
      artworkUrl: 'https://lh3.googleusercontent.com/album=w600-h600',
    });
  });
  it('inherits missing album-track artists while preserving explicit featured credits', async () => {
    const client = gateway();
    client.details = vi.fn(async () => ({
      header: {
        title: 'TRUVATURA',
        artists: [{ name: 'Toni Zeno', channel_id: artistId }],
        thumbnail: { contents: [thumbnail] },
      },
      contents: [
        { ...song, artists: [], title: 'DISISA' },
        {
          ...song,
          id: 'lmnopqrstuv',
          title: 'UNA SARPA',
          artists: undefined,
          authors: [],
        },
        {
          ...song,
          id: '12345678901',
          artists: [
            { name: 'Toni Zeno', channel_id: artistId },
            { name: 'Calì' },
          ],
        },
        { ...song, id: '23456789012', artists: [{ name: 'Guest Artist' }] },
      ],
    }));
    const detail = await new YouTubeCatalogProvider(client).details(
      'album',
      'MPRalbum123',
      abort(),
    );
    expect(
      detail?.tracks?.map((t) => ({ artist: t.artist, artistId: t.artistId })),
    ).toEqual([
      { artist: 'Toni Zeno', artistId },
      { artist: 'Toni Zeno', artistId },
      { artist: 'Toni Zeno, Calì', artistId },
      { artist: 'Guest Artist', artistId: undefined },
    ]);
    client.details = vi.fn(async () => ({
      header: { title: 'Unknown album' },
      contents: [{ ...song, artists: [] }],
    }));
    const unknown = await new YouTubeCatalogProvider(client).details(
      'album',
      'MPRalbum123',
      abort(),
    );
    expect(unknown?.tracks?.[0]?.artist).toBe('Artista non indicato');
  });
  it('hydrates portraits for artists inferred from home tracks', async () => {
    const client = gateway();
    client.home = vi.fn(async () => ({
      sections: [
        {
          title: 'Quick picks',
          contents: [
            { ...song, artists: [{ name: 'Artist', channel_id: artistId }] },
          ],
        },
      ],
    }));
    client.details = vi.fn(async () => ({
      header: { title: 'Artist', thumbnail: { contents: [thumbnail] } },
      sections: [],
    }));
    const sections = await new YouTubeCatalogProvider(client).home(abort());
    expect(
      sections.find((s) => s.id === 'discover-artist')?.items[0],
    ).toMatchObject({ id: artistId, artworkUrl: thumbnail.url });
    expect(client.details).toHaveBeenCalledWith(
      'artist',
      artistId,
      expect.any(AbortSignal),
    );
  });
  it('builds a mixed home feed and radio without leaking raw provider data', async () => {
    const client = gateway();
    client.home = vi.fn(async () => ({
      sections: [
        {
          header: { title: { toString: () => 'Discover' } },
          contents: [
            song,
            song,
            { id: 'MPRalbum123', item_type: 'album', title: 'Album' },
            { id: 'PLunsupported', item_type: 'playlist', title: 'Playlist' },
          ],
        },
      ],
    }));
    client.recommendations = vi.fn(async () => ({
      contents: [
        { ...song, video_id: id },
        { ...song, id: 'lmnopqrstuv', video_id: 'lmnopqrstuv' },
      ],
    }));
    const provider = new YouTubeCatalogProvider(client);
    const sections = await provider.home(abort());
    expect(sections[0]?.title).toBe('Discover');
    expect(sections[0]?.items.map((item) => item.kind)).toEqual([
      'track',
      'album',
    ]);
    expect(sections[0]?.items.every(isCatalogItem)).toBe(true);
    expect(
      (await provider.recommendations(id, abort())).map((item) => item.id),
    ).toEqual(['lmnopqrstuv']);
    expect(JSON.stringify(sections)).not.toContain('secret');
  });
  it('exposes artist songs, discography and related artists with navigable references', async () => {
    const client = gateway();
    client.details = vi.fn(async () => ({
      header: { title: 'Artist' },
      sections: [
        {
          contents: [
            {
              ...song,
              artists: [{ name: 'Artist', channel_id: artistId }],
              album: { id: 'MPRalbum123', name: 'Album' },
            },
            { id: 'MPRalbum123', item_type: 'album', title: 'Album' },
            {
              id: 'UCzyxwvutsrqponmlkjihgfe',
              item_type: 'artist',
              name: 'Similar artist',
            },
          ],
        },
      ],
    }));
    const detail = await new YouTubeCatalogProvider(client).details(
      'artist',
      artistId,
      abort(),
    );
    expect(detail?.tracks?.[0]).toMatchObject({
      artistId,
      albumId: 'MPRalbum123',
    });
    expect(detail?.albums?.[0]).toMatchObject({
      title: 'Album',
      artist: 'Artist',
      artists: ['Artist'],
      artistId,
    });
    expect(detail?.relatedArtists?.[0]?.title).toBe('Similar artist');
  });
  it('inherits missing discography credits without replacing collaborations or related artists', async () => {
    const client = gateway();
    client.details = vi.fn(async () => ({
      header: { title: 'MadMan' },
      sections: [
        {
          contents: [
            { item_type: 'song', id, title: 'Solo track' },
            {
              ...song,
              id: 'lmnopqrstuv',
              artists: [{ name: 'Gemitaiz' }, { name: 'MadMan' }],
            },
            {
              id: 'UCzyxwvutsrqponmlkjihgfe',
              item_type: 'artist',
              name: 'Gemitaiz',
            },
          ],
        },
      ],
    }));
    const detail = await new YouTubeCatalogProvider(client).details(
      'artist',
      artistId,
      abort(),
    );
    expect(detail?.tracks?.[0]).toMatchObject({
      artist: 'MadMan',
      artists: ['MadMan'],
      artistId,
    });
    expect(detail?.tracks?.[1]).toMatchObject({
      artist: 'Gemitaiz, MadMan',
      artists: ['Gemitaiz', 'MadMan'],
    });
    expect(detail?.relatedArtists?.[0]?.artist).toBe('Gemitaiz');
  });
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
      playback: { available: true },
      audioUrl: `/api/audio/${id}`,
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
      contents: [
        {
          ...song,
          thumbnails: [
            {
              ...thumbnail,
              url: 'https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg',
            },
          ],
        },
      ],
      sections: ['unrelated recommendations'],
    }));
    const detail = await provider.details('album', 'MPRalbum123', abort());
    expect(detail).toMatchObject({
      title: 'Album title',
      artist: 'Artist',
      tracks: [
        {
          id,
          album: 'Album title',
          albumId: 'MPRalbum123',
          artworkUrl: thumbnail.url,
        },
      ],
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
