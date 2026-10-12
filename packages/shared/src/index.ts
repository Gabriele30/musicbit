import type { PlaybackMime } from './playback.js';
export * from './playback.js';
export * from './audio-cache.js';

export type AudioMimeType = PlaybackMime;

/** An authorized, directly playable source. URLs are resolved by the provider. */
export interface Track {
  id: string;
  title: string;
  artist: string;
  album: string;
  audioUrl: string;
  artworkUrl: string;
  mimeType: AudioMimeType;
  sourceUrl: string;
  permission: string;
  attribution: string;
  durationSeconds?: number;
  artistId?: string;
  albumId?: string;
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
  audioUrl?: string;
  artistId?: string;
  albumId?: string;
  playback: { available: boolean; reason?: string };
}
export interface CatalogDetail extends CatalogItem {
  description?: string;
  /** Album tracks or the artist's most popular tracks. */
  tracks?: CatalogItem[];
  albums?: CatalogItem[];
  relatedArtists?: CatalogItem[];
}
export interface FeedSection {
  id: string;
  title: string;
  items: CatalogItem[];
}
export interface FeedResponse {
  sections: FeedSection[];
  timing: CatalogTiming;
}
export interface RecommendationsResponse {
  seedId: string;
  items: CatalogItem[];
  timing: CatalogTiming;
}
export interface CatalogQuery {
  q: string;
  type: CatalogKind;
  limit: number;
}
export interface CatalogProvider {
  readonly id: string;
  home?(signal: AbortSignal): Promise<FeedSection[]>;
  recommendations?(id: string, signal: AbortSignal): Promise<CatalogItem[]>;
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

/** Helper to transform a catalog item into a playable Track */
export function catalogItemToTrack(item: CatalogItem): Track {
  return {
    id: item.id,
    title: item.title,
    artist: item.artist,
    album: item.album || 'Singolo',
    audioUrl: item.audioUrl || `/api/audio/${encodeURIComponent(item.id)}`,
    artworkUrl: item.artworkUrl || '/icons/icon-192.png',
    mimeType: 'audio/mp4',
    sourceUrl: item.sourceUrl,
    permission: 'YouTube Music playback',
    attribution: `${item.artist} · YouTube Music`,
    durationSeconds: item.durationSeconds,
    artistId: item.artistId,
    albumId: item.albumId,
  };
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
    (item.artistId === undefined ||
      (typeof item.artistId === 'string' &&
        isCatalogId('artist', item.artistId))) &&
    (item.albumId === undefined ||
      (typeof item.albumId === 'string' &&
        isCatalogId('album', item.albumId))) &&
    (item.album === undefined || typeof item.album === 'string') &&
    (item.year === undefined || typeof item.year === 'string') &&
    (item.durationSeconds === undefined ||
      (typeof item.durationSeconds === 'number' &&
        Number.isFinite(item.durationSeconds) &&
        item.durationSeconds > 0)) &&
    typeof item.sourceUrl === 'string' &&
    /^https:\/\/music\.youtube\.com\//.test(item.sourceUrl) &&
    (item.artworkUrl === undefined ||
      (typeof item.artworkUrl === 'string' &&
        isCatalogArtwork(item.artworkUrl))) &&
    typeof playback?.available === 'boolean' &&
    (item.audioUrl === undefined ||
      (typeof item.audioUrl === 'string' && isAudioUrl(item.audioUrl)))
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
        typeof item.mimeType === 'string' &&
        item.mimeType.startsWith('audio/') &&
        (item.durationSeconds === undefined ||
          (typeof item.durationSeconds === 'number' &&
            Number.isFinite(item.durationSeconds) &&
            item.durationSeconds > 0)) &&
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
export * from './youtube-playback.js';
export * from './library.js';
export * from './recommendations.js';
export * from './experience.js';
