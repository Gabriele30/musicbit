import { useEffect, useRef } from 'react';
import {
  catalogItemToTrack,
  emptyLibrary,
  isCatalogId,
  isCatalogItem,
  personalRecommendations,
  type CatalogItem,
  type LocalLibrary,
  type RecommendationsResponse,
} from '@musicbit/shared';
import { accountRequest } from '../account';
import { recommendations } from '../search-api';
import type { PlayerEngine } from './engine';

type RadioResponse = RecommendationsResponse & {
  retry?: boolean;
  notice?: string;
};
interface AutoplayOptions {
  accountId?: string;
  getLibrary?: () => LocalLibrary;
}

async function radioRecommendations(
  id: string,
  signal: AbortSignal,
  accountId?: string,
  excluded: string[] = [],
): Promise<RadioResponse> {
  if (!accountId) return recommendations(id, signal);
  const data = await accountRequest<RadioResponse>(
    `/api/me/radio/${encodeURIComponent(id)}?${new URLSearchParams({ exclude: excluded.join(',') })}`,
    undefined,
    'GET',
    signal,
  );
  if (data?.seedId !== id || !Array.isArray(data.items))
    throw new Error('Suggerimenti radio non validi.');
  const items = data.items.filter(
    (item) => isCatalogItem(item) && item.kind === 'track',
  );
  if (data.items.length && !items.length)
    throw new Error('Suggerimenti radio non validi.');
  return { ...data, items };
}

/** Stage progressive audio ahead of time; native HLS extends its own queue on the server. */
export function connectAutoplay(
  player: PlayerEngine,
  options: AutoplayOptions = {},
) {
  let seed = '';
  let controller: AbortController | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let retries = 0;
  let candidates: CatalogItem[] = [];
  let notice: string | undefined;
  let disposed = false;
  let scheduled = false;
  const rank = () => {
    const state = player.getSnapshot();
    const current = state.queue[state.index];
    const queued = new Set(
      player
        .getSnapshot()
        .queue.slice(-200)
        .map((track) => track.id),
    );
    return personalRecommendations(
      options.getLibrary?.() ?? emptyLibrary(),
      candidates.filter((item) => !queued.has(item.id)),
      {
        excludeTracks: state.queue.slice(-200),
        previousArtist: current?.artists?.[0] ?? current?.artist,
      },
    ).map(({ item }) => catalogItemToTrack(item));
  };
  const publish = (id: string) => {
    if (notice) player.setRecommendations(id, rank(), 'ready', notice);
    else player.setRecommendations(id, rank());
  };
  const scheduleRetry = () => {
    clearTimeout(retry);
    if (!seed || disposed) return;
    const delay = [2000, 5000, 10000, 30000][Math.min(retries++, 3)]!;
    retry = setTimeout(() => {
      retry = undefined;
      void resolve();
    }, delay);
  };
  const resolve = async () => {
    clearTimeout(retry);
    retry = undefined;
    if (!seed || disposed) return;
    const id = seed;
    controller?.abort();
    const request = new AbortController();
    controller = request;
    if (!candidates.length) player.setRecommendations(id, [], 'loading');
    try {
      const data = await radioRecommendations(
        id,
        request.signal,
        options.accountId,
        player
          .getSnapshot()
          .queue.slice(-200)
          .map((track) => track.id)
          .filter((id) => isCatalogId('track', id)),
      );
      if (disposed || request.signal.aborted || id !== seed) return;
      candidates = data.items.filter((item) => item.playback.available);
      notice =
        typeof data.notice === 'string' ? data.notice.slice(0, 500) : undefined;
      publish(id);
      if (id !== seed) return;
      // Filtering out queued songs can exhaust a provider response as well.
      if (data.retry || !player.getSnapshot().autoplayTracks.length)
        scheduleRetry();
      else retries = 0;
    } catch {
      if (disposed || request.signal.aborted || id !== seed) return;
      if (!candidates.length) player.setRecommendations(id, [], 'error');
      scheduleRetry();
    }
  };
  const update = () => {
    const state = player.getSnapshot();
    const id = state.queue[state.index]?.id;
    const next =
      state.autoplay &&
      player.getDelivery() !== 'hls' &&
      id &&
      isCatalogId('track', id)
        ? id
        : '';
    if (seed === next) return;
    seed = next;
    controller?.abort();
    clearTimeout(retry);
    candidates = [];
    notice = undefined;
    retries = 0;
    scheduled = Boolean(next);
    if (next)
      queueMicrotask(() => {
        if (disposed || seed !== next) return;
        scheduled = false;
        // Selection installs its native source and calls play in the same stack.
        // Only then decide whether the browser or the HLS server owns radio.
        if (player.getDelivery() === 'hls') update();
        else void resolve();
      });
  };
  const refresh = () => {
    if (!seed || disposed) return;
    if (candidates.length) {
      publish(seed);
      if (!player.getSnapshot().autoplayTracks.length) scheduleRetry();
    } else if (
      !scheduled &&
      (!controller || controller.signal.aborted || retry)
    )
      void resolve();
  };
  const online = () => {
    if (seed && !disposed) void resolve();
  };
  const unsubscribe = player.subscribe(update);
  window.addEventListener('online', online);
  update();
  return Object.assign(
    () => {
      disposed = true;
      controller?.abort();
      clearTimeout(retry);
      unsubscribe();
      window.removeEventListener('online', online);
    },
    { refresh },
  );
}

/** Each account owns its requests and taste context; switching accounts cancels the old radio. */
export function useAutoplay(
  player: PlayerEngine,
  accountId: string | undefined,
  library: LocalLibrary,
) {
  const libraryRef = useRef(library);
  const connection = useRef<ReturnType<typeof connectAutoplay>>(undefined);
  useEffect(() => {
    libraryRef.current = library;
    connection.current?.refresh();
  }, [library]);
  useEffect(() => {
    const disconnect = connectAutoplay(player, {
      accountId,
      getLibrary: () => libraryRef.current,
    });
    connection.current = disconnect;
    return () => {
      connection.current = undefined;
      disconnect();
    };
  }, [player, accountId]);
}
