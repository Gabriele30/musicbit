import { afterEach, expect, it, vi } from 'vitest';
import { AudioByteCache } from './byte-cache.js';
afterEach(() => vi.useRealTimers());
it('evicts least-recently used complete songs within the byte budget and expires old audio', () => {
  vi.useFakeTimers();
  const cache = new AudioByteCache(6, 100);
  cache.put('a', Buffer.from([1, 2, 3]), 'audio/mp4');
  cache.put('b', Buffer.from([4, 5, 6]), 'audio/mp4');
  expect(cache.get('a')?.bytes).toEqual(Buffer.from([1, 2, 3]));
  cache.put('c', Buffer.from([7, 8, 9]), 'audio/mp4');
  expect(cache.get('b')).toBeUndefined();
  expect(cache.get('c')).toBeDefined();
  vi.advanceTimersByTime(101);
  expect(cache.get('a')).toBeUndefined();
  expect(cache.get('c')).toBeUndefined();
});
