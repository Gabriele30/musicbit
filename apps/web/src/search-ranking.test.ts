import { expect, it } from 'vitest';
import type { CatalogItem } from '@musicbit/shared';
import { rankSearchResults } from './search-ranking';
const item = (
  id: string,
  title: string,
  kind: CatalogItem['kind'],
  artist = '',
) => ({ id, title, kind, artist }) as CatalogItem;
it('finds the exact artist ahead of songs by that artist, ignoring accents and punctuation', () => {
  const artist = item('a', 'Beyoncé', 'artist'),
    song = item('s', 'Halo', 'track', 'Beyoncé');
  expect(rankSearchResults([song, artist], ' BEYONCE! ')[0]).toBe(artist);
});
it('prefers exact song title and word prefixes, deduplicating identities while preserving provider order on ties', () => {
  const exact = item('a', 'Blue Sky', 'track'),
    prefix = item('b', 'Blue sky live', 'track'),
    weak = item('c', 'A blue sky', 'track');
  expect(rankSearchResults([weak, prefix, exact, exact], 'blue sky')).toEqual([
    exact,
    prefix,
    weak,
  ]);
});
