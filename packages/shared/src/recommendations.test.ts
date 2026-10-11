import { describe, expect, it } from 'vitest';
import {
  emptyLibrary,
  personalRecommendations,
  isLocalLibrary,
  type CatalogItem,
} from './index.js';
const item = (id: string, artist = 'Artist', title = id): CatalogItem => ({
  id,
  kind: 'track',
  provider: 'youtube',
  title,
  artist,
  sourceUrl: `https://music.youtube.com/watch?v=${id}`,
  playback: { available: true },
});
describe('personal discovery', () => {
  it('filters dismissed/recent songs and duplicate titles, and caps artist repetition', () => {
    const lib = emptyLibrary();
    lib.taste = {
      novelty: 'balanced',
      dismissed: ['abcdefghij1'],
      signals: [],
    };
    const ranked = personalRecommendations(lib, [
      item('abcdefghij1'),
      item('abcdefghij2'),
      item('abcdefghij3'),
      item('abcdefghij4'),
      item('abcdefghij5', 'Other'),
      item('abcdefghij6', 'Other', 'abcdefghij5'),
    ]);
    expect(ranked.map((r) => r.item.id)).toEqual([
      'abcdefghij2',
      'abcdefghij3',
      'abcdefghij5',
    ]);
  });
  it('uses followed artists and negative feedback, with an explanation', () => {
    const lib = emptyLibrary();
    lib.followedArtists = [
      {
        ...item('UCabcdefghijklmnopqrstuv', 'Artist', 'Favorite'),
        kind: 'artist',
      },
    ];
    lib.taste = {
      novelty: 'balanced',
      dismissed: [],
      signals: [{ id: 'abcdefghij1', completed: 0, skipped: 10 }],
    };
    const ranked = personalRecommendations(lib, [
      item('abcdefghij1', 'Favorite'),
      item('abcdefghij2', 'Favorite'),
      item('abcdefghij3', 'Other'),
    ]);
    expect(ranked[0]?.item.id).toBe('abcdefghij2');
    expect(ranked[0]?.reason).toContain('Favorite');
    expect(ranked.at(-1)?.item.id).toBe('abcdefghij1');
  });
  it('rejects invalid storage contracts', () => {
    expect(isLocalLibrary(emptyLibrary())).toBe(true);
    expect(
      isLocalLibrary({
        ...emptyLibrary(),
        taste: {
          novelty: 'balanced',
          dismissed: [],
          signals: [{ id: 'x', completed: -1, skipped: 0 }],
        },
      }),
    ).toBe(false);
  });
});
