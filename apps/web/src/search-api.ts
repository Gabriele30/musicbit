import {
  isCatalogItem,
  type CatalogDetail,
  type CatalogKind,
  type DetailResponse,
  type ProvidersResponse,
  type SearchResponse,
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
    !data.items.every(isCatalogItem) ||
    !validTiming(data.timing)
  )
    throw new SearchError('Risposta del catalogo non valida.');
  return data as SearchResponse;
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
    (item.tracks !== undefined &&
      (!Array.isArray(item.tracks) || !item.tracks.every(isCatalogItem)))
  )
    throw new SearchError('Dettagli del catalogo non validi.');
  return data as DetailResponse;
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
