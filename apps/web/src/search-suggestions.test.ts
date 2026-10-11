import { describe, expect, it } from 'vitest';
import { catalogItemToTrack, type CatalogItem } from '@musicbit/shared';
import { searchSuggestions } from './search-suggestions';
const item: CatalogItem = {
  id: 'abcdefghijk',
  kind: 'track',
  provider: 'youtube',
  title: 'Caffè',
  artist: 'Artist',
  sourceUrl: 'https://music.youtube.com/watch?v=abcdefghijk',
  playback: { available: true },
};
describe('immediate search suggestions', () => {
  it('uses local metadata immediately, matches accents, and avoids duplicate catalog suggestions', () => {
    const result = searchSuggestions(
      'caffe',
      ['caffè radio'],
      [catalogItemToTrack(item)],
      [],
      [item, item],
    );
    expect(result.map((s) => s.label)).toEqual(['caffè radio', 'Caffè']);
    expect(searchSuggestions('', [], [], [], [item])).toEqual([]);
  });
});
