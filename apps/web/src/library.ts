import { useCallback, useEffect, useReducer, type SetStateAction } from 'react';
import {
  isLocalLibrary,
  emptyLibrary,
  emptyTaste,
  cleanLibrary,
  type LocalLibrary,
  type Playlist,
  type ListeningTaste,
  isTracksResponse,
  type CatalogItem,
  type Track,
} from '@musicbit/shared';

export const FAVORITES_KEY = 'musicbit.favorites.v1';
export const LIBRARY_KEY = 'musicbit.library.v1';
export type { Playlist, HistoryEntry, LocalLibrary } from '@musicbit/shared';
const empty = emptyLibrary;
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
export function readLibrary(scope = 'guest'): LocalLibrary {
  const fallback = {
    ...empty(),
    favorites: scope === 'guest' ? readFavorites() : [],
  };
  try {
    const raw = localStorage.getItem(
      scope === 'guest' ? LIBRARY_KEY : `${LIBRARY_KEY}:${scope}`,
    );
    if (!raw || raw.length > 5_000_000) return fallback;
    const data = JSON.parse(raw) as LocalLibrary;
    if (!isLocalLibrary(data)) return fallback;
    return cleanLibrary(data);
  } catch {
    return fallback;
  }
}
export function useLibrary(scope = 'guest') {
  type LibraryState = { library: LocalLibrary; storageError: string };
  type LibraryAction =
    | { edit: SetStateAction<LocalLibrary> }
    | { error: string };
  const [{ library, storageError }, dispatch] = useReducer(
    (current: LibraryState, action: LibraryAction): LibraryState => {
      if ('error' in action)
        return current.storageError === action.error
          ? current
          : { ...current, storageError: action.error };
      const next =
        typeof action.edit === 'function'
          ? action.edit(current.library)
          : action.edit;
      if (!isLocalLibrary(next))
        return {
          ...current,
          storageError:
            'La libreria ha raggiunto il limite di spazio. Esporta un backup e riduci la raccolta prima di aggiungere altri elementi.',
        };
      return { library: next, storageError: '' };
    },
    scope,
    (key) => ({ library: readLibrary(key), storageError: '' }),
  );
  const setLibrary = useCallback(
    (edit: SetStateAction<LocalLibrary>) => dispatch({ edit }),
    [],
  );
  const setStorageError = useCallback(
    (error: string) => dispatch({ error }),
    [],
  );
  useEffect(() => {
    try {
      localStorage.setItem(
        scope === 'guest' ? LIBRARY_KEY : `${LIBRARY_KEY}:${scope}`,
        JSON.stringify(library),
      );
      if (scope === 'guest')
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
  }, [library, scope, setStorageError]);
  const toggleFavorite = useCallback(
    (track: Track) => {
      setLibrary((current) => ({
        ...current,
        favorites: current.favorites.some((item) => item.id === track.id)
          ? current.favorites.filter((item) => item.id !== track.id)
          : [track, ...current.favorites].slice(0, 1000),
      }));
    },
    [setLibrary],
  );
  const recordHistory = useCallback(
    (track: Track) => {
      setLibrary((current) => ({
        ...current,
        history: [
          { track, playedAt: Date.now() },
          ...current.history.filter((entry) => entry.track.id !== track.id),
        ].slice(0, 100),
      }));
    },
    [setLibrary],
  );
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
  const replaceLibrary = useCallback(
    (value: LocalLibrary) => {
      if (!isLocalLibrary(value)) throw new Error('Libreria non valida.');
      setLibrary(cleanLibrary(value));
    },
    [setLibrary],
  );
  const updateTaste = useCallback(
    (edit: (taste: ListeningTaste) => ListeningTaste) => {
      setLibrary((current) => ({
        ...current,
        taste: edit(current.taste ?? emptyTaste()),
      }));
    },
    [setLibrary],
  );
  const dismissTrack = (id: string) =>
    updateTaste((taste) => ({
      ...taste,
      dismissed: [...new Set([id, ...taste.dismissed])].slice(0, 500),
    }));
  const setNovelty = (novelty: ListeningTaste['novelty']) =>
    updateTaste((taste) => ({ ...taste, novelty }));
  const resetTaste = () => updateTaste(() => emptyTaste());
  const setArtistPreference = (
    artist: string,
    preference: 'auto' | 'more' | 'less' | 'blocked',
  ) =>
    updateTaste((taste) => ({
      ...taste,
      artistPreferences: [
        ...(preference === 'auto' ? [] : [{ artist, preference }]),
        ...(taste.artistPreferences ?? []).filter(
          (p) =>
            p.artist.trim().toLocaleLowerCase() !==
            artist.trim().toLocaleLowerCase(),
        ),
      ].slice(0, 200),
    }));
  const toggleTasteExclusion = (id: string) =>
    updateTaste((taste) => ({
      ...taste,
      excludedFromTaste: taste.excludedFromTaste?.includes(id)
        ? taste.excludedFromTaste.filter((value) => value !== id)
        : [id, ...(taste.excludedFromTaste ?? [])].slice(0, 500),
    }));
  const restoreDismissed = (id: string) =>
    updateTaste((taste) => ({
      ...taste,
      dismissed: taste.dismissed.filter((value) => value !== id),
    }));
  const recordOutcome = useCallback(
    (id: string, outcome: 'completed' | 'skipped') =>
      updateTaste((taste) => {
        const previous = taste.signals.find((s) => s.id === id) ?? {
          id,
          completed: 0,
          skipped: 0,
        };
        return {
          ...taste,
          signals: [
            {
              ...previous,
              [outcome]: Math.min(1000000, previous[outcome] + 1),
            },
            ...taste.signals.filter((s) => s.id !== id),
          ].slice(0, 500),
        };
      }),
    [updateTaste],
  );
  return {
    ...library,
    snapshot: library,
    replaceLibrary,
    dismissTrack,
    setNovelty,
    resetTaste,
    setArtistPreference,
    toggleTasteExclusion,
    restoreDismissed,
    recordOutcome,
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
