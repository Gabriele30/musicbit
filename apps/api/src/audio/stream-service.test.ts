import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AudioStreamService,
  type ResolvedAudioStream,
} from './stream-service.js';

const stream = (): ResolvedAudioStream => ({
  url: 'https://example.com/audio.m4a',
  mimeType: 'audio/mp4',
  expiresAt: Date.now() + 3600000,
});
class TestService extends AudioStreamService {
  load = vi
    .fn<(_id: string, signal?: AbortSignal) => Promise<ResolvedAudioStream>>()
    .mockImplementation(async () => stream());
  protected override fetchAndDecipher(id: string, signal?: AbortSignal) {
    return this.load(id, signal);
  }
}
const services: TestService[] = [];
function setup(options?: ConstructorParameters<typeof AudioStreamService>[0]) {
  const service = new TestService(options);
  services.push(service);
  return service;
}
afterEach(() => {
  services.splice(0).forEach((service) => service.close());
  vi.useRealTimers();
});

describe('audio resolution resource bounds', () => {
  it('shares resolution while cancelling each listener independently', async () => {
    const service = setup();
    let finish!: (stream: ResolvedAudioStream) => void;
    service.load.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const first = new AbortController();
    const one = service.resolve('abcdefghijk', first.signal);
    const two = service.resolve('abcdefghijk');
    const cancelled = expect(one).rejects.toMatchObject({ code: 'CANCELLED' });
    await Promise.resolve();
    first.abort();
    await cancelled;
    expect(service.load.mock.calls[0]![1]!.aborted).toBe(false);
    finish(stream());
    await expect(two).resolves.toMatchObject({ mimeType: 'audio/mp4' });
    expect(service.load).toHaveBeenCalledOnce();
  });
  it('aborts abandoned resolution and allows a fresh attempt', async () => {
    const service = setup();
    service.load.mockImplementationOnce(() => new Promise(() => {}));
    const controller = new AbortController();
    const request = service.resolve('abcdefghijk', controller.signal);
    const cancelled = expect(request).rejects.toMatchObject({
      code: 'CANCELLED',
    });
    await Promise.resolve();
    controller.abort();
    await cancelled;
    expect(service.load.mock.calls[0]![1]!.aborted).toBe(true);
    await expect(service.resolve('abcdefghijk')).resolves.toMatchObject({
      mimeType: 'audio/mp4',
    });
    expect(service.load).toHaveBeenCalledTimes(2);
  });
  it('times out even if an underlying provider ignores cancellation', async () => {
    vi.useFakeTimers();
    const service = setup({ timeoutMs: 50 });
    service.load.mockImplementationOnce(() => new Promise(() => {}));
    const failure = expect(
      service.resolve('abcdefghijk'),
    ).rejects.toMatchObject({ code: 'TIMEOUT', status: 504 });
    await vi.advanceTimersByTimeAsync(50);
    await failure;
    await expect(service.resolve('abcdefghijk')).resolves.toMatchObject({
      mimeType: 'audio/mp4',
    });
  });
  it('bounds active resolutions and cached descriptors', async () => {
    const service = setup({ maxConcurrent: 1, capacity: 1 });
    let finish!: (stream: ResolvedAudioStream) => void;
    service.load.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const first = service.resolve('aaaaaaaaaa1');
    await expect(service.resolve('aaaaaaaaaa2')).rejects.toMatchObject({
      code: 'BUSY',
      status: 429,
    });
    finish(stream());
    await first;
    await service.resolve('aaaaaaaaaa2');
    await service.resolve('aaaaaaaaaa1');
    expect(service.load).toHaveBeenCalledTimes(3);
  });
  it('refreshes near-expiry signed URLs and never serves an expired descriptor', async () => {
    const service = setup();
    service.load.mockResolvedValueOnce({
      ...stream(),
      expiresAt: Date.now() + 1000,
    });
    await expect(service.resolve('abcdefghijk')).resolves.toMatchObject({
      mimeType: 'audio/mp4',
    });
    expect(service.load).toHaveBeenCalledTimes(2);
    service.evict('abcdefghijk');
    service.load.mockResolvedValue({ ...stream(), expiresAt: Date.now() - 1 });
    await expect(service.resolve('abcdefghijk')).rejects.toMatchObject({
      code: 'UNAVAILABLE',
    });
  });
});
