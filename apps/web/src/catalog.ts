import { isTracksResponse, type TracksResponse } from '@musicbit/shared';
import type { CatalogTiming } from './player/engine';

/** Direct URLs are resolved by the catalog; no second stream-resolution API call. */
export async function loadCatalog(
  signal: AbortSignal,
  report: (timing: CatalogTiming) => void,
  timeoutMs = 10000,
  now = () => performance.now(),
): Promise<TracksResponse> {
  const controller = new AbortController();
  const abort = () => controller.abort(signal.reason);
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) abort();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const timing: CatalogTiming = { startedAt: now() };
  report({ ...timing });
  try {
    const response = await fetch('/api/tracks', { signal: controller.signal });
    timing.headersAt = now();
    timing.serverTiming = response.headers?.get('server-timing') ?? undefined;
    report({ ...timing });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data: unknown = await response.json();
    timing.bodyAt = now();
    controller.signal.throwIfAborted();
    if (!isTracksResponse(data) || !data.tracks.length)
      throw new Error('Catalogo non valido');
    timing.readyAt = now();
    report({ ...timing });
    return data;
  } catch (error) {
    report({
      ...timing,
      error: timedOut
        ? 'Timeout API (10 s)'
        : signal.aborted
          ? 'Richiesta annullata'
          : 'Catalogo non disponibile',
    });
    throw error;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', abort);
  }
}
