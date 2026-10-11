import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { Track } from '@musicbit/shared';
import { accountRequest } from '../account';
import { PlayerEngine } from './engine';
import { useCloudSession } from './cloud-session';
vi.mock('../account', async (original) => ({
  ...(await original<typeof import('../account')>()),
  accountRequest: vi.fn(),
}));
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  sessionStorage.clear();
});
it('retries an initially unavailable cloud session even after local playback starts', async () => {
  vi.useFakeTimers();
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
  const audio = document.createElement('audio');
  vi.spyOn(audio, 'load').mockImplementation(() => {});
  vi.spyOn(audio, 'pause').mockImplementation(() => {});
  vi.spyOn(audio, 'play').mockResolvedValue(undefined);
  const player = new PlayerEngine(audio),
    request = vi.mocked(accountRequest);
  request
    .mockRejectedValueOnce(new Error('temporarily unavailable'))
    .mockResolvedValueOnce({
      revision: 0,
      session: null,
      deviceId: '',
      updatedAt: 0,
    })
    .mockResolvedValue({
      revision: 1,
      session: {
        queue: [track],
        index: 0,
        position: 0,
        repeat: 'off',
        autoplay: true,
      },
      deviceId: 'device-test',
      updatedAt: Date.now(),
    });
  const { unmount } = renderHook(() => useCloudSession(player, 'account-test'));
  await act(async () => {
    await Promise.resolve();
  });
  act(() => player.playCollection([track]));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5000);
  });
  expect(
    request.mock.calls.filter(
      ([path, , method]) => path === '/api/me/playback' && method === 'GET',
    ),
  ).toHaveLength(2);
  expect(
    request.mock.calls.find(([, body, method]) => method === 'PUT' && body),
  ).toBeDefined();
  unmount();
  player.destroy();
});
