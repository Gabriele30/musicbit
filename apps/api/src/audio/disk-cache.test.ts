import { afterEach, expect, it, vi } from 'vitest';
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AudioDiskCache } from './disk-cache.js';
import { AudioResolutionError, AudioStreamService } from './stream-service.js';
import { buildApp } from '../app.js';
const caches: AudioDiskCache[] = [];
const roots: string[] = [];
const apps: ReturnType<typeof buildApp>[] = [];
const id = 'abcdefghijk',
  other = 'lmnopqrstuv',
  third = 'zyxwvutsrqp';
function setup(quota = 5_000_000_000) {
  const root = mkdtempSync(join(tmpdir(), 'musicbit-cache-'));
  roots.push(root);
  const service = new AudioStreamService();
  vi.spyOn(service, 'resolve').mockResolvedValue({
    url: 'https://example.com/audio?private=secret',
    mimeType: 'audio/mp4',
    durationSeconds: 188,
    expiresAt: Date.now() + 60000,
    patches: [{ offset: 1, length: 1 }],
  });
  const fetcher = vi.fn().mockImplementation(
    async () =>
      new Response(new Uint8Array([7, 8, 9]), {
        headers: { 'content-length': '3' },
      }),
  );
  vi.stubGlobal('fetch', fetcher);
  const cache = new AudioDiskCache(root, service, quota, 0);
  caches.push(cache);
  return { root, service, cache, fetcher };
}
afterEach(async () => {
  await Promise.all(apps.splice(0).map((a) => a.close()));
  await Promise.all(caches.splice(0).map((c) => c.close()));
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it('recovers a prefetch transport failure once using a fresh descriptor', async () => {
  const { service, cache, fetcher } = setup();
  const evict = vi.spyOn(service, 'evict');
  fetcher.mockRejectedValueOnce(new TypeError('fetch failed'));
  cache.plan('gabriele', 'phone-device', [id]);
  await vi.waitFor(() => expect(cache.get('gabriele', id)).toBeDefined());
  expect(evict).toHaveBeenCalledWith(id);
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(cache.failure('gabriele', id)).toBeUndefined();
});
it('reports an account-scoped provider restriction promptly and expires the failure backoff', async () => {
  const { service, cache, fetcher } = setup();
  vi.mocked(service.resolve).mockRejectedValue(
    new AudioResolutionError('Access required', 'PROVIDER_RESTRICTED'),
  );
  cache.plan('gabriele', 'phone-device', [id]);
  await vi.waitFor(() =>
    expect(cache.failure('gabriele', id)).toBe('PROVIDER_RESTRICTED'),
  );
  expect(cache.providerRestricted('gabriele')).toBe(true);
  expect(cache.providerRestricted('marco')).toBe(false);
  expect(fetcher).not.toHaveBeenCalled();
  vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 61000);
  expect(cache.failure('gabriele', id)).toBeUndefined();
  expect(cache.providerRestricted('gabriele')).toBe(false);
});

it('persists corrected AAC and duration across restart, isolates users and removes incomplete files', async () => {
  const { root, service, cache, fetcher } = setup();
  cache.plan('gabriele', 'phone-device', [id]);
  await vi.waitFor(() => expect(cache.status('gabriele').tracks).toBe(1));
  expect([...readFileSync(cache.get('gabriele', id)!.path)]).toEqual([7, 0, 9]);
  expect(cache.get('marco', id)).toBeUndefined();
  const directory = readdirSync(root).find(
    (d) => readdirSync(join(root, d)).length,
  )!;
  expect(
    readFileSync(join(root, directory, `${id}.json`), 'utf8'),
  ).not.toContain('secret');
  writeFileSync(join(root, directory, 'incomplete.part'), 'truncated');
  await cache.close();
  fetcher.mockRejectedValue(new Error('Offline'));
  const restarted = new AudioDiskCache(root, service);
  caches.push(restarted);
  const hit = restarted.get('gabriele', id)!;
  expect(hit.durationSeconds).toBe(188);
  expect(hit.size).toBe(3);
  expect(readdirSync(join(root, directory))).not.toContain('incomplete.part');
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it('evicts older unpinned songs, preserves the current window and enforces quota during concurrent downloads', async () => {
  const { cache } = setup(6);
  cache.plan('gabriele', 'phone-device', [id, other]);
  await vi.waitFor(() => expect(cache.status('gabriele').tracks).toBe(2));
  cache.plan('gabriele', 'phone-device', [other, third]);
  await vi.waitFor(() => expect(cache.get('gabriele', third)).toBeDefined());
  expect(cache.get('gabriele', id)).toBeUndefined();
  expect(cache.get('gabriele', other)).toBeDefined();
  expect(cache.status('gabriele').bytes).toBe(6);
});

it('never publishes truncated downloads or retries a failed song in a tight loop', async () => {
  const { cache, fetcher } = setup();
  fetcher.mockImplementation(
    async () =>
      new Response(new Uint8Array([7]), { headers: { 'content-length': '3' } }),
  );
  cache.plan('gabriele', 'phone-device', [id]);
  await vi.waitFor(() => expect(cache.status('gabriele').preparing).toBe(0));
  expect(cache.get('gabriele', id)).toBeUndefined();
  expect(cache.status('gabriele').bytes).toBe(0);
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it('requests an explicit complete Range for fast provider transfer and rejects partial slices', async () => {
  const { cache, fetcher } = setup();
  fetcher.mockImplementation(
    async () =>
      new Response(new Uint8Array([7, 8, 9]), {
        status: 206,
        headers: { 'content-length': '3', 'content-range': 'bytes 0-2/3' },
      }),
  );
  cache.plan('gabriele', 'phone-device', [id]);
  await vi.waitFor(() => expect(cache.status('gabriele').tracks).toBe(1));
  expect(fetcher.mock.calls[0]![1].headers.Range).toBe('bytes=0-67108863');
  fetcher.mockImplementation(
    async () =>
      new Response(new Uint8Array([7, 8, 9]), {
        status: 206,
        headers: { 'content-length': '3', 'content-range': 'bytes 0-2/6' },
      }),
  );
  cache.plan('gabriele', 'phone-device', [other]);
  await vi.waitFor(() => expect(cache.status('gabriele').preparing).toBe(0));
  expect(cache.get('gabriele', other)).toBeUndefined();
});

it('limits preparation to two jobs and cancels obsolete work while respecting another device window', async () => {
  const { cache, service } = setup();
  const signals = new Map<string, AbortSignal>();
  let active = 0,
    peak = 0;
  vi.mocked(service.resolve).mockImplementation(
    (videoId, signal) =>
      new Promise((_resolve, reject) => {
        signals.set(videoId, signal!);
        active++;
        peak = Math.max(peak, active);
        signal!.addEventListener(
          'abort',
          () => {
            active--;
            reject(new Error('Cancelled'));
          },
          { once: true },
        );
      }),
  );
  cache.plan('gabriele', 'phone-device', [id, other, third]);
  await vi.waitFor(() => expect(active).toBe(2));
  cache.plan('gabriele', 'tablet-device', [other]);
  cache.plan('gabriele', 'phone-device', [third]);
  await vi.waitFor(() => expect(signals.has(third)).toBe(true));
  expect(signals.get(id)!.aborted).toBe(true);
  expect(signals.get(other)!.aborted).toBe(false);
  expect(peak).toBe(2);
  await cache.close();
  expect(active).toBe(0);
  expect(cache.status('gabriele').tracks).toBe(0);
});

it('serves authenticated disk Range, HEAD and metadata offline; validates cache plans and rejects cross-account writes', async () => {
  const { cache, service, fetcher } = setup();
  const app = buildApp(
    {},
    undefined,
    undefined,
    service,
    undefined,
    undefined,
    cache,
  );
  apps.push(app);
  const registered = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    headers: { 'x-musicbit-request': '1' },
    payload: { username: 'cache_listener', password: 'test-password' },
  });
  expect(registered.statusCode).toBe(200);
  const cookie = String(registered.headers['set-cookie']).split(';')[0]!;
  const headers = { cookie, 'x-musicbit-request': '1' };
  const plan = await app.inject({
    method: 'POST',
    url: '/api/me/audio-cache',
    headers,
    payload: { device: 'phone-device', ids: [id] },
  });
  expect(plan.json().quotaBytes).toBe(5_000_000_000);
  await vi.waitFor(() =>
    expect(cache.status(registered.json().user.id).tracks).toBe(1),
  );
  fetcher.mockRejectedValue(new Error('Offline'));
  vi.mocked(service.resolve).mockRejectedValue(new Error('Offline'));
  const range = await app.inject({
    url: `/api/audio/${id}`,
    headers: { cookie, range: 'bytes=1-2' },
  });
  expect(range.statusCode).toBe(206);
  expect([...range.rawPayload]).toEqual([0, 9]);
  expect(range.headers['x-musicbit-audio-storage']).toBe('disk');
  expect(range.headers['content-range']).toBe('bytes 1-2/3');
  expect(
    (
      await app.inject({
        method: 'HEAD',
        url: `/api/audio/${id}`,
        headers: { cookie },
      })
    ).headers['content-length'],
  ).toBe('3');
  expect(
    (
      await app.inject({ url: `/api/audio/${id}/info`, headers: { cookie } })
    ).json().durationSeconds,
  ).toBe(188);
  expect(
    (
      await app.inject({
        url: `/api/audio/${id}`,
        headers: { cookie, range: 'bytes=3-' },
      })
    ).statusCode,
  ).toBe(416);
  expect((await app.inject('/api/me/audio-cache')).statusCode).toBe(401);
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/api/me/audio-cache',
        headers: { ...headers, 'x-musicbit-account': 'different-user' },
        payload: { device: 'phone-device', ids: [] },
      })
    ).statusCode,
  ).toBe(401);
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/api/me/audio-cache',
        headers,
        payload: { device: 'phone-device', ids: ['../invalid'] },
      })
    ).statusCode,
  ).toBe(400);
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/api/me/audio-cache',
        headers: { cookie },
        payload: { device: 'phone-device', ids: [] },
      })
    ).statusCode,
  ).toBe(403);
});
