import { describe, expect, it, vi } from 'vitest';
import { loadCatalog } from './catalog';
import type { CatalogTiming } from './player/engine';

describe('catalog request diagnostics', () => {
  it('records failed HTTP headers and hides response internals', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('secret', { status: 503 })),
    );
    const timings: CatalogTiming[] = [];
    await expect(
      loadCatalog(new AbortController().signal, (t) => timings.push(t)),
    ).rejects.toThrow('HTTP 503');
    expect(timings.at(-1)?.headersAt).toBeDefined();
    expect(timings.at(-1)?.error).toBe('Catalogo non disponibile');
    expect(JSON.stringify(timings)).not.toContain('secret');
  });
  it('aborts a hanging fetch on timeout', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url, { signal }: { signal: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () =>
              reject(new DOMException('aborted', 'AbortError')),
            );
          }),
      ),
    );
    const timings: CatalogTiming[] = [];
    await expect(
      loadCatalog(new AbortController().signal, (t) => timings.push(t), 10),
    ).rejects.toThrow('aborted');
    expect(timings.at(-1)?.error).toContain('Timeout');
  });
  it('cancels superseded requests and rejects a body that arrives after cancellation', async () => {
    const controller = new AbortController();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => {
          controller.abort();
          return {};
        },
      }),
    );
    const timings: CatalogTiming[] = [];
    await expect(
      loadCatalog(controller.signal, (t) => timings.push(t)),
    ).rejects.toThrow();
    expect(timings.at(-1)?.error).toBe('Richiesta annullata');
    expect(timings.at(-1)?.readyAt).toBeUndefined();
  });
});
