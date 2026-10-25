import {
  emptyLibrary,
  catalogItemToTrack,
  isCatalogId,
  isCatalogArtwork,
  personalRecommendations,
  recommendationSeeds,
  type CatalogItem,
  type LocalLibrary,
  type RecommendationsResponse,
  type Track,
} from '@musicbit/shared';
import type { CatalogService } from '../catalog/service.js';

export type RadioCatalog = Pick<CatalogService, 'recommendations'> &
  Partial<Pick<CatalogService, 'home' | 'details'>>;

/** A saved Track can use a local placeholder; a network CatalogItem cannot. */
export function cachedCatalogItem(track: Track): CatalogItem {
  const { artworkUrl, artistId, albumId, durationSeconds, ...rest } = track;
  return {
    ...rest,
    kind: 'track',
    provider: 'youtube',
    sourceUrl: `https://music.youtube.com/watch?v=${track.id}`,
    ...(isCatalogArtwork(artworkUrl) ? { artworkUrl } : {}),
    ...(artistId && isCatalogId('artist', artistId) ? { artistId } : {}),
    ...(albumId && isCatalogId('album', albumId) ? { albumId } : {}),
    ...(durationSeconds &&
    Number.isFinite(durationSeconds) &&
    durationSeconds > 0
      ? { durationSeconds }
      : {}),
    playback: { available: true },
  };
}

/** Cached listening history is still usable when the upstream asks for login. */
export function cachedRadio(
  library: LocalLibrary,
  available: (id: string) => boolean,
  recent: string[],
  allowRepeat = true,
): Track[] {
  const unique = new Map(
    [...library.history.map((entry) => entry.track), ...library.favorites]
      .filter(
        (track) =>
          isCatalogId('track', track.id) &&
          track.audioUrl === `/api/audio/${track.id}` &&
          available(track.id),
      )
      .map((track) => [track.id, track]),
  );
  const items: CatalogItem[] = [...unique.values()].map(cachedCatalogItem);
  const excluded = new Set(recent);
  const excludedTracks = [...unique.values()].filter((track) =>
    excluded.has(track.id),
  );
  const fresh = personalRecommendations(
    library,
    items.filter((item) => !excluded.has(item.id)),
    {
      includeRecent: true,
      excludeTracks: excludedTracks,
    },
  ).map(({ item }) => catalogItemToTrack(item));
  if (fresh.length || !allowRepeat) return fresh.slice(0, 3);
  // A very small offline library can legitimately exhaust its recent window.
  return personalRecommendations(library, items, { includeRecent: true })
    .map(({ item }) => catalogItemToTrack(item))
    .slice(0, 3);
}

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
  const seeds = [
    ...new Set([
      seedId,
      ...recommendationSeeds(library).map((track) => track.id),
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
  const current = library.history.find(
    (entry) => entry.track.id === seedId,
  )?.track;
  const context = { previousArtist: current?.artists?.[0] ?? current?.artist };
  let items = personalRecommendations(
    library,
    [...unique.values()],
    context,
  ).map((suggestion) => suggestion.item);
  // A single unavailable/empty radio must not silently terminate infinite play.
  if (!items.length && catalog.home) {
    try {
      const feed = await catalog.home(signal);
      add(feed.sections.flatMap((section) => section.items));
      items = personalRecommendations(
        library,
        [...unique.values()],
        context,
      ).map((suggestion) => suggestion.item);
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
