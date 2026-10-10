import { afterEach, describe, expect, it, vi } from 'vitest';
import { catalogDetails, providerStatus, searchCatalog } from './search-api';

const item = {
  id: 'abcdefghijk',
  kind: 'track',
  provider: 'youtube',
  title: 'Title',
  artist: 'Artist',
  sourceUrl: 'https://music.youtube.com/watch?v=abcdefghijk',
  playback: { available: false, reason: 'catalog-only' },
};
const timing = { cache: 'hit', elapsedMs: 1 };
const signal = () => new AbortController().signal;
afterEach(() => {
  vi.useRealTimers();
});
describe('catalog HTTP client', () => {
  it('encodes input and validates normalized metadata separately from audio', async () => {
    const fetcher = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({
            provider: 'youtube',
            type: 'track',
            items: [item],
            timing,
          }),
        ),
    );
    vi.stubGlobal('fetch', fetcher);
    expect((await searchCatalog('A & B', 'track', signal())).items).toEqual([
      item,
    ]);
    expect(fetcher.mock.calls[0]?.[0]).toContain('q=A+%26+B');
  });
  it.each([
    { ...item, audioUrl: 'https://x.example/audio' },
    { ...item, playback: { available: true } },
    { ...item, sourceUrl: 'javascript:alert(1)' },
    { ...item, artworkUrl: 'https://evil.example/image' },
    { ...item, id: 'bad' },
  ])('rejects unsafe metadata %j', async (invalid) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              provider: 'youtube',
              type: 'track',
              items: [invalid],
              timing,
            }),
          ),
      ),
    );
    await expect(searchCatalog('test', 'track', signal())).rejects.toThrow(
      'non valida',
    );
  });
  it('validates detail identity and album track metadata', async () => {
    const fetcher = vi.fn(
      async () => new Response(JSON.stringify({ item, timing })),
    );
    vi.stubGlobal('fetch', fetcher);
    expect((await catalogDetails('track', item.id, signal())).item).toEqual(
      item,
    );
    await expect(
      catalogDetails('track', 'zzzzzzzzzzz', signal()),
    ).rejects.toThrow('non validi');
    fetcher.mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            item: {
              ...item,
              tracks: [{ ...item, playback: { available: true } }],
            },
            timing,
          }),
        ),
    );
    await expect(catalogDetails('track', item.id, signal())).rejects.toThrow(
      'non validi',
    );
  });
  it('hides remote error bodies and validates provider status', async () => {
    const fetcher = vi.fn(
      async () => new Response('secret raw error', { status: 503 }),
    );
    vi.stubGlobal('fetch', fetcher);
    await expect(searchCatalog('test', 'track', signal())).rejects.toThrow(
      'Provider non disponibile',
    );
    fetcher.mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            providers: [
              { id: 'youtube', name: 'YouTube', state: 'unverified' },
            ],
          }),
        ),
    );
    expect((await providerStatus(signal())).providers[0]?.state).toBe(
      'unverified',
    );
    fetcher.mockImplementation(async () => new Response('{}'));
    await expect(providerStatus(signal())).rejects.toThrow('non disponibile');
  });
  it('times out a hanging request and removes the parent listener', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url, options: RequestInit) =>
          new Promise((_resolve, reject) => {
            options.signal?.addEventListener('abort', () =>
              reject(new DOMException('aborted', 'AbortError')),
            );
          }),
      ),
    );
    const controller = new AbortController();
    const removed = vi.spyOn(controller.signal, 'removeEventListener');
    const pending = searchCatalog('test', 'track', controller.signal);
    const failed = expect(pending).rejects.toThrow('Tempo di attesa scaduto');
    await vi.advanceTimersByTimeAsync(12_001);
    await failed;
    expect(removed).toHaveBeenCalledWith('abort', expect.any(Function));
  });
  it('propagates cancellation even if the JSON body arrives late', async () => {
    const controller = new AbortController();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => {
          controller.abort();
          return { provider: 'youtube', type: 'track', items: [item], timing };
        },
      })),
    );
    await expect(
      searchCatalog('test', 'track', controller.signal),
    ).rejects.toThrow('Aborted');
  });
});
