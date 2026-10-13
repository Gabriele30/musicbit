import { AsyncLocalStorage } from 'node:async_hooks';
import { Innertube, Log } from 'youtubei.js';
import {
  isCatalogArtwork,
  isCatalogId,
  type CatalogDetail,
  type CatalogItem,
  type CatalogKind,
  type CatalogProvider,
  type CatalogQuery,
  type MusicProvider,
  type FeedSection,
} from '@musicbit/shared';

/** Narrow seam for deterministic tests; deliberately excludes all media methods. */
export interface MusicMetadataGateway {
  home?(signal: AbortSignal): Promise<unknown>;
  recommendations?(id: string, signal: AbortSignal): Promise<unknown>;
  search(query: CatalogQuery, signal: AbortSignal): Promise<unknown>;
  details(kind: CatalogKind, id: string, signal: AbortSignal): Promise<unknown>;
}

/** No /player, player JS, media hosts, redirects, cookies supplied by users or login. */
export function metadataFetch(
  scope: AsyncLocalStorage<AbortSignal>,
  upstream: typeof fetch = fetch,
): typeof fetch {
  return (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      ![
        'www.youtube.com',
        'music.youtube.com',
        'youtubei.googleapis.com',
      ].includes(url.hostname) ||
      !/^\/youtubei\/v1\/(search|browse|next)$/.test(url.pathname)
    ) {
      return Promise.reject(new Error('METADATA_ENDPOINT_ONLY'));
    }
    const signals = [
      scope.getStore(),
      init?.signal,
      input instanceof Request ? input.signal : undefined,
    ].filter((signal): signal is AbortSignal => !!signal);
    return upstream(input, {
      ...init,
      redirect: 'error',
      signal: AbortSignal.any(signals),
    });
  };
}

export class YouTubeMusicGateway implements MusicMetadataGateway {
  private scope = new AsyncLocalStorage<AbortSignal>();
  private session?: Promise<Innertube>;
  private client() {
    if (!this.session) {
      // Library parser errors can include raw responses. Our API logs safe codes instead.
      Log.setLevel(Log.Level.NONE);
      this.session = Innertube.create({
        lang: 'en',
        location: 'IT',
        retrieve_player: false,
        generate_session_locally: true,
        retrieve_innertube_config: false,
        enable_session_cache: false,
        fetch: metadataFetch(this.scope),
      }).catch((error) => {
        this.session = undefined;
        throw error;
      });
    }
    return this.session;
  }
  search(query: CatalogQuery, signal: AbortSignal) {
    return this.scope.run(signal, async () => {
      const client = await this.client();
      signal.throwIfAborted();
      return client.music.search(query.q, {
        type: query.type === 'track' ? 'song' : query.type,
      });
    });
  }
  home(signal: AbortSignal) {
    return this.scope.run(signal, async () => {
      const client = await this.client();
      signal.throwIfAborted();
      return client.music.getHomeFeed();
    });
  }
  recommendations(id: string, signal: AbortSignal) {
    return this.scope.run(signal, async () => {
      const client = await this.client();
      signal.throwIfAborted();
      return client.music.getUpNext(id, true);
    });
  }
  details(kind: CatalogKind, id: string, signal: AbortSignal) {
    return this.scope.run(signal, async () => {
      const client = await this.client();
      signal.throwIfAborted();
      if (kind === 'artist') return client.music.getArtist(id);
      if (kind === 'album') return client.music.getAlbum(id);
      // getInfo/getBasicInfo invoke /player and parse streaming data: never use them.
      // /next exposes metadata; automix=false avoids requesting a radio playlist.
      const panel = await client.music.getUpNext(id, false);
      return panel.contents.find((item) => object(item).video_id === id);
    });
  }
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : {};
}
function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
function text(value: unknown, max = 300): string {
  if (typeof value === 'string') return value.trim().slice(0, max);
  if (
    value &&
    typeof value === 'object' &&
    value.toString !== Object.prototype.toString
  )
    return String(value).trim().slice(0, max);
  return '';
}
function artwork(node: Record<string, unknown>): string | undefined {
  const candidates = array(node.thumbnails).concat(
    array(node.thumbnail),
    array(object(node.thumbnail).contents),
  );
  return candidates
    .map(object)
    .filter(
      (item) => typeof item.url === 'string' && isCatalogArtwork(item.url),
    )
    .sort((a, b) => Number(b.width ?? 0) - Number(a.width ?? 0))
    .map((item) => String(item.url))[0];
}

const UNKNOWN_ARTIST = 'Artista non indicato';
function normalize(
  raw: unknown,
  kind: CatalogKind,
  explicitId?: string,
): CatalogItem | undefined {
  const node = object(raw);
  const id = text(explicitId ?? node.id ?? node.video_id);
  const title = text(node.title ?? node.name);
  if (!isCatalogId(kind, id) || !title) return undefined;
  const names = array(node.artists ?? node.authors)
    .map((item) => text(object(item).name))
    .filter(Boolean);
  const artist =
    kind === 'artist'
      ? title
      : names.join(', ') ||
        text(object(node.author).name) ||
        text(node.author) ||
        text(node.strapline_text_one) ||
        UNKNOWN_ARTIST;
  const duration = object(node.duration).seconds;
  const artistId = text(
    object(array(node.artists ?? node.authors)[0]).channel_id ??
      object(node.author).channel_id,
  );
  const albumId = text(object(node.album).id);
  return {
    id,
    provider: 'youtube',
    kind,
    title,
    artist,
    artworkUrl: artwork(node),
    sourceUrl: `https://music.youtube.com/${kind === 'track' ? `watch?v=${id}` : kind === 'artist' ? `channel/${id}` : `browse/${id}`}`,
    album: text(object(node.album).name) || undefined,
    artistId: isCatalogId('artist', artistId) ? artistId : undefined,
    albumId: isCatalogId('album', albumId) ? albumId : undefined,
    durationSeconds:
      typeof duration === 'number' && Number.isFinite(duration) && duration > 0
        ? duration
        : undefined,
    year: /^\d{4}$/.test(text(node.year)) ? text(node.year) : undefined,
    audioUrl: kind === 'track' ? `/api/audio/${id}` : undefined,
    playback: {
      available: kind === 'track',
      reason: kind === 'track' ? undefined : 'catalog-only',
    },
  };
}

function mixedItems(nodes: unknown[]): CatalogItem[] {
  const items = nodes
    .map((raw) => {
      const node = object(raw);
      const kind =
        node.item_type === 'artist'
          ? 'artist'
          : node.item_type === 'album'
            ? 'album'
            : node.item_type === 'song' ||
                node.item_type === 'video' ||
                node.video_id
              ? 'track'
              : undefined;
      return kind ? normalize(raw, kind) : undefined;
    })
    .filter((item): item is CatalogItem => !!item);
  return [
    ...new Map(items.map((item) => [`${item.kind}:${item.id}`, item])).values(),
  ];
}

/** MusicProvider with catalog capability and zero authorized playable tracks. */
export class YouTubeCatalogProvider implements MusicProvider, CatalogProvider {
  readonly id = 'youtube';
  readonly catalog = this;
  constructor(
    private gateway: MusicMetadataGateway = new YouTubeMusicGateway(),
  ) {}
  async listTracks() {
    return [];
  }
  async getTrack() {
    return undefined;
  }
  async home(signal: AbortSignal): Promise<FeedSection[]> {
    const response = object(await this.gateway.home?.(signal));
    signal.throwIfAborted();
    const sections = array(response.sections)
      .map((raw, index) => {
        const shelf = object(raw);
        const header = object(shelf.header);
        return {
          id: `discovery-${index}`,
          title:
            text(shelf.title ?? header.title)
              .replace(/^Quick picks$/, 'Scelte veloci')
              .replace(/^Trending songs for you$/, 'Di tendenza per te') ||
            'Da scoprire',
          items: mixedItems(array(shelf.contents)).slice(0, 20),
        };
      })
      .filter((section) => section.items.length > 0)
      .slice(0, 12);
    const tracks = sections
      .flatMap((section) => section.items)
      .filter((item) => item.kind === 'track');
    for (const kind of ['artist', 'album'] as const) {
      if (
        sections.some((section) =>
          section.items.some((item) => item.kind === kind),
        )
      )
        continue;
      const references = tracks.flatMap((track): CatalogItem[] => {
        const id = kind === 'artist' ? track.artistId : track.albumId;
        const title = kind === 'artist' ? track.artist : track.album;
        return id && title
          ? [
              {
                id,
                title,
                provider: 'youtube',
                kind,
                artist: track.artist,
                artworkUrl: kind === 'album' ? track.artworkUrl : undefined,
                sourceUrl: `https://music.youtube.com/${kind === 'artist' ? 'channel' : 'browse'}/${id}`,
                playback: { available: false },
              },
            ]
          : [];
      });
      const items = [
        ...new Map(references.map((item) => [item.id, item])).values(),
      ].slice(0, 12);
      if (items.length)
        sections.push({
          id: `discover-${kind}`,
          title:
            kind === 'artist' ? 'Artisti da scoprire' : 'Album da esplorare',
          items,
        });
    }
    // Track-derived artist references have no portrait. Resolve the artist page
    // instead of reusing a song thumbnail as an artist photograph.
    const missing = [
      ...new Map(
        sections
          .flatMap((s) => s.items)
          .filter((i) => i.kind === 'artist' && !i.artworkUrl)
          .map((i) => [i.id, i]),
      ).values(),
    ].slice(0, 8);
    const portraitSignal = AbortSignal.any([signal, AbortSignal.timeout(2500)]);
    for (
      let start = 0;
      start < missing.length && !portraitSignal.aborted;
      start += 2
    ) {
      await Promise.all(
        missing.slice(start, start + 2).map(async (artist) => {
          try {
            const detail = await this.details(
              'artist',
              artist.id,
              portraitSignal,
            );
            if (detail?.artworkUrl)
              for (const section of sections)
                for (const item of section.items)
                  if (item.kind === 'artist' && item.id === artist.id)
                    item.artworkUrl = detail.artworkUrl;
          } catch {
            /* Keep discovery usable when one portrait is unavailable. */
          }
        }),
      );
    }
    return sections;
  }
  async recommendations(
    id: string,
    signal: AbortSignal,
  ): Promise<CatalogItem[]> {
    const response = object(await this.gateway.recommendations?.(id, signal));
    signal.throwIfAborted();
    return mixedItems(array(response.contents))
      .filter((item) => item.kind === 'track' && item.id !== id)
      .slice(0, 25);
  }

  async search(
    query: CatalogQuery,
    signal: AbortSignal,
  ): Promise<CatalogItem[]> {
    const response = object(await this.gateway.search(query, signal));
    signal.throwIfAborted();
    // Do not depend on localized shelf titles (Songs/Brani/etc.).
    const nodes = array(response.contents).flatMap((shelf) =>
      array(object(shelf).contents),
    );
    const expected = query.type === 'track' ? 'song' : query.type;
    const items = nodes
      .filter((node) => object(node).item_type === expected)
      .map((node) => normalize(node, query.type))
      .filter((item): item is CatalogItem => !!item);
    return [...new Map(items.map((item) => [item.id, item])).values()].slice(
      0,
      query.limit,
    );
  }

  async details(
    kind: CatalogKind,
    id: string,
    signal: AbortSignal,
  ): Promise<CatalogDetail | undefined> {
    const raw = await this.gateway.details(kind, id, signal);
    signal.throwIfAborted();
    const response = object(raw);
    const header = kind === 'track' ? response : object(response.header);
    const item = normalize(header, kind, id);
    if (!item) return undefined;
    const artistItems =
      kind === 'artist'
        ? mixedItems(
            array(response.sections).flatMap((shelf) =>
              array(object(shelf).contents),
            ),
          )
        : [];
    return {
      ...item,
      albums:
        kind === 'artist'
          ? artistItems.filter((entry) => entry.kind === 'album')
          : undefined,
      relatedArtists:
        kind === 'artist'
          ? artistItems.filter(
              (entry) => entry.kind === 'artist' && entry.id !== id,
            )
          : undefined,
      tracks:
        kind === 'album'
          ? array(response.contents)
              .slice(0, 100)
              .map((node) => normalize(node, 'track'))
              .filter((track): track is CatalogItem => !!track)
              .map((track) => ({
                ...track,
                artist:
                  track.artist === UNKNOWN_ARTIST ? item.artist : track.artist,
                artistId:
                  track.artistId ??
                  (track.artist === UNKNOWN_ARTIST ? item.artistId : undefined),
                album: item.title,
                albumId: item.id,
                artworkUrl: item.artworkUrl || track.artworkUrl,
              }))
          : kind === 'artist'
            ? artistItems.filter((entry) => entry.kind === 'track')
            : undefined,
    };
  }
}
