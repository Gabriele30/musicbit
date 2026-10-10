import { afterEach, describe, expect, it, vi } from 'vitest';
import { MetadataCache } from './cache.js';

afterEach(() => vi.useRealTimers());
const signal = () => new AbortController().signal;
describe('metadata cache', () => {
  it('deduplicates concurrent requests and clones cached values', async () => {
    const cache = new MetadataCache(1000, 1000);
    const load = vi.fn(async () => ({ title: 'original' }));
    const [first, second] = await Promise.all([
      cache.get('key', load, signal()),
      cache.get('key', load, signal()),
    ]);
    expect(load).toHaveBeenCalledTimes(1);
    expect(first.timing.cache).toBe('miss');
    expect(second.timing.cache).toBe('shared');
    first.value.title = 'changed';
    const hit = await cache.get('key', load, signal());
    expect(hit.value.title).toBe('original');
    expect(hit.timing.cache).toBe('hit');
    cache.close();
  });
  it('expires TTL and evicts the least recently used entry', async () => {
    vi.useFakeTimers();
    const cache = new MetadataCache(100, 1000, 2);
    const load = vi.fn(async () => 1);
    await cache.get('a', load, signal());
    await cache.get('b', load, signal());
    await cache.get('a', load, signal());
    await cache.get('c', load, signal());
    expect((await cache.get('b', load, signal())).timing.cache).toBe('miss');
    await vi.advanceTimersByTimeAsync(101);
    expect((await cache.get('b', load, signal())).timing.cache).toBe('miss');
    cache.close();
  });
  it('cancels one subscriber while keeping the shared request alive', async () => {
    const cache = new MetadataCache(1000, 1000);
    let finish!: (value: string) => void;
    let upstream!: AbortSignal;
    const load = vi.fn((inner: AbortSignal) => {
      upstream = inner;
      return new Promise<string>((resolve) => {
        finish = resolve;
      });
    });
    const controller = new AbortController();
    const first = cache.get('k', load, controller.signal);
    const failed = expect(first).rejects.toMatchObject({ code: 'CANCELLED' });
    const second = cache.get('k', load, signal());
    await Promise.resolve();
    controller.abort();
    await failed;
    expect(upstream.aborted).toBe(false);
    finish('done');
    expect((await second).value).toBe('done');
    cache.close();
  });
  it('aborts upstream when every subscriber leaves and allows immediate replacement', async () => {
    const cache = new MetadataCache(1000, 1000);
    const controller = new AbortController();
    let upstream!: AbortSignal;
    const first = cache.get(
      'k',
      (inner) => {
        upstream = inner;
        return new Promise(() => {});
      },
      controller.signal,
    );
    const failed = expect(first).rejects.toMatchObject({ code: 'CANCELLED' });
    await Promise.resolve();
    controller.abort();
    await failed;
    expect(upstream.aborted).toBe(true);
    expect((await cache.get('k', async () => 'new', signal())).value).toBe(
      'new',
    );
    cache.close();
  });
  it('enforces timeout even if the provider ignores cancellation', async () => {
    vi.useFakeTimers();
    const cache = new MetadataCache(1000, 50);
    let upstream!: AbortSignal;
    const request = cache.get(
      'k',
      (inner) => {
        upstream = inner;
        return new Promise(() => {});
      },
      signal(),
    );
    const failed = expect(request).rejects.toMatchObject({ code: 'TIMEOUT' });
    await vi.advanceTimersByTimeAsync(51);
    await failed;
    expect(upstream.aborted).toBe(true);
    expect(
      (await cache.get('k', async () => 'retry', signal())).timing.cache,
    ).toBe('miss');
    cache.close();
  });
  it('does not cache failures, disabled TTL or missing records', async () => {
    const cache = new MetadataCache(0, 1000);
    const load = vi.fn(async () => {
      throw new Error('failed');
    });
    await expect(cache.get('k', load, signal())).rejects.toThrow('failed');
    await expect(cache.get('k', load, signal())).rejects.toThrow('failed');
    expect(load).toHaveBeenCalledTimes(2);
    expect((await cache.get('k', async () => 1, signal())).timing.cache).toBe(
      'miss',
    );
    expect((await cache.get('k', async () => 1, signal())).timing.cache).toBe(
      'miss',
    );
    cache.close();
  });
  it('bounds concurrent distinct loads and rejects already cancelled callers', async () => {
    const cache = new MetadataCache(1000, 1000, 2, 1);
    const first = cache.get('a', () => new Promise(() => {}), signal());
    const cancelled = expect(first).rejects.toMatchObject({
      code: 'CANCELLED',
    });
    await expect(cache.get('b', async () => 1, signal())).rejects.toMatchObject(
      { code: 'BUSY' },
    );
    const controller = new AbortController();
    controller.abort();
    await expect(
      cache.get('a', async () => 1, controller.signal),
    ).rejects.toMatchObject({ code: 'CANCELLED' });
    cache.close();
    await cancelled;
  });
});
