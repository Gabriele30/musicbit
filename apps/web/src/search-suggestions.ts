import type { CatalogItem, Track } from '@musicbit/shared';
export type SearchSuggestion = {
  id: string;
  label: string;
  subtitle: string;
  query?: string;
  track?: Track;
  item?: CatalogItem;
};
const normalize = (s: string) =>
  s
    .trim()
    .toLocaleLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
export function searchSuggestions(
  query: string,
  recent: string[],
  tracks: Track[],
  items: CatalogItem[],
  remote: CatalogItem[],
): SearchSuggestion[] {
  const q = normalize(query);
  if (!q) return [];
  const values: SearchSuggestion[] = [
    ...recent
      .filter((r) => normalize(r).includes(q))
      .map((r) => ({
        id: `q:${r}`,
        label: r,
        subtitle: 'Ricerca recente',
        query: r,
      })),
    ...tracks
      .filter((t) => normalize(`${t.title} ${t.artist}`).includes(q))
      .map((t) => ({
        id: `track:${t.id}`,
        label: t.title,
        subtitle: `${t.artist} · Dalla tua libreria`,
        track: t,
      })),
    ...[...items, ...remote]
      .filter((i) => normalize(`${i.title} ${i.artist}`).includes(q))
      .map((i) => ({
        id: `${i.kind}:${i.id}`,
        label: i.title,
        subtitle:
          i.kind === 'artist'
            ? 'Artista'
            : `${i.artist} · ${i.kind === 'album' ? 'Album' : 'Brano'}`,
        item: i,
      })),
  ];
  return [...new Map(values.map((v) => [v.id, v])).values()].slice(0, 8);
}
