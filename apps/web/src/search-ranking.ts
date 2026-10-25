import type { CatalogItem } from '@musicbit/shared';
const normalize = (value: string) =>
  value
    .toLocaleLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
export function rankSearchResults(items: CatalogItem[], query: string) {
  const q = normalize(query);
  const score = (item: CatalogItem) => {
    const title = normalize(item.title),
      artist = normalize(item.artist ?? '');
    return (
      (title === q
        ? 100
        : title.startsWith(`${q} `)
          ? 70
          : title.includes(q)
            ? 40
            : 0) +
      (artist === q ? 65 : artist.startsWith(`${q} `) ? 55 : 0) +
      (item.kind === 'artist' && title === q ? 5 : 0)
    );
  };
  return [
    ...new Map(items.map((item) => [`${item.kind}:${item.id}`, item])).values(),
  ].sort((a, b) => score(b) - score(a));
}
