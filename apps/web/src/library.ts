import { useCallback, useEffect, useState } from 'react';
import {
  isCatalogItem,
  isTracksResponse,
  type CatalogItem,
  type Track,
} from '@musicbit/shared';

export const FAVORITES_KEY = 'musicbit.favorites.v1';
export const LIBRARY_KEY = 'musicbit.library.v1';
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
export interface LocalLibrary {
  version: 1;
  favorites: Track[];
  playlists: Playlist[];
  history: HistoryEntry[];
  savedAlbums: CatalogItem[];
  followedArtists: CatalogItem[];
}
const empty = (): LocalLibrary => ({
  version: 1,
  favorites: [],
  playlists: [],
  history: [],
  savedAlbums: [],
  followedArtists: [],
});
const validTracks = (tracks: unknown): tracks is Track[] =>
  Array.isArray(tracks) &&
  tracks.length <= 1000 &&
  isTracksResponse({ provider: 'library', tracks });
export function readFavorites(): Track[] {
  try {
    const raw = localStorage.getItem(FAVORITES_KEY);
    if (!raw || raw.length > 2_000_000) return [];
    const data = JSON.parse(raw) as { version?: number; tracks?: unknown };
    return data?.version === 1 && validTracks(data.tracks) ? data.tracks : [];
  } catch {
    return [];
  }
}
export function readLibrary(): LocalLibrary {
  const fallback = { ...empty(), favorites: readFavorites() };
  try {
    const raw = localStorage.getItem(LIBRARY_KEY);
    if (!raw || raw.length > 5_000_000) return fallback;
    const data = JSON.parse(raw) as LocalLibrary;
    if (
      data?.version !== 1 ||
      !validTracks(data.favorites) ||
      !Array.isArray(data.playlists) ||
      data.playlists.length > 100 ||
      !data.playlists.every(
        (list) =>
          list &&
          typeof list.id === 'string' &&
          typeof list.name === 'string' &&
          list.name.length > 0 &&
          list.name.length <= 80 &&
          Number.isFinite(list.updatedAt) &&
          validTracks(list.tracks),
      ) ||
      new Set(data.playlists.map((list) => list.id)).size !==
        data.playlists.length ||
      !Array.isArray(data.history) ||
      data.history.length > 100 ||
      !data.history.every(
        (entry) =>
          entry &&
          validTracks([entry.track]) &&
          Number.isFinite(entry.playedAt),
      ) ||
      !Array.isArray(data.savedAlbums) ||
      data.savedAlbums.length > 200 ||
      !data.savedAlbums.every(
        (item) => isCatalogItem(item) && item.kind === 'album',
      ) ||
      !Array.isArray(data.followedArtists) ||
      data.followedArtists.length > 200 ||
      !data.followedArtists.every(
        (item) => isCatalogItem(item) && item.kind === 'artist',
      )
    )
      return fallback;
    return {
      version: 1,
      favorites: data.favorites,
      playlists: data.playlists,
      history: data.history,
      savedAlbums: data.savedAlbums,
      followedArtists: data.followedArtists,
    };
  } catch {
    return fallback;
  }
}
export function useLibrary() {
  const [library, setLibrary] = useState(readLibrary);
  const [storageError, setStorageError] = useState('');
  useEffect(() => {
    try {
      localStorage.setItem(LIBRARY_KEY, JSON.stringify(library));
      localStorage.setItem(
        FAVORITES_KEY,
        JSON.stringify({ version: 1, tracks: library.favorites }),
      );
      setStorageError('');
    } catch {
      setStorageError(
        'Impossibile salvare la libreria su questo dispositivo. Verifica lo spazio o le impostazioni del browser.',
      );
    }
  }, [library]);
  const toggleFavorite = useCallback((track: Track) => {
    setLibrary((current) => ({
      ...current,
      favorites: current.favorites.some((item) => item.id === track.id)
        ? current.favorites.filter((item) => item.id !== track.id)
        : [track, ...current.favorites].slice(0, 1000),
    }));
  }, []);
  const recordHistory = useCallback((track: Track) => {
    setLibrary((current) => ({
      ...current,
      history: [
        { track, playedAt: Date.now() },
        ...current.history.filter((entry) => entry.track.id !== track.id),
      ].slice(0, 100),
    }));
  }, []);
  const clearHistory = () =>
    setLibrary((current) => ({ ...current, history: [] }));
  const createPlaylist = (name: string, tracks: Track[] = []) => {
    if (!name.trim() || library.playlists.length >= 100) return undefined;
    const id = crypto.randomUUID();
    const unique = [
      ...new Map(tracks.map((track) => [track.id, track])).values(),
    ];
    if (unique.length > 1000) return undefined;
    setLibrary((current) => ({
      ...current,
      playlists: [
        {
          id,
          name: name.trim().slice(0, 80),
          tracks: unique,
          updatedAt: Date.now(),
        },
        ...current.playlists,
      ],
    }));
    return id;
  };
  const editPlaylist = (id: string, edit: (list: Playlist) => Playlist) =>
    setLibrary((current) => ({
      ...current,
      playlists: current.playlists.map((list) =>
        list.id === id ? { ...edit(list), updatedAt: Date.now() } : list,
      ),
    }));
  const renamePlaylist = (id: string, name: string) => {
    if (name.trim())
      editPlaylist(id, (list) => ({ ...list, name: name.trim().slice(0, 80) }));
  };
  const deletePlaylist = (id: string) =>
    setLibrary((current) => ({
      ...current,
      playlists: current.playlists.filter((list) => list.id !== id),
    }));
  const addToPlaylist = (id: string, tracks: Track[]) => {
    const list = library.playlists.find((item) => item.id === id);
    if (
      !list ||
      new Set([...list.tracks, ...tracks].map((track) => track.id)).size > 1000
    )
      return false;
    editPlaylist(id, (list) => ({
      ...list,
      tracks: [
        ...new Map(
          [...list.tracks, ...tracks].map((track) => [track.id, track]),
        ).values(),
      ],
    }));
    return true;
  };
  const removeFromPlaylist = (id: string, trackId: string) =>
    editPlaylist(id, (list) => ({
      ...list,
      tracks: list.tracks.filter((track) => track.id !== trackId),
    }));
  const restorePlaylistTrack = (id: string, track: Track, index: number) =>
    editPlaylist(id, (list) => {
      if (
        list.tracks.some((item) => item.id === track.id) ||
        list.tracks.length >= 1000
      )
        return list;
      const tracks = [...list.tracks];
      tracks.splice(Math.max(0, Math.min(index, tracks.length)), 0, track);
      return { ...list, tracks };
    });
  const reorderPlaylistTrack = (id: string, from: number, to: number) =>
    editPlaylist(id, (list) => {
      if (
        !Number.isInteger(from) ||
        !Number.isInteger(to) ||
        from < 0 ||
        to < 0 ||
        from >= list.tracks.length ||
        to >= list.tracks.length ||
        from === to
      )
        return list;
      const tracks = [...list.tracks];
      const [track] = tracks.splice(from, 1);
      tracks.splice(to, 0, track!);
      return { ...list, tracks };
    });
  const movePlaylistTrack = (id: string, index: number, direction: -1 | 1) =>
    editPlaylist(id, (list) => {
      const tracks = [...list.tracks];
      const other = index + direction;
      if (
        index < 0 ||
        other < 0 ||
        index >= tracks.length ||
        other >= tracks.length
      )
        return list;
      [tracks[index], tracks[other]] = [tracks[other]!, tracks[index]!];
      return { ...list, tracks };
    });
  const toggleSavedItem = (item: CatalogItem) =>
    setLibrary((current) => {
      if (item.kind === 'track') return current;
      const key = item.kind === 'artist' ? 'followedArtists' : 'savedAlbums';
      return {
        ...current,
        [key]: current[key].some((entry) => entry.id === item.id)
          ? current[key].filter((entry) => entry.id !== item.id)
          : [item, ...current[key]].slice(0, 200),
      };
    });
  return {
    ...library,
    toggleFavorite,
    recordHistory,
    clearHistory,
    createPlaylist,
    renamePlaylist,
    deletePlaylist,
    addToPlaylist,
    removeFromPlaylist,
    restorePlaylistTrack,
    reorderPlaylistTrack,
    movePlaylistTrack,
    toggleSavedItem,
    storageError,
  };
}
export type LibraryModel = ReturnType<typeof useLibrary>;
