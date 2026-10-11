import { afterEach, expect, it, vi } from 'vitest';
import { requestJson } from './request';
afterEach(() => vi.useRealTimers());
it('cancels on user abort while parsing the response and removes the deadline', async () => {
  const controller = new AbortController();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      json: async () => {
        controller.abort();
        return {};
      },
    })),
  );
  await expect(requestJson('/test', controller.signal)).rejects.toThrow(
    'CANCELLED_OR_TIMEOUT',
  );
});
it('enforces a deadline without AbortSignal.any/timeout', async () => {
  vi.useFakeTimers();
  let inner!: AbortSignal;
  vi.stubGlobal(
    'fetch',
    vi.fn(
      (_url, init: RequestInit) =>
        new Promise((_done, reject) => {
          inner = init.signal!;
          inner.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    ),
  );
  const request = requestJson('/test', new AbortController().signal, {}, 50);
  const failed = expect(request).rejects.toThrow('aborted');
  await vi.advanceTimersByTimeAsync(51);
  await failed;
  expect(inner.aborted).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});
