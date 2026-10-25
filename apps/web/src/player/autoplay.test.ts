import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import {
  catalogItemToTrack,
  emptyLibrary,
  emptyTaste,
  type CatalogItem,
  type LocalLibrary,
  type Track,
} from '@musicbit/shared';
import { connectAutoplay, useAutoplay } from './autoplay';
import type { PlayerEngine, PlayerState } from './engine';

const item = (id: string, artist = id): CatalogItem => ({
  id,
  kind: 'track',
  provider: 'youtube',
  title: id,
  artist,
  audioUrl: `/api/audio/${id}`,
  sourceUrl: `https://music.youtube.com/watch?v=${id}`,
  playback: { available: true },
});
const seed = item('aaaaaaaaaaa');
const recommendation = item('bbbbbbbbbbb', 'Preferred');
const second = item('ccccccccccc', 'Other');
const response = (items: CatalogItem[] = [recommendation], extra = {}) =>
  new Response(
    JSON.stringify({
      seedId: seed.id,
      items,
      timing: { cache: 'miss', elapsedMs: 0 },
      ...extra,
    }),
    { headers: { 'Content-Type': 'application/json' } },
  );
function setup(library = emptyLibrary()) {
  let state = {
    queue: [catalogItemToTrack(seed)],
    index: 0,
    autoplay: true,
    autoplayTracks: [],
    autoplayStatus: 'idle',
  } as unknown as PlayerState;
  let delivery = 'progressive';
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((listener) => listener());
  const player = {
    getSnapshot: () => state,
    getDelivery: () => delivery,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setRecommendations: vi.fn(
      (seedId: string, tracks: Track[], status = 'ready') => {
        if (seedId !== state.queue[state.index]?.id || !state.autoplay) return;
        state = {
          ...state,
          autoplayTracks: tracks,
          autoplayStatus: status,
        } as PlayerState;
        notify();
      },
    ),
  } as unknown as PlayerEngine;
  const disconnect = connectAutoplay(player, {
    accountId: 'account',
    getLibrary: () => library,
  });
  connections.push(disconnect);
  return {
    player,
    disconnect,
    delivery: (value: string) => {
      delivery = value;
      notify();
    },
    change: (value: Partial<PlayerState>) => {
      state = { ...state, ...value };
      notify();
    },
    library: (value: LocalLibrary) => {
      library = value;
      disconnect.refresh();
    },
  };
}
const connections: ReturnType<typeof connectAutoplay>[] = [];
afterEach(() => {
  connections.splice(0).forEach((disconnect) => disconnect());
  vi.useRealTimers();
});

describe('adaptive infinite listening', () => {
  it('keeps usable songs when one legacy radio item has invalid artwork', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        response([
          recommendation,
          { ...second, artworkUrl: '/icons/icon-192.png' },
        ]),
      ),
    );
    const { player } = setup();
    await vi.waitFor(() =>
      expect(player.getSnapshot().autoplayStatus).toBe('ready'),
    );
    expect(
      player.getSnapshot().autoplayTracks.map((track) => track.id),
    ).toEqual([recommendation.id]);
  });
  it('uses the currently playing artist to avoid a same-artist next song even when that artist ranks highest', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response([recommendation, second])),
    );
    const library = emptyLibrary();
    library.favorites = [catalogItemToTrack(recommendation)];
    const { player, change } = setup(library);
    change({ queue: [{ ...catalogItemToTrack(seed), artist: 'Preferred' }] });
    await vi.waitFor(() =>
      expect(player.getSnapshot().autoplayStatus).toBe('ready'),
    );
    expect(
      player.getSnapshot().autoplayTracks.map((track) => track.id),
    ).toEqual([second.id, recommendation.id]);
  });
  it('retains the restricted-provider notice while reranking cached suggestions', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        response([recommendation], {
          notice: 'Continuiamo con i tuoi ascolti già in cache.',
        }),
      ),
    );
    const { player, library: changeLibrary } = setup();
    await vi.waitFor(() =>
      expect(player.getSnapshot().autoplayStatus).toBe('ready'),
    );
    expect(player.setRecommendations).toHaveBeenLastCalledWith(
      seed.id,
      [catalogItemToTrack(recommendation)],
      'ready',
      'Continuiamo con i tuoi ascolti già in cache.',
    );
    changeLibrary(emptyLibrary());
    expect(player.setRecommendations).toHaveBeenLastCalledWith(
      seed.id,
      [catalogItemToTrack(recommendation)],
      'ready',
      'Continuiamo con i tuoi ascolti già in cache.',
    );
  });
  it('uses account radio, excludes queued songs and reranks immediately when taste changes', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(response([second, recommendation, seed]));
    vi.stubGlobal('fetch', fetcher);
    const library = emptyLibrary();
    library.taste = emptyTaste();
    library.favorites = [catalogItemToTrack(recommendation)];
    library.taste!.artistPreferences = [
      { artist: 'Preferred', preference: 'more' },
    ];
    const { player, library: changeLibrary } = setup(library);
    await vi.waitFor(() =>
      expect(player.getSnapshot().autoplayStatus).toBe('ready'),
    );
    const url = new URL(fetcher.mock.calls[0]![0], location.origin);
    expect(url.pathname).toBe(`/api/me/radio/${seed.id}`);
    expect(url.searchParams.get('exclude')).toBe(seed.id);
    expect(
      player.getSnapshot().autoplayTracks.map((track) => track.id),
    ).toEqual([recommendation.id, second.id]);
    const next = {
      ...library,
      taste: {
        ...library.taste!,
        artistPreferences: [
          { artist: 'Preferred', preference: 'blocked' as const },
        ],
      },
    };
    changeLibrary(next);
    expect(
      player.getSnapshot().autoplayTracks.map((track) => track.id),
    ).toEqual([second.id]);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('retries a transient failure for the same track without another user gesture', async () => {
    vi.useFakeTimers();
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new Error('temporary provider outage'))
      .mockResolvedValue(response());
    vi.stubGlobal('fetch', fetcher);
    const { player } = setup();
    await vi.advanceTimersByTimeAsync(0);
    expect(player.getSnapshot().autoplayStatus).toBe('error');
    await vi.advanceTimersByTimeAsync(2000);
    expect(player.getSnapshot().autoplayTracks[0]?.id).toBe(recommendation.id);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('retries an empty response and reconnects immediately when the network returns', async () => {
    vi.useFakeTimers();
    const fetcher = vi
      .fn()
      .mockImplementationOnce(() =>
        Promise.resolve(response([], { retry: true })),
      )
      .mockImplementationOnce(() =>
        Promise.resolve(response([], { retry: true })),
      )
      .mockImplementation(() => Promise.resolve(response()));
    vi.stubGlobal('fetch', fetcher);
    const { player } = setup();
    await vi.advanceTimersByTimeAsync(2000);
    expect(fetcher).toHaveBeenCalledTimes(2);
    window.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(0);
    expect(player.getSnapshot().autoplayTracks[0]?.id).toBe(recommendation.id);
    await vi.advanceTimersByTimeAsync(30000);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('cancels progressive resolution when HLS takes ownership and ignores late results', async () => {
    let finish!: (value: Response) => void;
    const fetcher = vi.fn().mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    );
    vi.stubGlobal('fetch', fetcher);
    const { player, delivery, disconnect } = setup();
    await Promise.resolve();
    const signal = (fetcher.mock.calls[0]![1] as RequestInit).signal!;
    delivery('hls');
    expect(signal.aborted).toBe(true);
    finish(response());
    await Promise.resolve();
    await Promise.resolve();
    expect(player.getSnapshot().autoplayTracks).toEqual([]);
    disconnect.refresh();
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('lets synchronous source selection establish HLS ownership before requesting progressive radio', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const { delivery } = setup();
    expect(fetcher).not.toHaveBeenCalled();
    delivery('hls');
    await Promise.resolve();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('stops retry timers and account requests when listening is disabled or disconnected', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn().mockRejectedValue(new Error('offline'));
    vi.stubGlobal('fetch', fetcher);
    const { change, disconnect } = setup();
    await vi.advanceTimersByTimeAsync(0);
    change({ autoplay: false });
    await vi.advanceTimersByTimeAsync(60000);
    expect(fetcher).toHaveBeenCalledOnce();
    change({ autoplay: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(fetcher).toHaveBeenCalledTimes(2);
    disconnect();
    window.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(60000);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('isolates pending radio requests across account changes', async () => {
    const requests: {
      signal: AbortSignal;
      finish: (response: Response) => void;
    }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_path: string, init: RequestInit) =>
          new Promise<Response>((finish) => {
            requests.push({ signal: init.signal as AbortSignal, finish });
          }),
      ),
    );
    const { player, disconnect } = setup();
    disconnect();
    const { rerender, unmount } = renderHook(
      ({ accountId }) => useAutoplay(player, accountId, emptyLibrary()),
      {
        initialProps: { accountId: 'first-account' },
      },
    );
    await Promise.resolve();
    const first = requests[0]!;
    rerender({ accountId: 'second-account' });
    await Promise.resolve();
    const secondRequest = requests[1]!;
    expect(first.signal.aborted).toBe(true);
    first.finish(response([recommendation]));
    secondRequest.finish(response([second]));
    await vi.waitFor(() =>
      expect(
        player.getSnapshot().autoplayTracks.map((track) => track.id),
      ).toEqual([second.id]),
    );
    unmount();
    window.dispatchEvent(new Event('online'));
    expect(requests).toHaveLength(2);
  });
});
