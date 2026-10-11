import { describe, expect, it } from 'vitest';
import {
  automaticMixes,
  buildTasteProfile,
  catalogItemToTrack,
  emptyLibrary,
  isPlaybackSnapshot,
  personalRecommendations,
  summarizeListening,
  type CatalogItem,
} from './index.js';
const song = (id = 'abcdefghijk', artist = 'Artist'): CatalogItem => ({
  id,
  kind: 'track',
  provider: 'youtube',
  title: id,
  artist,
  sourceUrl: `https://music.youtube.com/watch?v=${id}`,
  playback: { available: true },
});
describe('listening insights and personal corrections', () => {
  it('validates duplicate queue entries while rejecting invalid positions and unsafe audio', () => {
    const track = catalogItemToTrack(song()),
      session = {
        queue: [track, track],
        index: 1,
        position: 20,
        repeat: 'off',
      };
    expect(isPlaybackSnapshot(session)).toBe(true);
    expect(isPlaybackSnapshot({ ...session, index: 2 })).toBe(false);
    expect(isPlaybackSnapshot({ ...session, position: Infinity })).toBe(false);
    expect(
      isPlaybackSnapshot({
        ...session,
        queue: [{ ...track, audioUrl: 'javascript:alert(1)' }],
      }),
    ).toBe(false);
  });
  it('sums repeat listens and actual seconds across months without mixing years or artist case', () => {
    const track = catalogItemToTrack(song());
    const stats = summarizeListening(
      [
        { day: '2026-01-01', track, seconds: 60, plays: 2, completed: 1 },
        {
          day: '2026-02-02',
          track: { ...track, artist: 'ARTIST' },
          seconds: 90,
          plays: 1,
          completed: 0,
        },
        { day: '2025-12-31', track, seconds: 300, plays: 2, completed: 0 },
      ],
      '2026-01-01',
      '2026-12-31',
    );
    expect(stats).toMatchObject({
      seconds: 150,
      plays: 3,
      activeDays: 2,
      distinctTracks: 1,
      distinctArtists: 1,
    });
    expect(stats.months).toEqual([
      { month: '2026-01', seconds: 60 },
      { month: '2026-02', seconds: 90 },
    ]);
  });
  it('shows inferred affinity separately from user corrections and enforces blocked artists in mixes', () => {
    const lib = emptyLibrary(),
      track = catalogItemToTrack(song());
    lib.favorites = [track];
    lib.history = [{ track, playedAt: 1 }];
    lib.taste = {
      novelty: 'balanced',
      dismissed: [],
      signals: [],
      artistPreferences: [{ artist: 'Artist', preference: 'blocked' }],
      excludedFromTaste: [track.id],
    };
    expect(buildTasteProfile(lib)[0]).toMatchObject({
      inferredScore: 0,
      preference: 'blocked',
      favorites: 0,
      recent: 0,
    });
    const candidates = [song('abcdefghij1'), song('abcdefghij2', 'New artist')];
    expect(
      personalRecommendations(lib, candidates).map((s) => s.item.artist),
    ).toEqual(['New artist']);
    expect(
      automaticMixes(lib, candidates)
        .flatMap((m) => m.tracks)
        .every((t) => t.artist !== 'Artist'),
    ).toBe(true);
  });
});
