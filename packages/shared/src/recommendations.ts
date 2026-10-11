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
/** Deterministic ranking, explicit signals and a cap on any one artist. */
export function buildTasteProfile(library: LocalLibrary) {
  const taste = library.taste ?? emptyTaste();
  const artists = new Map<string, number>();
  const names = new Map<string, string>();
  const ignored = new Set(taste.excludedFromTaste ?? []);
  const remember = (name: string) => {
    const key = name.trim().toLocaleLowerCase();
    names.set(key, name);
    return key;
  };
  for (const artist of library.followedArtists)
    artists.set(remember(artist.title), 6);
  for (const track of library.favorites.filter((t) => !ignored.has(t.id)))
    artists.set(
      remember(track.artist),
      (artists.get(remember(track.artist)) ?? 0) + 3,
    );
  for (const entry of library.history.filter((e) => !ignored.has(e.track.id))) {
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
    .map(([key, artist]) => {
      const preference = taste.artistPreferences?.find(
        (p) => p.artist.trim().toLocaleLowerCase() === key,
      )?.preference;
      const inferredScore = artists.get(key) ?? 0;
      return {
        artist,
        key,
        inferredScore,
        preference: preference ?? ('auto' as const),
        score:
          preference === 'blocked'
            ? -100000
            : inferredScore +
              (preference === 'more' ? 12 : preference === 'less' ? -12 : 0),
        favorites: library.favorites.filter(
          (t) =>
            !ignored.has(t.id) && t.artist.trim().toLocaleLowerCase() === key,
        ).length,
        recent: library.history.filter(
          (h) =>
            !ignored.has(h.track.id) &&
            h.track.artist.trim().toLocaleLowerCase() === key,
        ).length,
        followed: library.followedArtists.some(
          (a) => a.title.trim().toLocaleLowerCase() === key,
        ),
      };
    })
    .sort((a, b) => b.score - a.score || a.artist.localeCompare(b.artist));
}
export function personalRecommendations(
  library: LocalLibrary,
  candidates: CatalogItem[],
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
  const seen = new Set<string>();
  const selected: PersonalSuggestion[] = [];
  const counts = new Map<string, number>();
  const ranked = candidates
    .filter((item) => {
      const key = `${item.artist.toLowerCase()}:${item.title.toLowerCase().replace(/\s+/g, ' ').trim()}`;
      if (
        item.kind !== 'track' ||
        !item.playback.available ||
        blocked.has(item.artist.trim().toLocaleLowerCase()) ||
        taste.dismissed.includes(item.id) ||
        recent.has(item.id) ||
        seen.has(key)
      )
        return false;
      seen.add(key);
      return true;
    })
    .map((item, index) => {
      const weight = artists.get(item.artist.trim().toLocaleLowerCase()) ?? 0;
      const known = library.favorites.some((t) => t.id === item.id);
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
          (signal?.completed ?? 0) * 2 -
          (signal?.skipped ?? 0) * 4,
        reason:
          weight > 0
            ? `Perché ascolti ${item.artist}`
            : 'Una scoperta per variare i tuoi ascolti',
      };
    })
    .sort((a, b) => b.score - a.score || a.index - b.index);
  for (const candidate of ranked) {
    const key = candidate.item.artist.toLocaleLowerCase();
    if ((counts.get(key) ?? 0) >= 2) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
    selected.push({ item: candidate.item, reason: candidate.reason });
    if (selected.length >= 12) break;
  }
  return selected;
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
    !blocked.has(t.artist.trim().toLocaleLowerCase());
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
      tracks: unique([
        ...library.favorites,
        ...library.history.map((h) => h.track),
      ]).sort(
        (a, b) =>
          (taste.signals.find((s) => s.id === b.id)?.completed ?? 0) -
          (taste.signals.find((s) => s.id === a.id)?.completed ?? 0),
      ),
    },
    {
      id: 'discovery',
      name: 'Fuori dal solito',
      description:
        'Brani nuovi per la tua libreria, rispettando le tue preferenze.',
      tracks: unique(ranked.filter((t) => !known.has(t.id))),
    },
  ].filter((mix) => mix.tracks.length > 0);
}
