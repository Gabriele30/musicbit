import { describe, expect, it, vi } from 'vitest';
import {
  readRecentSearches,
  rememberSearch,
  saveRecentSearches,
  RECENT_SEARCHES_KEY,
} from './recent-searches';

describe('recent searches', () => {
  it('deduplicates explicitly chosen searches, limits history and supports removal', () => {
    const queries = rememberSearch(['bach', 'Miles'], ' Bach ');
    expect(queries).toEqual(['Bach', 'Miles']);
    saveRecentSearches(queries);
    expect(readRecentSearches()).toEqual(queries);
    saveRecentSearches([]);
    expect(localStorage.getItem(RECENT_SEARCHES_KEY)).toBeNull();
    expect(
      rememberSearch(
        Array.from({ length: 8 }, (_, i) => `Query ${i}`),
        'New',
      ),
    ).toHaveLength(8);
  });
  it('ignores corrupt storage and keeps search usable when persistence fails', () => {
    localStorage.setItem(RECENT_SEARCHES_KEY, '{bad');
    expect(readRecentSearches()).toEqual([]);
    const write = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new DOMException('Full');
      });
    expect(() => saveRecentSearches(['Bach'])).not.toThrow();
    write.mockRestore();
    localStorage.clear();
  });
});
