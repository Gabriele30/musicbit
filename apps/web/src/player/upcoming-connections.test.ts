import { afterEach, expect, it, vi } from 'vitest';
import { UpcomingConnections } from './upcoming-connections';
const instances: UpcomingConnections[] = [];
const sources = Array.from(
  { length: 12 },
  (_, i) => `/api/audio/${String(i).padStart(11, '0')}`,
);
const response = () =>
  new Response(new Uint8Array([1, 2, 3]), {
    status: 206,
    headers: {
      'Content-Length': '3',
      'Content-Range': 'bytes 0-2/3000000',
      'Content-Type': 'audio/mp4',
    },
  });
afterEach(() => {
  for (const instance of instances.splice(0)) instance.clear();
  vi.unstubAllGlobals();
});
it('primes at most ten distinct local prefixes with two concurrent requests and no repeat downloads', async () => {
  let active = 0,
    peak = 0;
  const fetcher = vi.fn(async () => {
    active++;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active--;
    return response();
  });
  vi.stubGlobal('fetch', fetcher);
  const notify = vi.fn(),
    primer = new UpcomingConnections(notify);
  instances.push(primer);
  primer.prepare([...sources, sources[0]!, 'https://external.test/audio']);
  await vi.waitFor(() => expect(notify).toHaveBeenCalledTimes(10));
  expect(peak).toBe(2);
  expect(fetcher).toHaveBeenCalledTimes(10);
  expect(fetcher.mock.calls[0]?.length).toBe(2);
  primer.prepare(sources.slice(0, 10));
  expect(fetcher).toHaveBeenCalledTimes(10);
});
it('aborts obsolete work, rejects full responses and truncated prefixes without reporting readiness', async () => {
  const signals: AbortSignal[] = [];
  const fetcher = vi.fn((_source: string, options: RequestInit) => {
    expect(options.headers).toEqual({ Range: 'bytes=0-65535' });
    const signal = options.signal!;
    signals.push(signal);
    return new Promise<Response>((_resolve, reject) =>
      signal.addEventListener('abort', () =>
        reject(new DOMException('Cancelled', 'AbortError')),
      ),
    );
  });
  vi.stubGlobal('fetch', fetcher);
  const notify = vi.fn(),
    primer = new UpcomingConnections(notify);
  instances.push(primer);
  primer.prepare(sources.slice(0, 2));
  primer.clear();
  expect(signals.every((signal) => signal.aborted)).toBe(true);
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  fetcher
    .mockResolvedValueOnce(new Response(new Uint8Array([1]), { status: 200 }))
    .mockResolvedValueOnce(
      new Response(new Uint8Array([1]), {
        status: 206,
        headers: {
          'Content-Length': '3',
          'Content-Range': 'bytes 0-2/10',
          'Content-Type': 'audio/mp4',
        },
      }),
    );
  primer.prepare(sources.slice(2, 4));
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(4));
  await new Promise((resolve) => setTimeout(resolve, 15));
  expect(notify).not.toHaveBeenCalled();
});
