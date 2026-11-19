import {
  emptyLibrary,
  catalogItemToTrack,
  isCatalogId,
  isCatalogArtwork,
  personalRecommendations,
  primaryArtistKey,
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
      random: Math.random,
    },
  ).map(({ item }) => catalogItemToTrack(item));
  if (fresh.length || !allowRepeat) return fresh.slice(0, 3);
  // A very small offline library can legitimately exhaust its recent window.
  const oldestFirst = new Map(recent.map((id, index) => [id, index]));
  return personalRecommendations(library, items, { includeRecent: true })
    .map(({ item }) => catalogItemToTrack(item))
    .sort(
      (a, b) => (oldestFirst.get(a.id) ?? -1) - (oldestFirst.get(b.id) ?? -1),
    )
    .slice(0, 3);
}

/** Re-evaluate listening feedback at each refill, rather than fixing a mix at start. */
export async function personalRadio(
  catalog: RadioCatalog,
  seedId: string,
  signal: AbortSignal,
  library: LocalLibrary = emptyLibrary(),
  excludedIds: Iterable<string> = [],
  options: {
    /** Songs already in this listening session, oldest first. */
    recentTracks?: Track[];
    random?: () => number;
    /** Songs in a temporary failure backoff: never let them take a slot. */
    unavailable?: (id: string) => boolean;
  } = {},
): Promise<RecommendationsResponse & { partial: boolean; retry: boolean }> {
  signal.throwIfAborted();
  const started = performance.now();
  const random = options.random ?? Math.random;
  const recentTracks = options.recentTracks ?? [];
  const excluded = new Set(excludedIds);
  excluded.add(seedId);
  const freshSeeds = recommendationSeeds(
    {
      ...library,
      history: library.history.filter((entry) => !excluded.has(entry.track.id)),
      favorites: library.favorites.filter((track) => !excluded.has(track.id)),
    },
    8,
  );
  const pick = <T>(items: T[]) =>
    items.length ? items[Math.floor(random() * items.length)] : undefined;
  // Seeds: the current song, one recent song of this session (the radio
  // drifts with the listening instead of restarting from the same profile
  // tracks) and one profile seed chosen at random among the strongest.
  // Production simulation: fixed top profile seeds made sessions started
  // from different songs open with nearly the same tracks.
  const profileSeeds = (
    freshSeeds.length ? freshSeeds : recommendationSeeds(library, 8)
  )
    .map((track) => ({ track, order: random() }))
    .sort((a, b) => a.order - b.order)
    .map(({ track }) => track.id);
  const sessionSeed = pick(
    recentTracks
      .slice(-6)
      .filter((track) => track.id !== seedId)
      .map((track) => track.id),
  );
  const seeds = [
    ...new Set(
      [seedId, sessionSeed, ...profileSeeds].filter((id): id is string => !!id),
    ),
  ]
    .filter((id) => isCatalogId('track', id))
    .slice(0, 3);
  const outcomes = await Promise.allSettled(
    seeds.map((id) => catalog.recommendations(id, signal)),
  );
  signal.throwIfAborted();
  const unique = new Map<string, CatalogItem>();
  const add = (items: CatalogItem[]) => {
    for (const item of items)
      if (
        item.kind === 'track' &&
        item.playback.available &&
        isCatalogId('track', item.id) &&
        !excluded.has(item.id) &&
        !options.unavailable?.(item.id) &&
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
  const previous = current ?? recentTracks.at(-1);
  const context = {
    previousArtist: previous?.artists?.[0] ?? previous?.artist,
    random,
    excludeTracks: recentTracks,
    recentArtists: recentTracks.map(primaryArtistKey),
  };
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
