import { afterEach, expect, it, vi } from 'vitest';
import { UpcomingAudio } from './upcoming-audio';

const ready = vi.fn();
const caches: UpcomingAudio[] = [];
function setup() {
  const cache = new UpcomingAudio((event) => {
    if (event === 'ready') ready();
  });
  caches.push(cache);
  return cache;
}
function complete() {
  return new Response(new Uint8Array([1, 2, 3]), {
    status: 206,
    headers: {
      'Content-Type': 'audio/mp4',
      'X-MusicBit-Audio-Cache': 'warming',
      'Content-Length': '3',
      'Content-Range': 'bytes 0-2/3',
    },
  });
}
afterEach(() => {
  caches.splice(0).forEach((cache) => cache.clear());
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it('warms only one complete upcoming song without starting playback', async () => {
  const cache = setup();
  const fetcher = vi.fn().mockResolvedValue(complete());
  vi.stubGlobal('fetch', fetcher);
  cache.prepare('/api/audio/aaaaaaaaaaa');
  await vi.waitFor(() => expect(ready).toHaveBeenCalledOnce());
  cache.prepare('/api/audio/aaaaaaaaaaa');
  expect(fetcher).toHaveBeenCalledOnce();
  expect(fetcher.mock.calls[0]![1].headers.Range).toBe('bytes=0-16777215');
  expect(cache.take('/api/audio/aaaaaaaaaaa')).toBe(true);
  cache.clear();
});

it.each([
  ['partial', { 'Content-Length': '3', 'Content-Range': 'bytes 0-2/100' }],
  [
    'oversized',
    {
      'Content-Length': '20000000',
      'Content-Range': 'bytes 0-19999999/20000000',
    },
  ],
  ['truncated', { 'Content-Length': '4', 'Content-Range': 'bytes 0-3/4' }],
])(
  'never substitutes a %s response for the complete next song',
  async (_label, headers) => {
    const cache = setup();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(new Uint8Array([1, 2, 3]), {
          status: 206,
          headers: { 'Content-Type': 'audio/mp4', ...headers },
        }),
      ),
    );
    cache.prepare('/api/audio/aaaaaaaaaaa');
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(cache.take('/api/audio/aaaaaaaaaaa')).toBe(false);
    expect(ready).not.toHaveBeenCalled();
  },
);

it('aborts obsolete requests and clears ready audio when the queue has no successor', async () => {
  const cache = setup();
  let finish!: (response: Response) => void;
  const fetcher = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValueOnce(complete());
  vi.stubGlobal('fetch', fetcher);
  cache.prepare('/api/audio/aaaaaaaaaaa');
  const signal = fetcher.mock.calls[0]![1].signal as AbortSignal;
  cache.prepare('/api/audio/bbbbbbbbbbb');
  finish(complete());
  await vi.waitFor(() => expect(ready).toHaveBeenCalledOnce());
  expect(signal.aborted).toBe(true);
  expect(cache.take('/api/audio/aaaaaaaaaaa')).toBe(false);
  cache.prepare(undefined);
  expect(cache.take('/api/audio/bbbbbbbbbbb')).toBe(false);
});
