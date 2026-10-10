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
} from '@musicbit/shared';

/** Narrow seam for deterministic tests; deliberately excludes all media methods. */
export interface MusicMetadataGateway {
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
        'Artista non indicato';
  const duration = object(node.duration).seconds;
  return {
    id,
    provider: 'youtube',
    kind,
    title,
    artist,
    artworkUrl: artwork(node),
    sourceUrl: `https://music.youtube.com/${kind === 'track' ? `watch?v=${id}` : kind === 'artist' ? `channel/${id}` : `browse/${id}`}`,
    album: text(object(node.album).name) || undefined,
    durationSeconds:
      typeof duration === 'number' && Number.isFinite(duration) && duration >= 0
        ? duration
        : undefined,
    year: /^\d{4}$/.test(text(node.year)) ? text(node.year) : undefined,
    playback: { available: false, reason: 'catalog-only' },
  };
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
    return {
      ...item,
      // Artist biographies/lyrics may carry additional rights: omit these in M3.
      tracks:
        kind === 'album'
          ? array(response.contents)
              .slice(0, 100)
              .map((node) => normalize(node, 'track'))
              .filter((track): track is CatalogItem => !!track)
          : undefined,
    };
  }
}
