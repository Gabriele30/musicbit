import {
  buildTasteProfile,
  hasArtist,
  type LocalLibrary,
} from '@musicbit/shared';

export function quickPicks(library: LocalLibrary) {
  const blocked = new Set(
    buildTasteProfile(library)
      .filter((a) => a.preference === 'blocked')
      .map((a) => a.key),
  );
  const ignored = new Set([
    ...(library.taste?.excludedFromTaste ?? []),
    ...(library.taste?.dismissed ?? []),
  ]);
  const tracks = [
    ...new Map(
      [...library.history.map((h) => h.track), ...library.favorites].map(
        (t) => [t.id, t],
      ),
    ).values(),
  ];
  return tracks
    .filter(
      (t) =>
        !ignored.has(t.id) && ![...blocked].some((name) => hasArtist(t, name)),
    )
    .map((track) => {
      const recent = library.history.findIndex((h) => h.track.id === track.id);
      const signals = library.taste?.signals.find((s) => s.id === track.id);
      return {
        track,
        score:
          (recent < 0 ? 0 : 20 / (recent + 1)) +
          (library.favorites.some((t) => t.id === track.id) ? 8 : 0) +
          Math.min(10, (signals?.completed ?? 0) * 2) -
          Math.min(20, (signals?.skipped ?? 0) * 3),
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .map((v) => v.track);
}
