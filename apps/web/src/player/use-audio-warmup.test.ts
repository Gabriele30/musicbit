import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useAudioWarmup } from './use-audio-warmup';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('resolves just metadata after a visible candidate settles and cancels on leaving', async () => {
  vi.useFakeTimers();
  const fetcher = vi.fn().mockResolvedValue(new Response('{}'));
  vi.stubGlobal('fetch', fetcher);
  const { rerender, unmount } = renderHook(
    ({ active }) => useAudioWarmup('/api/audio/abcdefghijk', active),
    { initialProps: { active: false } },
  );
  await act(() => vi.advanceTimersByTimeAsync(500));
  expect(fetcher).not.toHaveBeenCalled();
  rerender({ active: true });
  await act(() => vi.advanceTimersByTimeAsync(249));
  expect(fetcher).not.toHaveBeenCalled();
  await act(() => vi.advanceTimersByTimeAsync(1));
  expect(fetcher).toHaveBeenCalledOnce();
  expect(fetcher.mock.calls[0]?.[0]).toBe('/api/audio/abcdefghijk/info');
  const signal = fetcher.mock.calls[0]?.[1].signal as AbortSignal;
  rerender({ active: false });
  expect(signal.aborted).toBe(true);
  unmount();
});

it('replaces a briefly visible candidate without resolving abandoned or external audio', async () => {
  vi.useFakeTimers();
  const fetcher = vi.fn().mockResolvedValue(new Response('{}'));
  vi.stubGlobal('fetch', fetcher);
  const { rerender } = renderHook(
    ({ source }) => useAudioWarmup(source, true),
    {
      initialProps: { source: '/api/audio/abcdefghijk' },
    },
  );
  await act(() => vi.advanceTimersByTimeAsync(100));
  rerender({ source: '/api/audio/lmnopqrstuv' });
  await act(() => vi.advanceTimersByTimeAsync(250));
  expect(fetcher.mock.calls.map((call) => call[0])).toEqual([
    '/api/audio/lmnopqrstuv/info',
  ]);
  rerender({ source: 'https://example.com/audio.mp3' });
  await act(() => vi.advanceTimersByTimeAsync(500));
  expect(fetcher).toHaveBeenCalledOnce();
});
