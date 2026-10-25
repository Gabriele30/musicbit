import {
  emptyTaste,
  catalogItemToTrack,
  type CatalogItem,
  type LocalLibrary,
  type Track,
} from './index.js';
export interface PersonalSuggestion {
  item: CatalogItem;
  reason: string;
}
const artistKey = (name: string) =>
  name.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
type ArtistCredit = Pick<Track, 'artist' | 'artists'>;
const performers = (track: ArtistCredit) =>
  track.artists?.length ? track.artists : [track.artist];
export function hasArtist(track: ArtistCredit, artist: string) {
  const key = artistKey(artist);
  if (track.artists?.length)
    return track.artists.some((name) => artistKey(name) === key);
  // Legacy saved tracks have a display string only. Match complete credits,
  // while new provider arrays preserve bands whose own name contains commas.
  return `, ${artistKey(track.artist)}, `.includes(`, ${key}, `);
}
const identity = (track: Pick<Track, 'title' | 'artist'>) =>
  `${artistKey(track.artist)}:${track.title.normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, ' ').trim()}`;
/** Deterministic ranking, explicit signals and a cap on any one artist. */
export function buildTasteProfile(library: LocalLibrary) {
  const taste = library.taste ?? emptyTaste();
  const artists = new Map<string, number>();
  const names = new Map<string, string>();
  const ignored = new Set(taste.excludedFromTaste ?? []);
  const remember = (name: string) => {
    const key = artistKey(name);
    names.set(key, name.trim());
    return key;
  };
  for (const artist of library.followedArtists)
    artists.set(remember(artist.title), 6);
  for (const track of library.favorites
    .filter((t) => !ignored.has(t.id))
    .flatMap((track) =>
      performers(track).map((artist) => ({ ...track, artist })),
    ))
    artists.set(
      remember(track.artist),
      (artists.get(remember(track.artist)) ?? 0) + 3,
    );
  for (const entry of library.history
    .filter((e) => !ignored.has(e.track.id))
    .flatMap((entry) =>
      performers(entry.track).map((artist) => ({
        ...entry,
        track: { ...entry.track, artist },
      })),
    )) {
    const outcome = taste.signals.find((s) => s.id === entry.track.id);
    const score =
      1 + (outcome?.completed ?? 0) * 2 - (outcome?.skipped ?? 0) * 2;
    artists.set(
      remember(entry.track.artist),
      (artists.get(remember(entry.track.artist)) ?? 0) +
        Math.max(-4, Math.min(6, score)),
    );
  }
  for (const preference of taste.artistPreferences ?? [])
    remember(preference.artist);
  return [...names]
    .filter(([key]) => key && key !== 'artista non indicato')
    .map(([key, artist]) => {
      const preference = taste.artistPreferences?.find(
        (p) => artistKey(p.artist) === key,
      )?.preference;
      const inferredScore = Math.max(-24, Math.min(24, artists.get(key) ?? 0));
      return {
        artist,
        key,
        inferredScore,
        preference: preference ?? ('auto' as const),
        score:
          preference === 'blocked'
            ? -100000
            : preference === 'more'
              ? Math.max(0, inferredScore) + 12
              : preference === 'less'
                ? Math.min(0, inferredScore) - 12
                : inferredScore,
        favorites: library.favorites.filter(
          (t) => !ignored.has(t.id) && hasArtist(t, artist),
        ).length,
        recent: library.history.filter(
          (h) => !ignored.has(h.track.id) && hasArtist(h.track, artist),
        ).length,
        followed: library.followedArtists.some(
          (a) => artistKey(a.title) === key,
        ),
      };
    })
    .sort((a, b) => b.score - a.score || a.artist.localeCompare(b.artist));
}
export function personalRecommendations(
  library: LocalLibrary,
  candidates: CatalogItem[],
  options: {
    includeRecent?: boolean;
    excludeTracks?: Track[];
    previousArtist?: string;
  } = {},
): PersonalSuggestion[] {
  const taste = library.taste ?? emptyTaste();
  const profile = buildTasteProfile(library);
  const artists = new Map(profile.map((a) => [a.key, a.score]));
  const blocked = new Set(
    profile.filter((a) => a.preference === 'blocked').map((a) => a.key),
  );
  const recent = new Set(
    library.history
      .slice(0, taste.novelty === 'familiar' ? 2 : 10)
      .map((e) => e.track.id),
  );
  const recentSongs = new Set(
    library.history
      .slice(0, taste.novelty === 'familiar' ? 2 : 10)
      .map((entry) => identity(entry.track)),
  );
  const excludedIds = new Set(options.excludeTracks?.map((track) => track.id));
  const excludedSongs = new Set(options.excludeTracks?.map(identity));
  const dismissedSongs = new Set(
    candidates
      .filter((item) => taste.dismissed.includes(item.id))
      .map(identity),
  );
  const seen = new Set<string>();
  const selected: PersonalSuggestion[] = [];
  const counts = new Map<string, number>();
  const ranked = candidates
    .filter((item) => {
      const key = identity(item);
      if (
        item.kind !== 'track' ||
        artistKey(item.artist) === 'artista non indicato' ||
        !item.playback.available ||
        [...blocked].some((name) => hasArtist(item, name)) ||
        taste.dismissed.includes(item.id) ||
        dismissedSongs.has(key) ||
        excludedIds.has(item.id) ||
        excludedSongs.has(key) ||
        (!options.includeRecent &&
          (recent.has(item.id) || recentSongs.has(key))) ||
        seen.has(key)
      )
        return false;
      seen.add(key);
      return true;
    })
    .map((item, index) => {
      const explicit = profile.find(
        (entry) => entry.preference !== 'auto' && hasArtist(item, entry.artist),
      );
      const weight =
        explicit?.score ??
        artists.get(artistKey(item.artists?.[0] ?? item.artist)) ??
        0;
      const known = library.favorites.some(
        (t) => t.id === item.id || identity(t) === identity(item),
      );
      const signal = taste.excludedFromTaste?.includes(item.id)
        ? undefined
        : taste.signals.find((s) => s.id === item.id);
      return {
        item,
        index,
        score:
          (taste.novelty === 'discovery' ? Math.min(3, weight) : weight) +
          (known
            ? taste.novelty === 'familiar'
              ? 8
              : -3
            : taste.novelty === 'discovery'
              ? 4
              : 1) +
          Math.max(
            -20,
            Math.min(
              8,
              (signal?.completed ?? 0) * 2 - (signal?.skipped ?? 0) * 4,
            ),
          ),
        reason:
          profile.find((entry) => hasArtist(item, entry.artist))?.preference ===
          'more'
            ? `Hai chiesto più ${item.artist}`
            : weight > 0
              ? `Perché ascolti ${item.artist}`
              : 'Una scoperta per variare i tuoi ascolti',
      };
    })
    .sort((a, b) => b.score - a.score || a.index - b.index);
  while (ranked.length && selected.length < 12) {
    const previousItem = selected.at(-1)?.item;
    const previous =
      previousItem?.artists?.[0] ??
      previousItem?.artist ??
      options.previousArtist;
    const available = (entry: (typeof ranked)[number]) =>
      (counts.get(artistKey(entry.item.artists?.[0] ?? entry.item.artist)) ??
        0) < 2;
    let next = ranked.findIndex(
      (entry) => available(entry) && !hasArtist(entry.item, previous ?? ''),
    );
    if (next < 0) next = ranked.findIndex(available);
    if (next < 0) break;
    const candidate = ranked.splice(next, 1)[0]!;
    const key = artistKey(candidate.item.artists?.[0] ?? candidate.item.artist);
    if ((counts.get(key) ?? 0) >= 2) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
    selected.push({ item: candidate.item, reason: candidate.reason });
    if (selected.length >= 12) break;
  }
  return selected;
}

/** Recent listening and explicit preferences choose diverse radio starting points. */
export function recommendationSeeds(library: LocalLibrary): Track[] {
  const taste = library.taste ?? emptyTaste();
  const profile = buildTasteProfile(library);
  const blocked = new Set(
    profile
      .filter(
        (entry) =>
          entry.preference === 'blocked' || entry.preference === 'less',
      )
      .map((entry) => entry.key),
  );
  const favorites = new Set(library.favorites.map((track) => track.id));
  const history = new Map(
    library.history.map((entry, index) => [entry.track.id, index]),
  );
  const tracks = [
    ...new Map(
      [
        ...library.history.map((entry) => entry.track),
        ...library.favorites,
      ].map((track) => [track.id, track]),
    ).values(),
  ];
  const ranked = tracks
    .filter(
      (track) =>
        ![...blocked].some((name) => hasArtist(track, name)) &&
        !taste.excludedFromTaste?.includes(track.id) &&
        !taste.dismissed.includes(track.id),
    )
    .map((track) => {
      const signal = taste.signals.find((entry) => entry.id === track.id);
      const index = history.get(track.id);
      return {
        track,
        score:
          (profile.find((entry) => entry.key === artistKey(track.artist))
            ?.preference === 'more'
            ? 8
            : 0) +
          (index === undefined ? 0 : 12 / (1 + index)) +
          (favorites.has(track.id) ? 4 : 0) +
          Math.max(
            -16,
            Math.min(4, (signal?.completed ?? 0) - (signal?.skipped ?? 0) * 3),
          ),
      };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);
  const chosen: Track[] = [];
  const artists = new Set<string>();
  for (const entry of ranked) {
    const key = artistKey(entry.track.artists?.[0] ?? entry.track.artist);
    if (artists.has(key)) continue;
    chosen.push(entry.track);
    artists.add(key);
    if (chosen.length === 3) return chosen;
  }
  for (const entry of ranked) {
    if (!chosen.some((track) => identity(track) === identity(entry.track)))
      chosen.push(entry.track);
    if (chosen.length === 3) break;
  }
  return chosen;
}

export interface AutomaticMix {
  id: string;
  name: string;
  description: string;
  tracks: Track[];
}
/** Derived collections update with the library; saving makes an editable snapshot. */
export function automaticMixes(
  library: LocalLibrary,
  candidates: CatalogItem[],
): AutomaticMix[] {
  const taste = library.taste ?? emptyTaste();
  const blocked = new Set(
    buildTasteProfile(library)
      .filter((p) => p.preference === 'blocked')
      .map((p) => p.key),
  );
  const allowed = (t: Track) =>
    !taste.dismissed.includes(t.id) &&
    ![...blocked].some((name) => hasArtist(t, name));
  const unique = (tracks: Track[]) =>
    [...new Map(tracks.filter(allowed).map((t) => [t.id, t])).values()].slice(
      0,
      30,
    );
  const known = new Set(
    [...library.favorites, ...library.history.map((h) => h.track)].map(
      (t) => t.id,
    ),
  );
  const knownSongs = new Set(
    [...library.favorites, ...library.history.map((entry) => entry.track)].map(
      identity,
    ),
  );
  const ranked = personalRecommendations(
    { ...library, taste: { ...taste, novelty: 'discovery' } },
    candidates,
  ).map((s) => catalogItemToTrack(s.item));
  return [
    {
      id: 'daily',
      name: 'Il tuo Daily Mix',
      description: 'Preferiti, ascolti e nuove proposte, aggiornati con te.',
      tracks: unique([
        ...ranked.slice(0, 8),
        ...library.favorites,
        ...library.history.map((h) => h.track),
      ]),
    },
    {
      id: 'repeat',
      name: 'In loop',
      description: 'I brani che completi più spesso e i tuoi preferiti.',
      tracks: unique(
        [...library.favorites, ...library.history.map((h) => h.track)].sort(
          (a, b) =>
            (taste.signals.find((s) => s.id === b.id)?.completed ?? 0) -
            (taste.signals.find((s) => s.id === a.id)?.completed ?? 0),
        ),
      ),
    },
    {
      id: 'discovery',
      name: 'Fuori dal solito',
      description:
        'Brani nuovi per la tua libreria, rispettando le tue preferenze.',
      tracks: unique(
        ranked.filter((t) => !known.has(t.id) && !knownSongs.has(identity(t))),
      ),
    },
  ].filter((mix) => mix.tracks.length > 0);
}
