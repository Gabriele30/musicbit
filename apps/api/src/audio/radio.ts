import {
  emptyLibrary,
  isCatalogId,
  personalRecommendations,
  type CatalogItem,
  type LocalLibrary,
  type RecommendationsResponse,
} from '@musicbit/shared';
import type { CatalogService } from '../catalog/service.js';

export type RadioCatalog = Pick<CatalogService, 'recommendations'> &
  Partial<Pick<CatalogService, 'home'>>;

/** Re-evaluate listening feedback at each refill, rather than fixing a mix at start. */
export async function personalRadio(
  catalog: RadioCatalog,
  seedId: string,
  signal: AbortSignal,
  library: LocalLibrary = emptyLibrary(),
  excludedIds: Iterable<string> = [],
): Promise<RecommendationsResponse & { partial: boolean; retry: boolean }> {
  signal.throwIfAborted();
  const started = performance.now();
  const ignored = new Set(library.taste?.excludedFromTaste ?? []);
  const seeds = [
    ...new Set([
      seedId,
      ...library.history
        .filter((entry) => !ignored.has(entry.track.id))
        .map((entry) => entry.track.id),
      ...library.favorites
        .filter((track) => !ignored.has(track.id))
        .map((track) => track.id),
    ]),
  ]
    .filter((id) => isCatalogId('track', id))
    .slice(0, 3);
  const outcomes = await Promise.allSettled(
    seeds.map((id) => catalog.recommendations(id, signal)),
  );
  signal.throwIfAborted();
  const excluded = new Set(excludedIds);
  excluded.add(seedId);
  const unique = new Map<string, CatalogItem>();
  const add = (items: CatalogItem[]) => {
    for (const item of items)
      if (
        item.kind === 'track' &&
        item.playback.available &&
        isCatalogId('track', item.id) &&
        !excluded.has(item.id) &&
        (!item.audioUrl || item.audioUrl === `/api/audio/${item.id}`)
      )
        unique.set(item.id, item);
  };
  for (const outcome of outcomes)
    if (outcome.status === 'fulfilled') add(outcome.value.items);
  let partial = outcomes.some((outcome) => outcome.status === 'rejected');
  let items = personalRecommendations(library, [...unique.values()]).map(
    (suggestion) => suggestion.item,
  );
  // A single unavailable/empty radio must not silently terminate infinite play.
  if (!items.length && catalog.home) {
    try {
      const feed = await catalog.home(signal);
      add(feed.sections.flatMap((section) => section.items));
      items = personalRecommendations(library, [...unique.values()]).map(
        (suggestion) => suggestion.item,
      );
    } catch {
      partial = true;
    }
  }
  signal.throwIfAborted();
  return {
    seedId,
    items,
    partial,
    retry: !items.length,
    timing: {
      cache:
        outcomes.length > 0 &&
        outcomes.every(
          (outcome) =>
            outcome.status === 'fulfilled' &&
            outcome.value.timing.cache === 'hit',
        )
          ? 'hit'
          : 'miss',
      elapsedMs: performance.now() - started,
    },
  };
}
