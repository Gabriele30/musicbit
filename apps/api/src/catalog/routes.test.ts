import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CatalogProvider } from '@musicbit/shared';
import { buildApp } from '../app.js';
import { CatalogService } from './service.js';
import { MetadataCache } from './cache.js';

const item = {
  id: 'abcdefghijk',
  provider: 'youtube',
  kind: 'track' as const,
  title: 'Song',
  artist: 'Artist',
  sourceUrl: 'https://music.youtube.com/watch?v=abcdefghijk',
  playback: { available: false as const, reason: 'catalog-only' as const },
};
const apps: ReturnType<typeof buildApp>[] = [];
function fixture(
  options: { fail?: boolean; enabled?: boolean; timeout?: boolean } = {},
) {
  const provider: CatalogProvider = {
    id: 'youtube',
    home: vi.fn(async () => [
      { id: 'discovery', title: 'Discovery', items: [item] },
    ]),
    recommendations: vi.fn(async () => [item]),
    search: vi.fn(async () => {
      if (options.fail)
        throw new Error('private-query cookie=secret remote-payload');
      if (options.timeout) return new Promise(() => {});
      return [item];
    }),
    details: vi.fn(async (_kind, id) => (id === item.id ? item : undefined)),
  };
  const app = buildApp(
    {},
    undefined,
    new CatalogService(
      provider,
      new MetadataCache(1000, 20),
      options.enabled ?? true,
    ),
  );
  apps.push(app);
  return { app, provider };
}
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});
describe('catalog routes', () => {
  it('caches discovery and radio separately and rejects invalid seeds', async () => {
    const { app, provider } = fixture();
    expect((await app.inject('/api/feed')).json().sections[0].title).toBe(
      'Discovery',
    );
    expect((await app.inject('/api/feed')).headers['x-musicbit-cache']).toBe(
      'hit',
    );
    const radio = await app.inject(`/api/recommendations/${item.id}`);
    expect(radio.statusCode).toBe(200);
    expect(radio.json()).toMatchObject({ seedId: item.id, items: [item] });
    expect(
      (await app.inject(`/api/recommendations/${item.id}`)).headers[
        'x-musicbit-cache'
      ],
    ).toBe('hit');
    expect((await app.inject('/api/recommendations/invalid')).statusCode).toBe(
      400,
    );
    expect(provider.home).toHaveBeenCalledOnce();
    expect(provider.recommendations).toHaveBeenCalledOnce();
  });
  it('validates search, supplies defaults and exposes cache timing', async () => {
    const { app, provider } = fixture();
    const first = await app.inject('/api/search?q=test');
    expect(first.statusCode).toBe(200);
    expect(first.headers['x-musicbit-cache']).toBe('miss');
    expect(first.headers['cache-control']).toBe('no-store');
    expect(first.headers['server-timing']).toMatch(/^metadata;dur=/);
    expect(first.json()).toMatchObject({ items: [item], type: 'track' });
    // Semantically identical inputs must share a key regardless of query order.
    const second = await app.inject(
      '/api/search?type=track&provider=youtube&limit=15&q=%20test%20',
    );
    expect(second.headers['x-musicbit-cache']).toBe('hit');
    expect(provider.search).toHaveBeenCalledTimes(1);
  });
  it.each([
    '',
    '?q=',
    '?q=%20%20',
    '?q=test&limit=26',
    '?q=test&limit=1.5',
    '?q=test&type=playlist',
    '?q=test&provider=unknown',
    '?q=test&extra=secret',
    '?q=bad%00input',
    `?q=${'a'.repeat(121)}`,
  ])('rejects invalid query %s before calling the provider', async (query) => {
    const { app, provider } = fixture();
    const response = await app.inject(`/api/search${query}`);
    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('INVALID_INPUT');
    expect(provider.search).not.toHaveBeenCalled();
  });
  it('supports explicit artist/album searches and validates detail identifiers', async () => {
    const { app, provider } = fixture();
    await app.inject('/api/search/artists?q=test');
    await app.inject('/api/search/albums?q=test');
    expect(vi.mocked(provider.search).mock.calls.map(([q]) => q.type)).toEqual([
      'artist',
      'album',
    ]);
    expect(
      (await app.inject(`/api/catalog/youtube/track/${item.id}`)).json().item,
    ).toEqual(item);
    expect(
      (await app.inject('/api/catalog/youtube/track/zzzzzzzzzzz')).statusCode,
    ).toBe(404);
    expect(
      (await app.inject('/api/catalog/youtube/track/invalid')).statusCode,
    ).toBe(400);
    expect(
      (await app.inject('/api/catalog/youtube/playlist/abcdefghijk'))
        .statusCode,
    ).toBe(400);
  });
  it('exposes observed availability without a network probe, safe errors and recovery', async () => {
    const { app, provider } = fixture({ fail: true });
    expect((await app.inject('/api/providers')).json().providers[1].state).toBe(
      'unverified',
    );
    expect(provider.search).not.toHaveBeenCalled();
    const response = await app.inject('/api/search?q=test');
    expect(response.statusCode).toBe(503);
    expect(response.body).not.toContain('secret');
    expect(
      (await app.inject('/api/providers')).json().providers[1],
    ).toMatchObject({ state: 'degraded', lastErrorCode: 'UNAVAILABLE' });
    vi.mocked(provider.search).mockResolvedValue([item]);
    expect((await app.inject('/api/search?q=test')).statusCode).toBe(200);
    expect((await app.inject('/api/providers')).json().providers[1].state).toBe(
      'available',
    );
  });
  it('reports disabled and timeout providers separately', async () => {
    const disabled = fixture({ enabled: false });
    expect((await disabled.app.inject('/api/search?q=test')).json().code).toBe(
      'DISABLED',
    );
    expect(disabled.provider.search).not.toHaveBeenCalled();
    const timeout = fixture({ timeout: true });
    const response = await timeout.app.inject('/api/search?q=test');
    expect(response.statusCode).toBe(504);
    expect(response.json().code).toBe('TIMEOUT');
  });
  it('cancels provider work on a real HTTP client disconnect', async () => {
    let started!: () => void;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    let upstream!: AbortSignal;
    const provider: CatalogProvider = {
      id: 'youtube',
      details: async () => undefined,
      search: (_query, signal) => {
        upstream = signal;
        started();
        return new Promise(() => {});
      },
    };
    const app = buildApp(
      {},
      undefined,
      new CatalogService(provider, new MetadataCache(1000, 1000), true),
    );
    apps.push(app);
    const address = await app.listen({ host: '127.0.0.1', port: 0 });
    const controller = new AbortController();
    const pending = fetch(`${address}/api/search?q=test`, {
      signal: controller.signal,
    });
    const failed = expect(pending).rejects.toThrow();
    await ready;
    controller.abort();
    await failed;
    await vi.waitFor(() => expect(upstream.aborted).toBe(true));
  });
  it('redacts search text and upstream secrets from request and error logs', async () => {
    const lines: string[] = [];
    const provider: CatalogProvider = {
      id: 'youtube',
      details: async () => undefined,
      search: async () => {
        throw new Error('private-cookie-secret');
      },
    };
    const app = buildApp(
      {
        logger: {
          stream: {
            write: (line: string) => {
              lines.push(line);
            },
          },
        },
      },
      undefined,
      new CatalogService(provider, new MetadataCache(1000, 1000), true),
    );
    apps.push(app);
    await app.inject('/api/search?q=sensitive-private-search');
    const logs = lines.join('');
    expect(logs).toContain('UNAVAILABLE');
    expect(logs).not.toContain('sensitive-private-search');
    expect(logs).not.toContain('private-cookie-secret');
  });
});
