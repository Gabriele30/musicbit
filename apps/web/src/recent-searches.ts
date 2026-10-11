export const RECENT_SEARCHES_KEY = 'musicbit.searches.v1';
const limit = 8;

export function readRecentSearches(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_SEARCHES_KEY);
    if (!raw || raw.length > 4000) return [];
    const data: unknown = JSON.parse(raw);
    return Array.isArray(data) && data.every((q) => typeof q === 'string')
      ? [
          ...new Set(
            data
              .map((q: string) => q.trim())
              .filter((q) => q.length >= 2 && q.length <= 120),
          ),
        ].slice(0, limit)
      : [];
  } catch {
    return [];
  }
}

/** Search history is optional; unavailable storage must never prevent listening. */
export function saveRecentSearches(queries: string[]) {
  try {
    if (queries.length)
      localStorage.setItem(
        RECENT_SEARCHES_KEY,
        JSON.stringify(queries.slice(0, limit)),
      );
    else localStorage.removeItem(RECENT_SEARCHES_KEY);
  } catch {
    /* Private browsing and full storage can disable persistence. */
  }
}

export function rememberSearch(queries: string[], query: string): string[] {
  const value = query.trim().slice(0, 120);
  return value.length < 2
    ? queries
    : [
        value,
        ...queries.filter(
          (q) => q.toLocaleLowerCase() !== value.toLocaleLowerCase(),
        ),
      ].slice(0, limit);
}
