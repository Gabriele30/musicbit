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
  listTracks(): Promise<Track[]>;
  getTrack(id: string): Promise<Track | undefined>;
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
