import {
  isCatalogItem,
  isTracksResponse,
  type CatalogItem,
  type Track,
} from './index.js';

export interface Playlist {
  id: string;
  name: string;
  tracks: Track[];
  updatedAt: number;
}
export interface HistoryEntry {
  track: Track;
  playedAt: number;
}
export interface ListeningSignal {
  id: string;
  completed: number;
  skipped: number;
}
export interface ListeningTaste {
  novelty: 'balanced' | 'familiar' | 'discovery';
  dismissed: string[];
  signals: ListeningSignal[];
  artistPreferences?: {
    artist: string;
    preference: 'more' | 'less' | 'blocked';
  }[];
  excludedFromTaste?: string[];
}
export interface LocalLibrary {
  version: 1;
  favorites: Track[];
  playlists: Playlist[];
  history: HistoryEntry[];
  savedAlbums: CatalogItem[];
  followedArtists: CatalogItem[];
  taste?: ListeningTaste;
}
export interface AccountProfile {
  id: string;
  username: string;
  displayName: string;
  color: string;
  createdAt: number;
}
export interface LibraryEnvelope {
  revision: number;
  library: LocalLibrary;
  updatedAt: number;
}
export const emptyLibrary = (): LocalLibrary => ({
  version: 1,
  favorites: [],
  playlists: [],
  history: [],
  savedAlbums: [],
  followedArtists: [],
});
export const emptyTaste = (): ListeningTaste => ({
  novelty: 'balanced',
  dismissed: [],
  signals: [],
});
const text = (value: unknown, max: number): value is string =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= max &&
  [...value].every((character) => character.charCodeAt(0) >= 32);
const tracks = (value: unknown): value is Track[] =>
  Array.isArray(value) &&
  value.length <= 1000 &&
  isTracksResponse({ provider: 'library', tracks: value }) &&
  value.every((t) =>
    [
      t.id,
      t.title,
      t.artist,
      t.album,
      t.audioUrl,
      t.artworkUrl,
      t.sourceUrl,
      t.permission,
      t.attribution,
    ].every((v) => typeof v === 'string' && v.length <= 4096),
  );
const unique = (items: { id: string }[]) =>
  new Set(items.map((i) => i.id)).size === items.length;
/** Both backup files and authenticated writes use the same bounded contract. */
export function isLocalLibrary(value: unknown): value is LocalLibrary {
  if (!value || typeof value !== 'object') return false;
  const v = value as LocalLibrary;
  if (JSON.stringify(value).length > 4_900_000) return false;
  return (
    v.version === 1 &&
    tracks(v.favorites) &&
    Array.isArray(v.playlists) &&
    v.playlists.length <= 100 &&
    v.playlists.every(
      (p) =>
        p &&
        text(p.id, 100) &&
        text(p.name, 80) &&
        Number.isFinite(p.updatedAt) &&
        tracks(p.tracks),
    ) &&
    unique(v.playlists) &&
    Array.isArray(v.history) &&
    v.history.length <= 100 &&
    v.history.every(
      (h) => h && tracks([h.track]) && Number.isFinite(h.playedAt),
    ) &&
    Array.isArray(v.savedAlbums) &&
    v.savedAlbums.length <= 200 &&
    v.savedAlbums.every((i) => isCatalogItem(i) && i.kind === 'album') &&
    unique(v.savedAlbums) &&
    Array.isArray(v.followedArtists) &&
    v.followedArtists.length <= 200 &&
    v.followedArtists.every((i) => isCatalogItem(i) && i.kind === 'artist') &&
    unique(v.followedArtists) &&
    (v.taste === undefined ||
      (v.taste &&
        ['balanced', 'familiar', 'discovery'].includes(v.taste.novelty) &&
        Array.isArray(v.taste.dismissed) &&
        v.taste.dismissed.length <= 500 &&
        v.taste.dismissed.every((id) => text(id, 100)) &&
        Array.isArray(v.taste.signals) &&
        v.taste.signals.length <= 500 &&
        v.taste.signals.every(
          (s) =>
            s &&
            text(s.id, 100) &&
            Number.isSafeInteger(s.completed) &&
            s.completed >= 0 &&
            s.completed <= 1000000 &&
            Number.isSafeInteger(s.skipped) &&
            s.skipped >= 0 &&
            s.skipped <= 1000000,
        ) &&
        (v.taste.artistPreferences === undefined ||
          (Array.isArray(v.taste.artistPreferences) &&
            v.taste.artistPreferences.length <= 200 &&
            v.taste.artistPreferences.every(
              (p) =>
                p &&
                text(p.artist, 200) &&
                ['more', 'less', 'blocked'].includes(p.preference),
            ))) &&
        (v.taste.excludedFromTaste === undefined ||
          (Array.isArray(v.taste.excludedFromTaste) &&
            v.taste.excludedFromTaste.length <= 500 &&
            v.taste.excludedFromTaste.every((id) => text(id, 100))))))
  );
}
/** Drop unknown fields rather than persisting arbitrary credentials in backups. */
export function cleanLibrary(v: LocalLibrary): LocalLibrary {
  const track = (t: Track): Track => ({
    id: t.id,
    title: t.title,
    artist: t.artist,
    album: t.album,
    audioUrl: t.audioUrl,
    artworkUrl: t.artworkUrl,
    mimeType: t.mimeType,
    sourceUrl: t.sourceUrl,
    permission: t.permission,
    attribution: t.attribution,
    ...(t.durationSeconds === undefined
      ? {}
      : { durationSeconds: t.durationSeconds }),
    ...(t.artistId ? { artistId: t.artistId } : {}),
    ...(t.albumId ? { albumId: t.albumId } : {}),
  });
  const item = (i: CatalogItem): CatalogItem => ({
    id: i.id,
    provider: i.provider,
    kind: i.kind,
    title: i.title,
    artist: i.artist,
    sourceUrl: i.sourceUrl,
    playback: { available: i.playback.available },
    ...(i.artworkUrl ? { artworkUrl: i.artworkUrl } : {}),
    ...(i.album ? { album: i.album } : {}),
    ...(i.year ? { year: i.year } : {}),
    ...(i.audioUrl ? { audioUrl: i.audioUrl } : {}),
    ...(i.durationSeconds === undefined
      ? {}
      : { durationSeconds: i.durationSeconds }),
    ...(i.artistId ? { artistId: i.artistId } : {}),
    ...(i.albumId ? { albumId: i.albumId } : {}),
  });
  return {
    version: 1,
    favorites: v.favorites.map(track),
    playlists: v.playlists.map((p) => ({
      id: p.id,
      name: p.name,
      tracks: p.tracks.map(track),
      updatedAt: p.updatedAt,
    })),
    history: v.history.map((h) => ({
      track: track(h.track),
      playedAt: h.playedAt,
    })),
    savedAlbums: v.savedAlbums.map(item),
    followedArtists: v.followedArtists.map(item),
    ...(v.taste
      ? {
          taste: {
            novelty: v.taste.novelty,
            dismissed: [...v.taste.dismissed],
            signals: v.taste.signals.map((s) => ({
              id: s.id,
              completed: s.completed,
              skipped: s.skipped,
            })),
            ...(v.taste.artistPreferences
              ? {
                  artistPreferences: v.taste.artistPreferences.map((p) => ({
                    artist: p.artist,
                    preference: p.preference,
                  })),
                }
              : {}),
            ...(v.taste.excludedFromTaste
              ? { excludedFromTaste: [...v.taste.excludedFromTaste] }
              : {}),
          },
        }
      : {}),
  };
}
