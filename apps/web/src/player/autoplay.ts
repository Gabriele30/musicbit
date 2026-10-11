import { catalogItemToTrack, isCatalogId } from '@musicbit/shared';
import { recommendations } from '../search-api';
import type { PlayerEngine } from './engine';

/** Resolve the next songs ahead of time. The ended path itself stays synchronous. */
export function connectAutoplay(player: PlayerEngine) {
  let seed = '';
  let controller: AbortController | undefined;
  const update = () => {
    const state = player.getSnapshot();
    const id = state.queue[state.index]?.id;
    const next = state.autoplay && id && isCatalogId('track', id) ? id : '';
    if (seed === next) return;
    seed = next;
    controller?.abort();
    if (!next) return;
    const request = new AbortController();
    controller = request;
    player.setRecommendations(next, [], 'loading');
    void recommendations(next, request.signal)
      .then((data) => {
        if (!request.signal.aborted)
          player.setRecommendations(
            next,
            data.items
              .filter((item) => item.playback.available)
              .map(catalogItemToTrack),
          );
      })
      .catch(() => {
        if (!request.signal.aborted)
          player.setRecommendations(next, [], 'error');
      });
  };
  const unsubscribe = player.subscribe(update);
  update();
  return () => {
    controller?.abort();
    unsubscribe();
  };
}
