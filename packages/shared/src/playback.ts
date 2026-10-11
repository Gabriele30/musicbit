/** Catalog identity, never a URL supplied by a browser or a fuzzy title match. */
export interface PlaybackReference {
  catalogProvider: string;
  catalogId: string;
}
export type PlaybackMime =
  | 'audio/mpeg'
  | 'audio/mp4'
  | 'audio/webm'
  | 'audio/aac'
  | 'audio/wav'
  | 'application/vnd.apple.mpegurl';
export interface PlaybackSource {
  provider: string;
  reference: PlaybackReference;
  url: string;
  mimeType: PlaybackMime;
  delivery: 'progressive' | 'hls';
  title: string;
  artist: string;
  durationSeconds?: number;
  /** ISO timestamp. null means publisher has not declared expiry, not perpetual availability. */
  validUntil: string | null;
  authorization: { sourceUrl: string; permission: string; attribution: string };
}
export type PlaybackFailureCode =
  | 'TIMEOUT'
  | 'CANCELLED'
  | 'PROVIDER_UNAVAILABLE'
  | 'INVALID_SOURCE'
  | 'BUSY';
export type PlaybackResolution =
  | { status: 'available'; source: PlaybackSource }
  | {
      status: 'unavailable';
      code: 'NO_AUTHORIZED_SOURCE' | 'NOT_FOUND' | 'UNSUPPORTED_FORMAT';
    }
  | { status: 'error'; code: PlaybackFailureCode; retryable: boolean };
/** Independent from CatalogProvider. Resolves authorization and transport, never plays audio. */
export interface PlaybackProvider {
  readonly id: string;
  resolve(
    reference: PlaybackReference,
    signal: AbortSignal,
  ): Promise<PlaybackResolution>;
}
export interface PlaybackResolveResponse {
  resolution: PlaybackResolution;
  timing: { cache: 'hit' | 'miss' | 'shared'; elapsedMs: number };
}
export interface PlaybackCandidate {
  reference: PlaybackReference;
  title: string;
  artist: string;
  sourceUrl: string;
}

export function isPlaybackSource(value: unknown): value is PlaybackSource {
  if (!value || typeof value !== 'object') return false;
  const source = value as Partial<PlaybackSource>;
  const auth = source.authorization;
  return (
    typeof source.provider === 'string' &&
    !!source.provider &&
    typeof source.reference?.catalogProvider === 'string' &&
    !!source.reference.catalogProvider &&
    typeof source.reference.catalogId === 'string' &&
    !!source.reference.catalogId &&
    typeof source.title === 'string' &&
    !!source.title &&
    typeof source.artist === 'string' &&
    typeof source.url === 'string' &&
    publicUrl(source.url) &&
    ((source.delivery === 'progressive' &&
      ['audio/mpeg', 'audio/mp4', 'audio/wav'].includes(
        source.mimeType ?? '',
      )) ||
      (source.delivery === 'hls' &&
        source.mimeType === 'application/vnd.apple.mpegurl')) &&
    (source.validUntil === null ||
      (typeof source.validUntil === 'string' &&
        Number.isFinite(Date.parse(source.validUntil)))) &&
    (source.durationSeconds === undefined ||
      (Number.isFinite(source.durationSeconds) &&
        source.durationSeconds >= 0)) &&
    !!auth &&
    typeof auth.sourceUrl === 'string' &&
    publicUrl(auth.sourceUrl) &&
    typeof auth.permission === 'string' &&
    !!auth.permission &&
    typeof auth.attribution === 'string' &&
    !!auth.attribution
  );
}
function publicUrl(value: string) {
  if (
    [...value].some(
      (character) => character.charCodeAt(0) <= 32 || character === '\\',
    )
  )
    return false;
  if (/^\/(?!\/)/.test(value)) return true;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch {
    return false;
  }
}
export function isSourceFresh(
  source: PlaybackSource,
  now = Date.now(),
  marginMs = 5000,
): boolean {
  return (
    source.validUntil === null || Date.parse(source.validUntil) > now + marginMs
  );
}
