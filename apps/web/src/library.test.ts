import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { Track } from '@musicbit/shared';
import { FAVORITES_KEY, LIBRARY_KEY, readLibrary, useLibrary } from './library';
const track: Track = {
  id: 'abcdefghijk',
  title: 'Song',
  artist: 'Artist',
  album: 'Album',
  audioUrl: '/api/audio/abcdefghijk',
  artworkUrl: '/cover.png',
  mimeType: 'audio/mp4',
  sourceUrl: 'https://music.youtube.com/watch?v=abcdefghijk',
  permission: 'Playback',
  attribution: 'Artist',
};
afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});
describe('personal library', () => {
  it('undoes a removal at its original position without overwriting later edits or duplicating tracks', () => {
    const { result } = renderHook(useLibrary);
    const second = { ...track, id: 'secondtrack' };
    const third = { ...track, id: 'thirdtrack' };
    let id = '';
    act(() => {
      id = result.current.createPlaylist('Mix', [track, second])!;
    });
    act(() => result.current.removeFromPlaylist(id, track.id));
    act(() => result.current.addToPlaylist(id, [third]));
    act(() => result.current.restorePlaylistTrack(id, track, 0));
    act(() => result.current.restorePlaylistTrack(id, track, 0));
    expect(result.current.playlists[0]?.tracks).toEqual([track, second, third]);
    act(() => result.current.reorderPlaylistTrack(id, 0, 2));
    expect(result.current.playlists[0]?.tracks).toEqual([second, third, track]);
  });
  it('rejects additions above the playlist limit without silently dropping tracks', () => {
    const { result } = renderHook(useLibrary);
    const full = Array.from({ length: 1000 }, (_, i) => ({
      ...track,
      id: `track-${i}`,
    }));
    let id = '';
    act(() => {
      id = result.current.createPlaylist('Full', full)!;
    });
    act(() => {
      expect(result.current.addToPlaylist(id, [track])).toBe(false);
    });
    expect(result.current.playlists[0]?.tracks).toEqual(full);
  });
  it('migrates existing favorites and ignores a corrupt new library', () => {
    localStorage.setItem(
      FAVORITES_KEY,
      JSON.stringify({ version: 1, tracks: [track] }),
    );
    localStorage.setItem(LIBRARY_KEY, '{bad');
    expect(readLibrary().favorites).toEqual([track]);
  });
  it('creates, deduplicates, reorders and persists playlists across remounts', () => {
    const { result, unmount } = renderHook(useLibrary);
    let id = '';
    act(() => {
      id = result.current.createPlaylist('Evening', [track])!;
    });
    const second = { ...track, id: 'secondtrack', title: 'Second' };
    act(() => result.current.addToPlaylist(id, [track, second]));
    expect(result.current.playlists[0]?.tracks).toHaveLength(2);
    act(() => result.current.movePlaylistTrack(id, 1, -1));
    act(() => result.current.renamePlaylist(id, '  Evening mix  '));
    expect(result.current.playlists[0]?.tracks[0]?.title).toBe('Second');
    unmount();
    const restored = renderHook(useLibrary);
    expect(restored.result.current.playlists[0]?.name).toBe('Evening mix');
    act(() => restored.result.current.removeFromPlaylist(id, second.id));
    expect(restored.result.current.playlists[0]?.tracks).toEqual([track]);
    act(() => restored.result.current.deletePlaylist(id));
    expect(restored.result.current.playlists).toEqual([]);
  });
  it('records recent plays without duplicates and clears history', () => {
    const { result } = renderHook(useLibrary);
    act(() => result.current.recordHistory(track));
    act(() => result.current.recordHistory({ ...track, id: 'another' }));
    act(() => result.current.recordHistory(track));
    expect(result.current.history.map((entry) => entry.track.id)).toEqual([
      track.id,
      'another',
    ]);
    act(() => result.current.clearHistory());
    expect(readLibrary().history).toEqual([]);
  });
  it('retains listening functionality when local storage is full', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Full', 'QuotaExceededError');
    });
    const { result } = renderHook(useLibrary);
    act(() => result.current.toggleFavorite(track));
    expect(result.current.favorites).toEqual([track]);
    expect(result.current.storageError).toContain('Impossibile salvare');
  });
});
