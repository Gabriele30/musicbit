import {
  isCatalogItem,
  type CatalogDetail,
  type CatalogKind,
  type DetailResponse,
  type ProvidersResponse,
  type SearchResponse,
  type FeedResponse,
  type RecommendationsResponse,
} from '@musicbit/shared';

export class SearchError extends Error {}

async function request(path: string, signal: AbortSignal): Promise<unknown> {
  const controller = new AbortController();
  // AbortSignal.any is absent on older supported Safari releases.
  const cancelled = () => controller.abort();
  signal.addEventListener('abort', cancelled, { once: true });
  if (signal.aborted) cancelled();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(path, {
      signal: controller.signal,
      cache: 'no-store',
    });
    if (!response.ok) {
      const messages: Record<number, string> = {
        400: 'Ricerca non valida.',
        404: 'Elemento non trovato.',
        429: 'Troppe richieste. Attendi e riprova.',
        503: 'Provider non disponibile. Riprova tra poco.',
        504: 'Il provider ha impiegato troppo tempo. Riprova.',
      };
      throw new SearchError(
        messages[response.status] ?? 'Impossibile contattare il catalogo.',
      );
    }
    const data: unknown = await response.json();
    if (controller.signal.aborted)
      throw new DOMException('Aborted', 'AbortError');
    return data;
  } catch (error) {
    if (signal.aborted) throw error;
    if (controller.signal.aborted)
      throw new SearchError('Tempo di attesa scaduto. Riprova.');
    if (error instanceof SearchError) throw error;
    throw new SearchError('Connessione al catalogo non riuscita. Riprova.');
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', cancelled);
  }
}
export async function searchCatalog(
  q: string,
  type: CatalogKind,
  signal: AbortSignal,
): Promise<SearchResponse> {
  const data = (await request(
    `/api/search?${new URLSearchParams({ q, type, limit: '15', provider: 'youtube' })}`,
    signal,
  )) as Partial<SearchResponse> | null;
  if (
    !data ||
    data.provider !== 'youtube' ||
    data.type !== type ||
    !Array.isArray(data.items) ||
    !data.items.every((item) => isCatalogItem(item) && item.kind === type) ||
    !validTiming(data.timing)
  )
    throw new SearchError('Risposta del catalogo non valida.');
  return data as SearchResponse;
}

export type SearchKind = CatalogKind | 'all';
export async function searchAcrossCatalog(
  q: string,
  kind: SearchKind,
  signal: AbortSignal,
  onPartial?: (result: {
    items: import('@musicbit/shared').CatalogItem[];
    missingKinds: CatalogKind[];
  }) => void,
) {
  const kinds: CatalogKind[] =
    kind === 'all' ? ['track', 'artist', 'album'] : [kind];
  const partial: SearchResponse[] = [];
  const responses = await Promise.allSettled(
    kinds.map(async (type) => {
      const result = await searchCatalog(q, type, signal);
      partial.push(result);
      if (!signal.aborted)
        onPartial?.({
          items: partial.flatMap((r) => r.items),
          missingKinds: [],
        });
      return result;
    }),
  );
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
  const successful = responses.flatMap((result) =>
    result.status === 'fulfilled' ? [result.value] : [],
  );
  if (!successful.length) {
    const failure = responses.find((result) => result.status === 'rejected');
    throw failure?.status === 'rejected'
      ? failure.reason
      : new SearchError('Ricerca non disponibile.');
  }
  return {
    items: successful.flatMap((response) => response.items),
    missingKinds: kinds.filter(
      (_, index) => responses[index]?.status === 'rejected',
    ),
  };
}
function validTiming(value: unknown): boolean {
  const timing = value as SearchResponse['timing'] | undefined;
  return (
    !!timing &&
    ['hit', 'miss', 'shared'].includes(timing.cache) &&
    Number.isFinite(timing.elapsedMs) &&
    timing.elapsedMs >= 0
  );
}
export async function catalogDetails(
  kind: CatalogKind,
  id: string,
  signal: AbortSignal,
): Promise<DetailResponse> {
  const data = (await request(
    `/api/catalog/youtube/${kind}/${encodeURIComponent(id)}`,
    signal,
  )) as Partial<DetailResponse> | null;
  const item = data?.item as CatalogDetail | undefined;
  if (
    !data ||
    !isCatalogItem(item) ||
    item.id !== id ||
    item.kind !== kind ||
    !validTiming(data.timing) ||
    [
      ['albums', 'album'],
      ['relatedArtists', 'artist'],
    ].some(([key, kind]) => {
      const values = item[key as 'albums' | 'relatedArtists'];
      return (
        values !== undefined &&
        (!Array.isArray(values) ||
          !values.every((entry) => isCatalogItem(entry) && entry.kind === kind))
      );
    }) ||
    (item.tracks !== undefined &&
      (!Array.isArray(item.tracks) ||
        !item.tracks.every(
          (track) => isCatalogItem(track) && track.kind === 'track',
        )))
  )
    throw new SearchError('Dettagli del catalogo non validi.');
  return data as DetailResponse;
}
export async function homeFeed(signal: AbortSignal): Promise<FeedResponse> {
  const data = (await request(
    '/api/feed',
    signal,
  )) as Partial<FeedResponse> | null;
  if (
    !data ||
    !validTiming(data.timing) ||
    !Array.isArray(data.sections) ||
    data.sections.length > 30 ||
    !data.sections.every(
      (section) =>
        typeof section.id === 'string' &&
        typeof section.title === 'string' &&
        Array.isArray(section.items) &&
        section.items.every(isCatalogItem),
    )
  )
    throw new SearchError('Feed musicale non valido.');
  return data as FeedResponse;
}
export async function recommendations(
  id: string,
  signal: AbortSignal,
): Promise<RecommendationsResponse> {
  const data = (await request(
    `/api/recommendations/${encodeURIComponent(id)}`,
    signal,
  )) as Partial<RecommendationsResponse> | null;
  if (
    !data ||
    data.seedId !== id ||
    !validTiming(data.timing) ||
    !Array.isArray(data.items) ||
    !data.items.every((item) => isCatalogItem(item) && item.kind === 'track')
  )
    throw new SearchError('Suggerimenti non validi.');
  return data as RecommendationsResponse;
}
export async function providerStatus(
  signal: AbortSignal,
): Promise<ProvidersResponse> {
  const data = (await request(
    '/api/providers',
    signal,
  )) as Partial<ProvidersResponse> | null;
  if (
    !data ||
    !Array.isArray(data.providers) ||
    !data.providers.every(
      (item) =>
        item &&
        typeof item.id === 'string' &&
        typeof item.name === 'string' &&
        ['available', 'unverified', 'degraded', 'disabled'].includes(
          item.state,
        ),
    )
  )
    throw new SearchError('Stato provider non disponibile.');
  return data as ProvidersResponse;
}
