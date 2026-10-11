import { AsyncLocalStorage } from 'node:async_hooks';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isPlaybackSource } from '@musicbit/shared';
import { PlaybackResolver } from '../playback/resolver.js';
import { YouTubePlaybackProvider } from './provider.js';
import {
  guardedPlayerFetch,
  StreamingError,
  YouTubeStreamingGateway,
  type StreamInfo,
} from './gateway.js';
import { parsePermissions } from './permissions.js';
import { buildYouTubePlaybackLab } from './lab.js';

const id = 'm5fixture01';
const reference = { catalogProvider: 'youtube', catalogId: id };
const signal = () => new AbortController().signal;
const permission = () => ({
  videoId: id,
  title: 'Original fixture',
  artist: 'MusicBit tests',
  contentPermissionUrl: 'https://example.test/content-permission',
  servicePermissionUrl: 'https://example.test/service-permission',
  attribution: 'TEST ONLY',
  expiresAt: new Date(Date.now() + 3600000).toISOString(),
});
const info = (): StreamInfo => ({
  playable: true,
  expiresAt: Date.now() + 60000,
  formats: [
    {
      itag: 140,
      mime: 'audio/mp4; codecs="mp4a.40.2"',
      bitrate: 128000,
      audio: true,
      video: false,
      protected: false,
      durationSeconds: 60,
      sampleRate: 44100,
      url: `https://rr1.example.googlevideo.com/videoplayback?expire=${Math.floor(Date.now() / 1000) + 120}&sig=private`,
    },
  ],
});
const disposers: (() => unknown)[] = [];
afterEach(async () => {
  for (const dispose of disposers.splice(0)) await dispose();
  vi.useRealTimers();
});
function make(data = info()) {
  const inspect = vi.fn(async () => data);
  const provider = new YouTubePlaybackProvider(true, [permission()], {
    inspect,
  });
  return { inspect, provider };
}

describe('M5 fail-closed YouTube playback provider', () => {
  it.each(['disabled', 'missing', 'expired', 'other-id', 'other-catalog'])(
    'makes no network request when %s',
    async (kind) => {
      const inspect = vi.fn();
      const p = permission();
      if (kind === 'expired')
        p.expiresAt = new Date(Date.now() - 1).toISOString();
      const provider = new YouTubePlaybackProvider(
        kind !== 'disabled',
        kind === 'missing' ? [] : [p],
        { inspect },
      );
      const ref =
        kind === 'other-id'
          ? { ...reference, catalogId: 'm5fixture02' }
          : kind === 'other-catalog'
            ? { ...reference, catalogProvider: 'other' }
            : reference;
      expect(await provider.resolve(ref, signal())).toEqual({
        status: 'unavailable',
        code: 'NO_AUTHORIZED_SOURCE',
      });
      expect(inspect).not.toHaveBeenCalled();
    },
  );
  it('returns a raw AAC descriptor, with a bounded expiry and redacted diagnostics', async () => {
    const { provider } = make();
    const result = await provider.resolve(reference, signal());
    expect(result.status).toBe('available');
    if (result.status !== 'available') throw new Error();
    expect(isPlaybackSource(result.source)).toBe(true);
    expect(result.source.url).toContain('sig=private'); // unchanged, never deciphered
    expect(Date.parse(result.source.validUntil!)).toBeLessThan(
      Date.now() + 61000,
    );
    const diagnostic = provider.diagnostic(id)!;
    expect(diagnostic.outcome).toBe('RESOLVED');
    expect(diagnostic.formats[0]).toMatchObject({
      itag: 140,
      audio: true,
      video: false,
    });
    expect(JSON.stringify(diagnostic)).not.toMatch(/private|googlevideo|sig=/);
    diagnostic.outcome = 'DISABLED';
    expect(provider.diagnostic(id)?.outcome).toBe('RESOLVED');
  });
  it.each([
    'cipher',
    'drm',
    'webm',
    'video',
    'unavailable',
    'expired',
    'unknown-expiry',
    'host',
  ])('does not offer an unsafe or unsupported source: %s', async (kind) => {
    const data = info();
    const f = data.formats[0]!;
    if (kind === 'cipher' || kind === 'drm') f.protected = true;
    if (kind === 'webm') f.mime = 'audio/webm; codecs="opus"';
    if (kind === 'video') f.video = true;
    if (kind === 'unavailable') data.playable = false;
    if (kind === 'expired') data.expiresAt = Date.now() - 1;
    if (kind === 'unknown-expiry') {
      data.expiresAt = undefined;
      f.url = 'https://rr1.googlevideo.com/videoplayback?expire=invalid';
    }
    if (kind === 'host')
      f.url = 'https://googlevideo.com.attacker.test/videoplayback';
    const { provider } = make(data);
    expect((await provider.resolve(reference, signal())).status).not.toBe(
      'available',
    );
  });
  it.each([403, 429])(
    'reports HTTP %s safely, does not retry or switch client',
    async (status) => {
      const inspect = vi.fn(async () => {
        throw new StreamingError(status, 120);
      });
      const provider = new YouTubePlaybackProvider(true, [permission()], {
        inspect,
      });
      expect(await provider.resolve(reference, signal())).toMatchObject({
        status: 'error',
        retryable: false,
      });
      expect(provider.diagnostic(id)).toMatchObject({
        outcome: `HTTP_${status}`,
        httpStatus: status,
        retryAfterSeconds: 120,
      });
      expect(inspect).toHaveBeenCalledTimes(1);
    },
  );
  it('deduplicates concurrent resolution and uses warm cache without a second upstream request', async () => {
    const { provider, inspect } = make();
    const resolver = new PlaybackResolver(provider);
    disposers.push(() => resolver.close());
    const results = await Promise.all([
      resolver.resolve(reference, signal()),
      resolver.resolve(reference, signal()),
    ]);
    expect(results.map((r) => r.timing.cache)).toEqual(['miss', 'shared']);
    expect((await resolver.resolve(reference, signal())).timing.cache).toBe(
      'hit',
    );
    expect(inspect).toHaveBeenCalledTimes(1);
  });
  it('times out and cancels the upstream, with no success cache', async () => {
    vi.useFakeTimers();
    let upstream: AbortSignal | undefined;
    const inspect = vi.fn((_id: string, s: AbortSignal) => {
      upstream = s;
      return new Promise<StreamInfo>(() => {});
    });
    const resolver = new PlaybackResolver(
      new YouTubePlaybackProvider(true, [permission()], { inspect }),
      60000,
      100,
    );
    disposers.push(() => resolver.close());
    const request = resolver.resolve(reference, signal());
    await vi.advanceTimersByTimeAsync(101);
    expect((await request).resolution).toMatchObject({ code: 'TIMEOUT' });
    expect(upstream?.aborted).toBe(true);
  });
  it('honors cancellation before making a request', async () => {
    const { provider, inspect } = make();
    const controller = new AbortController();
    controller.abort();
    expect(await provider.resolve(reference, controller.signal)).toMatchObject({
      code: 'CANCELLED',
    });
    expect(inspect).not.toHaveBeenCalled();
  });
  it('rejects a late cancelled result and preserves diagnostics of the newer request', async () => {
    const completions: ((value: StreamInfo) => void)[] = [];
    const inspect = vi.fn(
      () => new Promise<StreamInfo>((resolve) => completions.push(resolve)),
    );
    const provider = new YouTubePlaybackProvider(true, [permission()], {
      inspect,
    });
    const previous = new AbortController();
    const first = provider.resolve(reference, previous.signal);
    const second = provider.resolve(reference, signal());
    previous.abort();
    completions[1]!(info());
    expect((await second).status).toBe('available');
    completions[0]!(info());
    expect(await first).toMatchObject({ code: 'CANCELLED' });
    expect(provider.diagnostic(id)?.outcome).toBe('RESOLVED');
  });
  it('validates permission records without accepting credentials or duplicate IDs', () => {
    expect(parsePermissions([permission()])).toHaveLength(1);
    for (const records of [
      [{ ...permission(), cookie: 'secret' }],
      [permission(), permission()],
      [
        {
          ...permission(),
          servicePermissionUrl: 'https://user:secret@example.test',
        },
      ],
      [
        {
          ...permission(),
          contentPermissionUrl: 'https://example.test/?token=secret',
        },
      ],
      [{ ...permission(), expiresAt: 'invalid' }],
    ])
      expect(() => parsePermissions(records)).toThrow();
  });
});

describe('M5 installed youtubei.js gateway with deterministic transport', () => {
  it('getBasicInfo parses raw formats without player JS, decipher, tokens or additional endpoints', async () => {
    const transport = vi.fn<typeof fetch>(async (_input, init) => {
      const body = JSON.parse(String(init?.body));
      expect(body.videoId).toBe(id);
      expect(body.racyCheckOk).toBe(false);
      expect(body.contentCheckOk).toBe(false);
      expect(body.context.client.clientName).toBe('WEB');
      expect(JSON.stringify(body)).not.toMatch(
        /poToken|signatureTimestamp|serviceIntegrityDimensions/,
      );
      expect(init?.credentials).toBe('omit');
      expect(init?.redirect).toBe('error');
      return Response.json({
        playabilityStatus: { status: 'OK' },
        videoDetails: {
          videoId: id,
          title: 'Fixture',
          author: 'MusicBit',
          lengthSeconds: '60',
        },
        streamingData: {
          expiresInSeconds: '60',
          adaptiveFormats: [
            {
              itag: 140,
              mimeType: 'audio/mp4; codecs="mp4a.40.2"',
              bitrate: 128000,
              audioQuality: 'AUDIO_QUALITY_MEDIUM',
              audioSampleRate: '44100',
              approxDurationMs: '60000',
              url: info().formats[0]!.url,
            },
          ],
        },
      });
    });
    const result = await new YouTubeStreamingGateway(transport).inspect(
      id,
      signal(),
    );
    expect(result.playable).toBe(true);
    expect(result.formats[0]).toMatchObject({
      audio: true,
      video: false,
      protected: false,
      sampleRate: 44100,
    });
    expect(transport).toHaveBeenCalledTimes(1);
    expect(String(transport.mock.calls[0]![0])).toContain(
      '/youtubei/v1/player',
    );
  });
  it.each([
    'outside-scope',
    'host',
    'redirect-path',
    'cookie',
    'authorization',
    'id',
    'token',
    'client',
  ])('rejects disallowed request: %s', async (kind) => {
    const scope = new AsyncLocalStorage<{
      videoId: string;
      signal: AbortSignal;
    }>();
    const transport = vi.fn<typeof fetch>();
    const guarded = guardedPlayerFetch(scope, transport);
    const url =
      kind === 'host'
        ? 'https://attacker.test/youtubei/v1/player'
        : kind === 'redirect-path'
          ? 'https://www.youtube.com/s/player/script.js'
          : 'https://www.youtube.com/youtubei/v1/player';
    const init = {
      method: 'POST',
      headers:
        kind === 'cookie'
          ? { cookie: 'secret' }
          : kind === 'authorization'
            ? { authorization: 'secret' }
            : {},
      body: JSON.stringify({
        videoId: kind === 'id' ? 'm5fixture02' : id,
        context: {
          client: { clientName: kind === 'client' ? 'ANDROID' : 'WEB' },
        },
        ...(kind === 'token'
          ? { serviceIntegrityDimensions: { poToken: 'secret' } }
          : {}),
      }),
    };
    const invoke = () => guarded(url, init);
    await expect(
      kind === 'outside-scope'
        ? invoke()
        : scope.run({ videoId: id, signal: signal() }, invoke),
    ).rejects.toThrow();
    expect(transport).not.toHaveBeenCalled();
  });
  it('redacts a real HTTP error body and preserves 429 Retry-After without retry', async () => {
    const transport = vi.fn<typeof fetch>(
      async () =>
        new Response('SECRET BODY', {
          status: 429,
          headers: { 'Retry-After': '30' },
        }),
    );
    await expect(
      new YouTubeStreamingGateway(transport).inspect(id, signal()),
    ).rejects.toMatchObject({
      status: 429,
      retryAfterSeconds: 30,
      message: 'YouTube streaming request unavailable',
    });
    expect(transport).toHaveBeenCalledTimes(1);
  });
});

describe('M5 standalone API', () => {
  it('validates IDs, rejects browser-supplied URLs and cross-origin resolution; disabled by default', async () => {
    const app = buildYouTubePlaybackLab();
    disposers.push(() => app.close());
    expect((await app.inject('/__youtube/health')).json()).toMatchObject({
      enabled: false,
      authorizedVideoIds: [],
    });
    const result = await app.inject({
      method: 'POST',
      url: '/__youtube/api/resolve',
      payload: reference,
    });
    expect(result.json()).toMatchObject({
      resolution: { status: 'unavailable' },
      diagnostic: { outcome: 'DISABLED', upstreamMs: null },
    });
    for (const payload of [
      { ...reference, catalogId: 'bad' },
      { ...reference, url: 'https://attacker.test' },
    ])
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/__youtube/api/resolve',
            payload,
          })
        ).statusCode,
      ).toBe(400);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/__youtube/api/resolve',
          payload: reference,
          headers: { origin: 'https://attacker.test' },
        })
      ).statusCode,
    ).toBe(403);
    expect((await app.inject('/__youtube/api/search?q=%20')).statusCode).toBe(
      400,
    );
    expect(result.headers['cache-control']).toBe('no-store');
  });
});
