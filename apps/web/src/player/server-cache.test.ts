import { expect, it } from 'vitest';
import type { PlayerState } from './engine';
import type { Track } from '@musicbit/shared';
import { cacheWindow } from './server-cache';
const tracks: Track[] = Array.from({ length: 20 }, (_, i) => ({
  id: String(i).padStart(11, '0'),
  title: `${i}`,
  artist: 'Artist',
  album: 'Album',
  audioUrl: `/api/audio/${String(i).padStart(11, '0')}`,
  artworkUrl: '',
  mimeType: 'audio/mp4',
  sourceUrl: '',
  permission: '',
  attribution: '',
}));
const state = (values: Partial<PlayerState> = {}) =>
  ({
    queue: tracks,
    index: 4,
    repeat: 'off',
    autoplay: false,
    autoplayTracks: [],
    ...values,
  }) as PlayerState;
it('prioritizes current song, ten next and only two preceding songs', () => {
  expect(cacheWindow(state())).toEqual(
    [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 2, 3].map((i) => tracks[i]!.id),
  );
});
it('follows repeat and autoplay order without duplicates or external URLs', () => {
  expect(cacheWindow(state({ index: 19, repeat: 'all' }))).toEqual(
    [19, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 17, 18].map((i) => tracks[i]!.id),
  );
  expect(
    cacheWindow(
      state({ index: 19, autoplay: true, autoplayTracks: tracks.slice(0, 10) }),
    ),
  ).toHaveLength(13);
  expect(cacheWindow(state({ repeat: 'one' }))).toEqual(
    [4, 2, 3].map((i) => tracks[i]!.id),
  );
  expect(
    cacheWindow(
      state({
        queue: [{ ...tracks[0]!, audioUrl: 'https://external.test/song.mp3' }],
        index: 0,
      }),
    ),
  ).toEqual([]);
});
