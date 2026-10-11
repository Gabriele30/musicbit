import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  isPlaybackSource,
  type PlaybackProvider,
  type PlaybackResolution,
  type PlaybackSource,
} from '@musicbit/shared';
import { AuthorizedDemoPlaybackProvider } from './demo.js';
import { PlaybackResolver } from './resolver.js';
import { buildPlaybackLab } from './lab.js';

const reference = {
  catalogProvider: 'soundhelix-demo',
  catalogId: 'soundhelix-1',
};
const signal = () => new AbortController().signal;
async function source(): Promise<PlaybackSource> {
  const result = await new AuthorizedDemoPlaybackProvider().resolve(
    reference,
    signal(),
  );
  if (result.status !== 'available') throw new Error('Missing fixture');
  return result.source;
}
const disposers: (() => unknown)[] = [];
afterEach(async () => {
  for (const dispose of disposers.splice(0)) await dispose();
  vi.useRealTimers();
});
const resolverFor = (provider: PlaybackProvider, ttl = 100, timeout = 1000) => {
  const resolver = new PlaybackResolver(provider, ttl, timeout);
  disposers.push(() => resolver.close());
  return resolver;
};
describe('authorized playback resolution', () => {
  it('maps exact demo identity and permission without fetching audio', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch');
    const result = await source();
    expect(isPlaybackSource(result)).toBe(true);
    expect(result.authorization.attribution).toContain('Sch');
    expect(result.url).toContain('SoundHelix-Song-1.mp3');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('never maps a YouTube ID or a missing demo by title', async () => {
    const provider = new AuthorizedDemoPlaybackProvider();
    expect(
      await provider.resolve(
        { ...reference, catalogProvider: 'youtube' },
        signal(),
      ),
    ).toEqual({ status: 'unavailable', code: 'NO_AUTHORIZED_SOURCE' });
    expect(
      await provider.resolve({ ...reference, catalogId: 'unknown' }, signal()),
    ).toEqual({ status: 'unavailable', code: 'NOT_FOUND' });
  });
  it('deduplicates, clones and expires cached descriptors', async () => {
    const fixture = await source();
    vi.useFakeTimers();
    const resolve = vi.fn(async () => ({
      status: 'available' as const,
      source: fixture,
    }));
    const resolver = resolverFor({ id: 'test', resolve });
    const [first, second] = await Promise.all([
      resolver.resolve(reference, signal()),
      resolver.resolve(reference, signal()),
    ]);
    expect(resolve).toHaveBeenCalledTimes(1);
    expect([first.timing.cache, second.timing.cache]).toEqual([
      'miss',
      'shared',
    ]);
    if (first.resolution.status === 'available')
      first.resolution.source.title = 'changed';
    const hit = await resolver.resolve(reference, signal());
    expect(hit.timing.cache).toBe('hit');
    expect(hit.resolution).toMatchObject({ source: { title: fixture.title } });
    await vi.advanceTimersByTimeAsync(101);
    expect((await resolver.resolve(reference, signal())).timing.cache).toBe(
      'miss',
    );
  });
  it('caps cache lifetime at source validity minus safety margin', async () => {
    const fixture = await source();
    vi.useFakeTimers();
    fixture.validUntil = new Date(Date.now() + 5100).toISOString();
    const resolve = vi.fn(async () => ({
      status: 'available' as const,
      source: fixture,
    }));
    const resolver = resolverFor({ id: 'test', resolve }, 60000);
    await resolver.resolve(reference, signal());
    expect((await resolver.resolve(reference, signal())).timing.cache).toBe(
      'hit',
    );
    await vi.advanceTimersByTimeAsync(101);
    expect(
      (await resolver.resolve(reference, signal())).resolution,
    ).toMatchObject({ status: 'error', code: 'INVALID_SOURCE' });
    expect(resolve).toHaveBeenCalledTimes(2);
  });
  it.each(['expired', 'identity', 'credentials', 'permission'])(
    'rejects invalid source: %s',
    async (kind) => {
      const fixture = await source();
      if (kind === 'expired')
        fixture.validUntil = new Date(Date.now() - 1000).toISOString();
      if (kind === 'identity') fixture.reference.catalogId = 'other';
      if (kind === 'credentials')
        fixture.url = 'https://user:secret@example.com/a.mp3';
      if (kind === 'permission') fixture.authorization.permission = '';
      const resolver = resolverFor({
        id: 'test',
        resolve: async () => ({ status: 'available', source: fixture }),
      });
      expect(
        (await resolver.resolve(reference, signal())).resolution,
      ).toMatchObject({ status: 'error', code: 'INVALID_SOURCE' });
    },
  );
  it('does not cache unavailability or provider failures, and redacts raw errors', async () => {
    const resolve = vi
      .fn<PlaybackProvider['resolve']>()
      .mockResolvedValueOnce({ status: 'unavailable', code: 'NOT_FOUND' })
      .mockRejectedValueOnce(new Error('cookie=secret'))
      .mockResolvedValueOnce({ status: 'unavailable', code: 'NOT_FOUND' });
    const resolver = resolverFor({ id: 'test', resolve });
    await resolver.resolve(reference, signal());
    const failed = await resolver.resolve(reference, signal());
    expect(failed.resolution).toEqual({
      status: 'error',
      code: 'PROVIDER_UNAVAILABLE',
      retryable: true,
    });
    expect(JSON.stringify(failed)).not.toContain('secret');
    await resolver.resolve(reference, signal());
    expect(resolve).toHaveBeenCalledTimes(3);
  });
  it('cancels one subscriber without aborting the shared provider request', async () => {
    let finish!: (result: PlaybackResolution) => void;
    let upstream!: AbortSignal;
    const resolver = resolverFor({
      id: 'test',
      resolve: (_ref, inner) => {
        upstream = inner;
        return new Promise((done) => {
          finish = done;
        });
      },
    });
    const controller = new AbortController();
    const first = resolver.resolve(reference, controller.signal);
    const second = resolver.resolve(reference, signal());
    await Promise.resolve();
    controller.abort();
    expect((await first).resolution).toMatchObject({ code: 'CANCELLED' });
    expect(upstream.aborted).toBe(false);
    finish({ status: 'available', source: await source() });
    expect((await second).resolution.status).toBe('available');
  });
  it('times out even a provider ignoring abort, and cancels all subscribers upstream', async () => {
    vi.useFakeTimers();
    let upstream!: AbortSignal;
    const resolver = resolverFor(
      {
        id: 'test',
        resolve: (_ref, inner) => {
          upstream = inner;
          return new Promise(() => {});
        },
      },
      100,
      50,
    );
    const first = resolver.resolve(reference, signal());
    await vi.advanceTimersByTimeAsync(51);
    expect((await first).resolution).toMatchObject({ code: 'TIMEOUT' });
    expect(upstream.aborted).toBe(true);
    const controller = new AbortController();
    const second = resolver.resolve(reference, controller.signal);
    await Promise.resolve();
    controller.abort();
    expect((await second).resolution).toMatchObject({ code: 'CANCELLED' });
    expect(upstream.aborted).toBe(true);
  });
});
describe('isolated lab API', () => {
  it('searches authorized demos, resolves them and denies YouTube playback without network', async () => {
    const app = buildPlaybackLab();
    disposers.push(() => app.close());
    const fetch = vi.spyOn(globalThis, 'fetch');
    const search = await app.inject('/__playback/api/search?q=SoundHelix');
    expect(search.statusCode).toBe(200);
    expect(search.json().items).toHaveLength(3);
    const first = await app.inject({
      method: 'POST',
      url: '/__playback/api/resolve',
      payload: reference,
    });
    expect(first.json()).toMatchObject({
      resolution: { status: 'available' },
      timing: { cache: 'miss' },
    });
    expect(first.headers['server-timing']).toMatch(/^resolve;dur=/);
    const unavailable = await app.inject({
      method: 'POST',
      url: '/__playback/api/resolve',
      payload: { catalogProvider: 'youtube', catalogId: 'abc' },
    });
    expect(unavailable.json()).toMatchObject({
      resolution: { status: 'unavailable', code: 'NO_AUTHORIZED_SOURCE' },
    });
    expect(fetch).not.toHaveBeenCalled();
    expect((await app.inject('/api/tracks')).statusCode).toBe(404);
  });
  it.each([
    { ...reference, url: 'https://example.com' },
    { ...reference, catalogId: '../secret' },
    { ...reference, catalogProvider: 'arbitrary' },
  ])('rejects arbitrary URLs and malformed identity %j', async (payload) => {
    const app = buildPlaybackLab();
    disposers.push(() => app.close());
    const result = await app.inject({
      method: 'POST',
      url: '/__playback/api/resolve',
      payload,
    });
    expect(result.statusCode).toBe(400);
    expect(result.json().code).toBe('INVALID_INPUT');
  });
  it('returns structured timeout and safe errors', async () => {
    const resolver = resolverFor({
      id: 'test',
      resolve: async () => ({
        status: 'error',
        code: 'TIMEOUT',
        retryable: true,
      }),
    });
    const app = buildPlaybackLab({}, resolver);
    disposers.push(() => app.close());
    const result = await app.inject({
      method: 'POST',
      url: '/__playback/api/resolve',
      payload: reference,
    });
    expect(result.statusCode).toBe(504);
    expect(result.json().resolution.code).toBe('TIMEOUT');
    expect((await app.inject('/__playback/api/search?q=+++')).statusCode).toBe(
      400,
    );
  });
});
