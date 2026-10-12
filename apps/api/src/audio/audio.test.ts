import { afterEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { get } from 'node:http';
import { registerAudioRoutes } from './routes.js';
import { buildApp } from '../app.js';
import {
  AudioStreamService,
  AudioResolutionError,
  type ResolvedAudioStream,
} from './stream-service.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const resolved: ResolvedAudioStream = {
  url: 'https://example.com/audio.mp4?secret=signed-token',
  mimeType: 'audio/mp4',
  expiresAt: Date.now() + 3600000,
};

describe('Audio routes and streaming', () => {
  it('serves canonical cached bytes and Range/HEAD without resolving or contacting an unavailable upstream again', async () => {
    const service = new AudioStreamService();
    const resolve = vi
      .spyOn(service, 'resolve')
      .mockResolvedValue({ ...resolved, patches: [{ offset: 1, length: 1 }] });
    const upstream = vi.fn().mockResolvedValue(
      new Response(new Uint8Array([7, 8, 9]), {
        status: 206,
        headers: {
          'Content-Length': '3',
          'Content-Range': 'bytes 0-2/3',
          'Content-Type': 'audio/mp4',
        },
      }),
    );
    vi.stubGlobal('fetch', upstream);
    const app = buildApp({}, undefined, undefined, service);
    const first = await app.inject({
      url: '/api/audio/abcdefghijk',
      headers: { range: 'bytes=0-16777215' },
    });
    expect([...first.rawPayload]).toEqual([7, 0, 9]);
    upstream.mockRejectedValue(new Error('Upstream is offline'));
    const next = await app.inject({
      url: '/api/audio/abcdefghijk',
      headers: { range: 'bytes=1-2' },
    });
    expect(next.statusCode).toBe(206);
    expect(next.headers['x-musicbit-audio-cache']).toBe('hit');
    expect(next.headers['content-range']).toBe('bytes 1-2/3');
    expect([...next.rawPayload]).toEqual([0, 9]);
    const head = await app.inject({
      method: 'HEAD',
      url: '/api/audio/abcdefghijk',
    });
    expect(head.statusCode).toBe(200);
    expect(head.headers['content-length']).toBe('3');
    expect(head.body).toBe('');
    const invalid = await app.inject({
      url: '/api/audio/abcdefghijk',
      headers: { range: 'bytes=3-' },
    });
    expect(invalid.statusCode).toBe(416);
    expect(resolve).toHaveBeenCalledOnce();
    expect(upstream).toHaveBeenCalledOnce();
    await app.close();
  });
  it('reports bounded metadata timeouts as retryable audio errors', async () => {
    const service = new AudioStreamService();
    vi.spyOn(service, 'resolve').mockRejectedValue(
      new AudioResolutionError('Riprova.', 'TIMEOUT', 504),
    );
    const app = buildApp({}, undefined, undefined, service);
    const response = await app.inject('/api/audio/olqW16cSEVs/info');
    expect(response.statusCode).toBe(504);
    expect(response.json()).toEqual({ code: 'TIMEOUT', error: 'Riprova.' });
    await app.close();
  });
  it('returns duration metadata without exposing a signed stream URL', async () => {
    const service = new AudioStreamService();
    vi.spyOn(service, 'resolve').mockResolvedValue({
      ...resolved,
      durationSeconds: 188,
    });
    const app = buildApp({}, undefined, undefined, service);
    const response = await app.inject('/api/audio/olqW16cSEVs/info');
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ durationSeconds: 188 });
    expect(response.body).not.toContain('signed-token');
    await app.close();
  });
  it('serves a canonical AAC representation for partial ranges with matching length', async () => {
    const service = new AudioStreamService();
    vi.spyOn(service, 'resolve').mockResolvedValue({
      ...resolved,
      patches: [{ offset: 10, length: 4 }],
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(new Uint8Array([8, 9, 10, 11, 12]), {
          status: 206,
          headers: {
            'content-range': 'bytes 8-12/20',
            'content-length': '5',
            etag: 'original-file',
            'accept-ranges': 'bytes',
          },
        }),
      ),
    );
    const app = buildApp({}, undefined, undefined, service);
    const response = await app.inject({
      url: '/api/audio/abcdefghijk',
      headers: { range: 'bytes=8-12' },
    });
    expect(response.statusCode).toBe(206);
    expect([...response.rawPayload]).toEqual([8, 9, 0, 0, 0]);
    expect(response.headers['content-length']).toBe('5');
    expect(response.headers['content-range']).toBe('bytes 8-12/20');
    expect(response.headers.etag).toBeUndefined();
    await app.close();
  });
  it('rejects malformed multi-ranges before resolving a stream', async () => {
    const service = new AudioStreamService();
    const resolve = vi.spyOn(service, 'resolve');
    const app = buildApp({}, undefined, undefined, service);
    const response = await app.inject({
      url: '/api/audio/abcdefghijk',
      headers: { range: 'bytes=0-1,4-5' },
    });
    expect(response.statusCode).toBe(400);
    expect(resolve).not.toHaveBeenCalled();
    await app.close();
  });
  it('releases a forbidden response and retries once, preserving suffix ranges', async () => {
    const service = new AudioStreamService();
    vi.spyOn(service, 'resolve').mockResolvedValue(resolved);
    const evict = vi.spyOn(service, 'evict');
    const cancel = vi.fn();
    const first = new Response(new ReadableStream({ cancel }), { status: 403 });
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(
        new Response(new Uint8Array(2), {
          status: 206,
          headers: {
            'content-range': 'bytes 8-9/10',
            'content-length': '2',
            'accept-ranges': 'bytes',
          },
        }),
      );
    vi.stubGlobal('fetch', fetcher);
    const app = buildApp({}, undefined, undefined, service);
    const response = await app.inject({
      url: '/api/audio/abcdefghijk',
      headers: { range: 'bytes=-2', 'if-range': '"etag"' },
    });
    expect(response.statusCode).toBe(206);
    expect(response.rawPayload.length).toBe(2);
    expect(cancel).toHaveBeenCalledOnce();
    expect(evict).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[1]![1].headers).toMatchObject({
      Range: 'bytes=-2',
      'If-Range': '"etag"',
    });
    await app.close();
  });
  it('never labels upstream error HTML as audio or caches a failure', async () => {
    const service = new AudioStreamService();
    vi.spyOn(service, 'resolve').mockResolvedValue(resolved);
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response('secret upstream page', { status: 500 }),
        ),
    );
    const app = buildApp({}, undefined, undefined, service);
    const response = await app.inject('/api/audio/abcdefghijk');
    expect(response.statusCode).toBe(502);
    expect(response.headers['content-type']).toContain('application/json');
    expect(response.headers['cache-control']).toContain('no-store');
    expect(response.body).not.toContain('secret');
    await app.close();
  });
  it('preserves the upstream 416 Content-Range without forwarding an error body', async () => {
    const service = new AudioStreamService();
    vi.spyOn(service, 'resolve').mockResolvedValue(resolved);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('error', {
          status: 416,
          headers: { 'content-range': 'bytes */10' },
        }),
      ),
    );
    const app = buildApp({}, undefined, undefined, service);
    const response = await app.inject({
      url: '/api/audio/abcdefghijk',
      headers: { range: 'bytes=20-' },
    });
    expect(response.statusCode).toBe(416);
    expect(response.headers['content-range']).toBe('bytes */10');
    expect(response.body).toBe('');
    await app.close();
  });
  it('times out upstream headers with an actionable 504', async () => {
    const service = new AudioStreamService();
    vi.spyOn(service, 'resolve').mockResolvedValue(resolved);
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: unknown, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal!.addEventListener(
              'abort',
              () => reject(new Error('abort')),
              { once: true },
            );
          }),
      ),
    );
    const app = Fastify();
    registerAudioRoutes(app, service, { headerTimeoutMs: 20 });
    const response = await app.inject('/api/audio/abcdefghijk');
    expect(response.statusCode).toBe(504);
    expect(response.json().code).toBe('TIMEOUT');
    await app.close();
    service.close();
  });
  it('cancels resolution when the real client socket disconnects', async () => {
    const service = new AudioStreamService();
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let cancelled!: () => void;
    const aborted = new Promise<void>((resolve) => {
      cancelled = resolve;
    });
    vi.spyOn(service, 'resolve').mockImplementation(
      (_id, signal) =>
        new Promise((_resolve, reject) => {
          signal!.addEventListener(
            'abort',
            () => {
              cancelled();
              reject(new AudioResolutionError('Cancelled', 'CANCELLED', 499));
            },
            { once: true },
          );
          entered();
        }),
    );
    const app = buildApp({}, undefined, undefined, service);
    const address = await app.listen({ host: '127.0.0.1', port: 0 });
    const request = get(`${address}/api/audio/abcdefghijk`);
    request.on('error', () => {});
    await started;
    request.destroy();
    await aborted;
    await app.close();
  });
  it('rejects invalid video ID with 400', async () => {
    const service = new AudioStreamService();
    const app = buildApp({}, undefined, undefined, service);

    const res = await app.inject({
      method: 'GET',
      url: '/api/audio/invalid!',
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: 'INVALID_ID' });
    await app.close();
  });

  it('handles audio resolution error with appropriate status code', async () => {
    const service = new AudioStreamService();
    vi.spyOn(service, 'resolve').mockRejectedValue(
      new AudioResolutionError('Traccia non trovata', 'NOT_FOUND', 404),
    );
    const app = buildApp({}, undefined, undefined, service);

    const res = await app.inject({
      method: 'GET',
      url: '/api/audio/abcdefghijk',
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ code: 'NOT_FOUND' });
    await app.close();
  });

  it('forwards Range request and returns 206 Partial Content', async () => {
    const mockAudio: ResolvedAudioStream = {
      url: 'https://example.com/audio.mp4',
      mimeType: 'audio/mp4',
      contentLength: 3000000,
      expiresAt: Date.now() + 3600000,
    };

    const service = new AudioStreamService();
    vi.spyOn(service, 'resolve').mockResolvedValue(mockAudio);

    // Mock global fetch for upstream GoogleVideo request
    const mockFetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const range = (init?.headers as Record<string, string>)?.['Range'];
      const headers = new Headers({
        'content-type': 'audio/mp4',
        'content-length': '1024',
        'accept-ranges': 'bytes',
      });
      if (range) {
        headers.set('content-range', 'bytes 0-1023/3000000');
        return new Response(new Uint8Array(1024).buffer, {
          status: 206,
          headers,
        });
      }
      return new Response(new Uint8Array(2048).buffer, {
        status: 200,
        headers,
      });
    });

    vi.stubGlobal('fetch', mockFetch);

    const app = buildApp({}, undefined, undefined, service);

    const res = await app.inject({
      method: 'GET',
      url: '/api/audio/abcdefghijk',
      headers: {
        range: 'bytes=0-1023',
      },
    });

    expect(res.statusCode).toBe(206);
    expect(res.headers['content-range']).toBe('bytes 0-1023/3000000');
    expect(res.headers['content-type']).toBe('audio/mp4');
    expect(res.headers['accept-ranges']).toBe('bytes');
    expect(res.rawPayload.length).toBe(1024);

    vi.unstubAllGlobals();
    await app.close();
  });

  it('handles HEAD request without body', async () => {
    const mockAudio: ResolvedAudioStream = {
      url: 'https://example.com/audio.mp4',
      mimeType: 'audio/mp4',
      contentLength: 5000000,
      expiresAt: Date.now() + 3600000,
    };

    const service = new AudioStreamService();
    vi.spyOn(service, 'resolve').mockResolvedValue(mockAudio);

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        return new Response(null, {
          status: 200,
          headers: {
            'content-type': 'audio/mp4',
            'content-length': '5000000',
            'accept-ranges': 'bytes',
          },
        });
      }),
    );

    const app = buildApp({}, undefined, undefined, service);

    const res = await app.inject({
      method: 'HEAD',
      url: '/api/audio/abcdefghijk',
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('audio/mp4');
    expect(res.headers['accept-ranges']).toBe('bytes');
    expect(res.rawPayload.length).toBe(0);

    vi.unstubAllGlobals();
    await app.close();
  });
});
