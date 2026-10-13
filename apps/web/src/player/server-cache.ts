import { useEffect } from 'react';
import { accountRequest } from '../account';
import { createClientId } from '../client-id';
import type { PlayerEngine } from './engine';

export function cacheWindow(state: ReturnType<PlayerEngine['getSnapshot']>) {
  const current = state.queue[state.index];
  if (!current) return [];
  const upcoming =
    state.repeat === 'one'
      ? []
      : state.queue.slice(state.index + 1, state.index + 11);
  if (upcoming.length < 10 && state.repeat === 'all')
    upcoming.push(
      ...state.queue.slice(0, Math.min(state.index, 10 - upcoming.length)),
    );
  if (
    upcoming.length < 10 &&
    state.autoplay &&
    state.repeat !== 'one' &&
    state.repeat !== 'all'
  )
    upcoming.push(...state.autoplayTracks.slice(0, 10 - upcoming.length));
  return [
    ...new Set(
      [
        current,
        ...upcoming,
        ...state.queue.slice(Math.max(0, state.index - 2), state.index),
      ]
        .map(
          (t) => t.audioUrl.match(/^\/api\/audio\/([A-Za-z0-9_-]{11})$/)?.[1],
        )
        .filter((id): id is string => !!id),
    ),
  ];
}

/** Queue hints only; the server downloads audio without consuming the phone's bandwidth. */
export function useServerCache(player: PlayerEngine, accountId?: string) {
  useEffect(() => {
    if (!accountId) return;
    const controller = new AbortController(),
      device = createClientId();
    let last = '',
      retryAfter = 0,
      sending = false,
      disposed = false;
    const update = async (force = false) => {
      const ids = cacheWindow(player.getSnapshot()),
        key = ids.join(',');
      if (
        sending ||
        disposed ||
        Date.now() < retryAfter ||
        (!force && key === last)
      )
        return;
      sending = true;
      try {
        await accountRequest(
          '/api/me/audio-cache',
          { device, ids },
          'POST',
          controller.signal,
        );
        if (disposed) return;
        last = key;
      } catch {
        retryAfter = Date.now() + 15000;
        /* Cache availability never blocks playback. Retry on the next queue update. */
      } finally {
        sending = false;
      }
      if (!disposed && cacheWindow(player.getSnapshot()).join(',') !== key)
        void update();
    };
    const unsubscribe = player.subscribe(() => {
      void update();
    });
    void update();
    const heartbeat = setInterval(() => {
      void update(true);
    }, 5 * 60000);
    return () => {
      disposed = true;
      controller.abort();
      clearInterval(heartbeat);
      unsubscribe();
    };
  }, [player, accountId]);
}
