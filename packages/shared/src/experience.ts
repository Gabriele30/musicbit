import { isLocalLibrary, emptyLibrary } from './library.js';
import type { Track } from './index.js';
export const PLAYBACK_QUEUE_LIMIT = 1000;

export interface PlaybackSnapshot {
  queue: Track[];
  index: number;
  position: number;
  repeat: 'off' | 'all' | 'one';
  autoplay?: boolean;
}
export interface PlaybackEnvelope {
  revision: number;
  session: PlaybackSnapshot | null;
  deviceId: string;
  updatedAt: number;
}
export function isPlaybackSnapshot(v: unknown): v is PlaybackSnapshot {
  if (!v || typeof v !== 'object') return false;
  const s = v as PlaybackSnapshot;
  return (
    Array.isArray(s.queue) &&
    s.queue.length > 0 &&
    s.queue.length <= PLAYBACK_QUEUE_LIMIT &&
    JSON.stringify(s).length <= 4900000 &&
    isLocalLibrary({
      ...emptyLibrary(),
      favorites: [...new Map(s.queue.map((t) => [t?.id, t])).values()],
    }) &&
    Number.isInteger(s.index) &&
    s.index >= 0 &&
    s.index < s.queue.length &&
    Number.isFinite(s.position) &&
    s.position >= 0 &&
    s.position <= 86400 &&
    ['off', 'all', 'one'].includes(s.repeat) &&
    (s.autoplay === undefined || typeof s.autoplay === 'boolean')
  );
}
export interface ListeningEvent {
  id: string;
  track: Track;
  at: number;
  seconds: number;
  starts: 0 | 1;
  completed: boolean;
}
export function isListeningEvent(v: unknown): v is ListeningEvent {
  if (!v || typeof v !== 'object') return false;
  const e = v as ListeningEvent;
  return (
    typeof e.id === 'string' &&
    /^[a-zA-Z0-9_-]{8,100}$/.test(e.id) &&
    Number.isSafeInteger(e.at) &&
    e.at >= 0 &&
    Number.isFinite(e.seconds) &&
    e.seconds >= 0 &&
    e.seconds <= 60 &&
    (e.starts === 0 || e.starts === 1) &&
    typeof e.completed === 'boolean' &&
    isLocalLibrary({ ...emptyLibrary(), favorites: [e.track] })
  );
}
export interface ListeningAggregate {
  day: string;
  track: Track;
  seconds: number;
  plays: number;
  completed: number;
}
export interface ListeningStats {
  from: string;
  to: string;
  seconds: number;
  plays: number;
  activeDays: number;
  distinctTracks: number;
  distinctArtists: number;
  topTracks: { track: Track; seconds: number; plays: number }[];
  topArtists: { artist: string; seconds: number; plays: number }[];
  months: { month: string; seconds: number }[];
}
export function isListeningAggregate(v: unknown): v is ListeningAggregate {
  if (!v || typeof v !== 'object') return false;
  const row = v as ListeningAggregate;
  return (
    typeof row.day === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(row.day) &&
    Number.isFinite(row.seconds) &&
    row.seconds >= 0 &&
    Number.isSafeInteger(row.plays) &&
    row.plays >= 0 &&
    Number.isSafeInteger(row.completed) &&
    row.completed >= 0 &&
    isLocalLibrary({ ...emptyLibrary(), favorites: [row.track] })
  );
}
export function summarizeListening(
  rows: ListeningAggregate[],
  from: string,
  to: string,
): ListeningStats {
  const tracks = new Map<string, ListeningStats['topTracks'][number]>();
  const artists = new Map<string, ListeningStats['topArtists'][number]>();
  const months = new Map<string, number>();
  const days = new Set<string>();
  let seconds = 0,
    plays = 0;
  for (const row of rows) {
    if (row.day < from || row.day > to) continue;
    seconds += row.seconds;
    plays += row.plays;
    if (row.seconds > 0) days.add(row.day);
    const track = tracks.get(row.track.id) ?? {
      track: row.track,
      seconds: 0,
      plays: 0,
    };
    track.seconds += row.seconds;
    track.plays += row.plays;
    tracks.set(row.track.id, track);
    const key = row.track.artist.trim().toLocaleLowerCase();
    const artist = artists.get(key) ?? {
      artist: row.track.artist,
      seconds: 0,
      plays: 0,
    };
    artist.seconds += row.seconds;
    artist.plays += row.plays;
    artists.set(key, artist);
    const month = row.day.slice(0, 7);
    months.set(month, (months.get(month) ?? 0) + row.seconds);
  }
  const topTracks = [...tracks.values()]
    .filter((t) => t.seconds > 0)
    .sort((a, b) => b.seconds - a.seconds || b.plays - a.plays);
  const topArtists = [...artists.values()]
    .filter((a) => a.seconds > 0)
    .sort((a, b) => b.seconds - a.seconds || b.plays - a.plays);
  return {
    from,
    to,
    seconds,
    plays,
    activeDays: days.size,
    distinctTracks: topTracks.length,
    distinctArtists: topArtists.length,
    topTracks: topTracks.slice(0, 20),
    topArtists: topArtists.slice(0, 20),
    months: [...months]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, seconds]) => ({ month, seconds })),
  };
}
export interface GeneratedPlaylist {
  name: string;
  description: string;
  tracks: Track[];
  unmatched: { title: string; artist: string }[];
}
