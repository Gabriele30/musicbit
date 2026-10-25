import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ContinuousTimeline, Track } from '@musicbit/shared';
import { accountRequest } from '../account';
import { ContinuousPlayback } from './continuous';

vi.mock('../account', () => ({ accountRequest: vi.fn() }));
const request = vi.mocked(accountRequest);
const track = (index: number): Track => ({
  id: String(index).padStart(11, '0'),
  title: `Track ${index}`,
  artist: 'Artist',
  audioUrl: `/api/audio/${String(index).padStart(11, '0')}`,
  mimeType: 'audio/mp4',
  sourceUrl: 'https://example.com',
  permission: 'Authorized',
  attribution: 'Artist',
});
const timeline = (start: number, count: number): ContinuousTimeline => ({
  queueStart: start,
  complete: false,
  tracks: Array.from({ length: count }, (_, i) => ({
    index: start + i,
    id: track(start + i).id,
    start: (start + i) * 5,
    duration: 5,
  })),
  additions: Array.from({ length: count }, (_, i) => ({
    index: start + i,
    track: track(start + i),
  })),
});
afterEach(() => {
  vi.useRealTimers();
  vi.resetAllMocks();
});

describe('native rolling queue', () => {
  it('keeps the same device identity when a window reloads and creates a new stream', async () => {
    vi.useFakeTimers();
    request.mockResolvedValue(timeline(0, 1));
    const first = new ContinuousPlayback(vi.fn(), vi.fn());
    first.configure(true);
    first.start([track(0)], 0);
    await first.submit();
    const firstPlan = request.mock.calls.find(
      (call) => call[2] === 'POST',
    )![1] as { deviceId: string };
    const second = new ContinuousPlayback(vi.fn(), vi.fn());
    second.configure(true);
    second.start([track(0)], 0);
    await second.submit();
    const plans = request.mock.calls.filter((call) => call[2] === 'POST');
    expect(firstPlan.deviceId).toMatch(/^[a-zA-Z0-9_-]{8,100}$/);
    expect(plans.at(-1)![1]).toMatchObject({ deviceId: firstPlan.deviceId });
    first.clear();
    second.clear();
  });
  it('preserves a paused or backward-seeked retired track until native audio reaches the new window', async () => {
    vi.useFakeTimers();
    let nativeTime = 21;
    request.mockResolvedValueOnce({ ...timeline(0, 8), revision: 1 });
    const playback = new ContinuousPlayback(vi.fn(), vi.fn(), () => nativeTime);
    playback.configure(true);
    const queue = Array.from({ length: 8 }, (_, index) => track(index));
    const source = playback.start(queue, 0, true);
    await playback.submit();
    request.mockResolvedValueOnce({ ...timeline(5, 23), revision: 3 });
    await vi.advanceTimersByTimeAsync(3000);
    expect(playback.takePrune()).toBe(0);
    expect(playback.at(nativeTime)).toEqual({
      index: 4,
      position: 1,
      duration: 5,
    });
    expect(playback.target(4)).toBeUndefined();
    expect(playback.target(5)?.id).toBe(track(5).id);
    const expanded = [...queue, ...playback.appended(queue)];
    expect(playback.validQueue(expanded)).toBe(true);
    // A late snapshot cannot undo the newer server window or its revision.
    request.mockResolvedValueOnce({ ...timeline(0, 8), revision: 2 });
    await vi.advanceTimersByTimeAsync(3000);
    expect(playback.target(4)).toBeUndefined();
    expect(playback.at(nativeTime)?.index).toBe(4);
    nativeTime = 26;
    request.mockResolvedValueOnce({ ...timeline(5, 23), revision: 4 });
    await vi.advanceTimersByTimeAsync(3000);
    expect(playback.takePrune()).toBe(5);
    const retained = expanded.slice(5);
    expect(playback.validQueue(retained)).toBe(true);
    expect(playback.at(nativeTime)).toEqual({
      index: 0,
      position: 1,
      duration: 5,
    });
    expect(playback.target(0)?.id).toBe(track(5).id);
    expect(playback.source).toBe(source);
    request.mockResolvedValue(undefined);
    playback.clear();
  });
  it('keeps a failed plan update retry alive when an older poll completes', async () => {
    vi.useFakeTimers();
    request.mockResolvedValueOnce(timeline(0, 2));
    const playback = new ContinuousPlayback(vi.fn(), vi.fn());
    playback.configure(true);
    const queue = [track(0), track(1)];
    playback.start(queue, 0, false);
    await playback.submit();
    let deliver!: (value: ContinuousTimeline) => void;
    request.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          deliver = resolve;
        }),
    );
    await vi.advanceTimersByTimeAsync(3000);
    request.mockRejectedValueOnce(new Error('Network unavailable'));
    playback.syncQueue(queue, true);
    await vi.advanceTimersByTimeAsync(0);
    deliver(timeline(0, 2));
    await vi.advanceTimersByTimeAsync(0);
    request.mockResolvedValueOnce(timeline(0, 2));
    await vi.advanceTimersByTimeAsync(1000);
    expect(
      request.mock.calls.filter((call) => call[2] === 'POST'),
    ).toHaveLength(3);
    request.mockResolvedValue(undefined);
    playback.clear();
  });
  it('discards an older poll at the same window after a newer plan response', async () => {
    vi.useFakeTimers();
    request.mockResolvedValueOnce({ ...timeline(0, 2), revision: 1 });
    const playback = new ContinuousPlayback(vi.fn(), vi.fn());
    playback.configure(true);
    const queue = [track(0), track(1)];
    playback.start(queue, 0, false);
    await playback.submit();
    let deliver!: (value: ContinuousTimeline) => void;
    request.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          deliver = resolve;
        }),
    );
    await vi.advanceTimersByTimeAsync(3000);
    request.mockResolvedValueOnce({ ...timeline(0, 3), revision: 3 });
    playback.syncQueue([...queue, track(2)], true);
    await vi.advanceTimersByTimeAsync(0);
    expect(playback.target(2)?.id).toBe(track(2).id);
    deliver({ ...timeline(0, 2), complete: true, revision: 2 });
    await vi.advanceTimersByTimeAsync(0);
    expect(playback.target(2)?.id).toBe(track(2).id);
    expect(playback.requiresRestart([...queue, track(2)], true)).toBe(false);
    request.mockResolvedValue(undefined);
    playback.clear();
  });
  it('retries a failed initial plan and cancels recovery when the source changes', async () => {
    vi.useFakeTimers();
    request.mockRejectedValueOnce(new Error('Network unavailable'));
    const log = vi.fn();
    const playback = new ContinuousPlayback(vi.fn(), log);
    playback.configure(true);
    const source = playback.start([track(0)], 0, true);
    await playback.submit();
    expect(log).toHaveBeenCalledWith('continuous:plan-error');
    request.mockResolvedValueOnce(timeline(0, 1));
    await vi.advanceTimersByTimeAsync(1000);
    expect(playback.target(0)?.id).toBe(track(0).id);
    expect(playback.source).toBe(source);
    request.mockResolvedValue(undefined);
    playback.clear();
    request.mockRejectedValueOnce(new Error('Network unavailable'));
    playback.start([track(1)], 0, true);
    await playback.submit();
    request.mockResolvedValue(undefined);
    playback.clear();
    const calls = request.mock.calls.length;
    await vi.advanceTimersByTimeAsync(30000);
    expect(request).toHaveBeenCalledTimes(calls);
  });
  it('catches up after suspension beyond the known queue and preserves absolute audio time', async () => {
    vi.useFakeTimers();
    request.mockResolvedValueOnce(timeline(0, 3));
    const changed = vi.fn();
    const playback = new ContinuousPlayback(changed, vi.fn());
    playback.configure(true);
    const queue = [track(99), track(0), track(1), track(2)];
    const source = playback.start(queue, 1, true);
    await playback.submit();
    request.mockResolvedValueOnce(timeline(8, 23));
    await vi.advanceTimersByTimeAsync(3000);
    expect(playback.takePrune()).toBe(9);
    const retained = playback.appended([]);
    expect(retained.map((item) => item.id)).toEqual(
      Array.from({ length: 23 }, (_, i) => track(i + 8).id),
    );
    expect(playback.validQueue(retained)).toBe(true);
    expect(playback.at(102)).toEqual({ index: 12, position: 2, duration: 5 });
    expect(playback.target(12)?.start).toBe(100);
    expect(playback.source).toBe(source);
    expect(playback.takePrune()).toBe(0);
    request.mockResolvedValueOnce(timeline(8, 23));
    playback.syncQueue(retained, false);
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(3));
    expect(request.mock.calls[2]?.[1]).toMatchObject({
      queueStart: 8,
      ids: retained.map((item) => item.id),
      autoplay: false,
      maxTracks: 1000,
    });
    request.mockResolvedValue(undefined);
    playback.clear();
  });

  it('ignores a stale in-flight POST after a newer poll has advanced the window', async () => {
    vi.useFakeTimers();
    request.mockResolvedValueOnce(timeline(0, 3));
    const playback = new ContinuousPlayback(vi.fn(), vi.fn());
    playback.configure(true);
    playback.start([track(0), track(1), track(2)], 0, true);
    await playback.submit();
    let deliver!: (value: ContinuousTimeline) => void;
    request.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          deliver = resolve;
        }),
    );
    playback.syncQueue([track(0), track(1), track(2)], false);
    request.mockResolvedValueOnce(timeline(1, 3));
    await vi.advanceTimersByTimeAsync(3000);
    expect(playback.takePrune()).toBe(1);
    const retained = [
      track(1),
      track(2),
      ...playback.appended([track(1), track(2)]),
    ];
    request.mockResolvedValue(timeline(1, 3));
    deliver(timeline(0, 3));
    await vi.advanceTimersByTimeAsync(0);
    expect(playback.target(0)?.id).toBe(track(1).id);
    expect(playback.validQueue(retained)).toBe(true);
    playback.clear();
  });

  it('requires a new source when extending a finite ENDLIST, but keeps an open radio source', async () => {
    request.mockResolvedValueOnce({ ...timeline(0, 2), complete: true });
    const playback = new ContinuousPlayback(vi.fn(), vi.fn());
    playback.configure(true);
    const queue = [track(0), track(1)];
    playback.start(queue, 0, false);
    await playback.submit();
    expect(playback.requiresRestart(queue, false)).toBe(false);
    expect(playback.requiresRestart(queue, true)).toBe(true);
    expect(playback.requiresRestart([...queue, track(2)], false)).toBe(true);
    request.mockResolvedValue(undefined);
    playback.clear();
    request.mockResolvedValueOnce(timeline(0, 2));
    playback.start(queue, 0, true);
    await playback.submit();
    expect(playback.requiresRestart([...queue, track(2)], true)).toBe(false);
    request.mockResolvedValue(undefined);
    playback.clear();
  });
});
