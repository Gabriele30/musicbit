/** An authorized, directly playable source. URLs are resolved by the provider. */
export interface Track {
  id: string;
  title: string;
  artist: string;
  album: string;
  audioUrl: string;
  artworkUrl: string;
  mimeType: 'audio/mpeg';
  sourceUrl: string;
  permission: string;
  attribution: string;
}

export interface TracksResponse {
  tracks: Track[];
  provider: string;
}
export interface HealthResponse {
  status: 'ok';
  service: 'musicbit-api';
  version: string;
}

/** Implement in the API to add authorized libraries without coupling the player. */
export interface MusicProvider {
  readonly id: string;
  /** Optional metadata-only capability. Never pass CatalogItem to the player. */
  readonly catalog?: CatalogProvider;
  listTracks(): Promise<Track[]>;
  getTrack(id: string): Promise<Track | undefined>;
}

export type CatalogKind = 'track' | 'artist' | 'album';
export interface CatalogItem {
  id: string;
  provider: string;
  kind: CatalogKind;
  title: string;
  artist: string;
  artworkUrl?: string;
  sourceUrl: string;
  album?: string;
  durationSeconds?: number;
  year?: string;
  /** Catalog metadata does not confer permission to play the source. */
  playback: { available: false; reason: 'catalog-only' };
}
export interface CatalogDetail extends CatalogItem {
  description?: string;
  /** Album track listing, metadata only. No recommendations. */
  tracks?: CatalogItem[];
}
export interface CatalogQuery {
  q: string;
  type: CatalogKind;
  limit: number;
}
export interface CatalogProvider {
  readonly id: string;
  search(query: CatalogQuery, signal: AbortSignal): Promise<CatalogItem[]>;
  details(
    kind: CatalogKind,
    id: string,
    signal: AbortSignal,
  ): Promise<CatalogDetail | undefined>;
}
export interface CatalogTiming {
  cache: 'hit' | 'miss' | 'shared';
  elapsedMs: number;
}
export interface SearchResponse {
  provider: string;
  type: CatalogKind;
  items: CatalogItem[];
  timing: CatalogTiming;
}
export interface DetailResponse {
  item: CatalogDetail;
  timing: CatalogTiming;
}
export interface ProviderStatus {
  id: string;
  name: string;
  capabilities: ('playback' | 'catalog')[];
  state: 'available' | 'unverified' | 'degraded' | 'disabled';
  lastCheckedAt?: string;
  lastErrorCode?: string;
}
export interface ProvidersResponse {
  providers: ProviderStatus[];
}
export interface CatalogErrorResponse {
  error: string;
  code: string;
}

/** Shared validation for routing, cache keys and callers. */
export function isCatalogKind(value: unknown): value is CatalogKind {
  return value === 'track' || value === 'artist' || value === 'album';
}
export function isCatalogId(kind: CatalogKind, value: string): boolean {
  if (kind === 'track') return /^[A-Za-z0-9_-]{11}$/.test(value);
  if (kind === 'artist') return /^UC[A-Za-z0-9_-]{22}$/.test(value);
  return /^MPR[A-Za-z0-9_-]{1,125}$/.test(value);
}

/** Do not trust a network response merely because it has a TypeScript type. */
export function isCatalogItem(value: unknown): value is CatalogItem {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  const playback = item.playback as Record<string, unknown> | undefined;
  return (
    isCatalogKind(item.kind) &&
    typeof item.id === 'string' &&
    isCatalogId(item.kind, item.id) &&
    item.provider === 'youtube' &&
    typeof item.title === 'string' &&
    item.title.length > 0 &&
    typeof item.artist === 'string' &&
    typeof item.sourceUrl === 'string' &&
    /^https:\/\/music\.youtube\.com\//.test(item.sourceUrl) &&
    (item.artworkUrl === undefined ||
      (typeof item.artworkUrl === 'string' &&
        isCatalogArtwork(item.artworkUrl))) &&
    playback?.available === false &&
    playback.reason === 'catalog-only' &&
    !('audioUrl' in item)
  );
}
export function isCatalogArtwork(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      ['ytimg.com', 'ggpht.com', 'googleusercontent.com'].some(
        (host) => url.hostname === host || url.hostname.endsWith(`.${host}`),
      )
    );
  } catch {
    return false;
  }
}

const fields = [
  'id',
  'title',
  'artist',
  'album',
  'audioUrl',
  'artworkUrl',
  'sourceUrl',
  'permission',
  'attribution',
] as const;

/** Fail clearly on an invalid catalog instead of passing unchecked JSON to audio. */
export function isTracksResponse(value: unknown): value is TracksResponse {
  if (!value || typeof value !== 'object') return false;
  const data = value as Partial<TracksResponse>;
  return (
    typeof data.provider === 'string' &&
    Array.isArray(data.tracks) &&
    data.tracks.every((track: unknown) => {
      if (!track || typeof track !== 'object') return false;
      const item = track as Record<string, unknown>;
      return (
        fields.every(
          (field) => typeof item[field] === 'string' && item[field].length > 0,
        ) &&
        item.mimeType === 'audio/mpeg' &&
        isAudioUrl(String(item.audioUrl))
      );
    }) &&
    new Set(data.tracks.map((track) => track.id)).size === data.tracks.length
  );
}

/** Public HTTPS source or a path on the app's own origin (future local libraries). */
function isAudioUrl(value: string): boolean {
  if (/^\/(?!\/)/.test(value) && !value.includes('\\')) return true;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch {
    return false;
  }
}
