import { afterEach, expect, it, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import {
  ContinuousAudio,
  parseHlsTrack,
  registerContinuousRoutes,
} from './continuous.js';
import { AudioDiskCache } from './disk-cache.js';
import { AudioStreamService } from './stream-service.js';
import { AccountError } from '../accounts/store.js';
const roots: string[] = [],
  services: ContinuousAudio[] = [],
  caches: AudioDiskCache[] = [];
const apps: ReturnType<typeof Fastify>[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  await Promise.all(services.splice(0).map((service) => service.close()));
  await Promise.all(caches.splice(0).map((cache) => cache.close()));
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
  vi.restoreAllMocks();
});
it('rejects incomplete, nonlocal and invalid generated HLS segments', () => {
  expect(
    parseHlsTrack('#EXTM3U\n#EXTINF:2.02,\nsegment-000001.ts\n#EXT-X-ENDLIST'),
  ).toEqual([{ duration: 2.02, name: 'segment-000001.ts' }]);
  expect(() =>
    parseHlsTrack(
      '#EXTINF:2,\nhttps://external.test/segment.ts\n#EXT-X-ENDLIST',
    ),
  ).toThrow();
  expect(() => parseHlsTrack('#EXTINF:2,\nsegment-000001.ts')).toThrow();
});
it('remuxes real AAC into a single continuous HLS playlist, prepares ahead from native segment requests and isolates sessions', async () => {
  const root = mkdtempSync(join(tmpdir(), 'musicbit-hls-test-'));
  roots.push(root);
  const input = join(root, 'tone.m4a');
  const encoded = spawnSync(
    'ffmpeg',
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:sample_rate=44100',
      '-t',
      '2.4',
      '-c:a',
      'aac',
      '-y',
      input,
    ],
    { windowsHide: true },
  );
  expect(
    encoded.status,
    'FFmpeg must be installed for continuous audio verification',
  ).toBe(0);
  const cache = new AudioDiskCache(
    join(root, 'cache'),
    new AudioStreamService(),
  );
  caches.push(cache);
  vi.spyOn(cache, 'plan').mockReturnValue({
    bytes: 0,
    quotaBytes: 5_000_000_000,
    tracks: 0,
    preparing: 0,
  });
  vi.spyOn(cache, 'get').mockImplementation((_user, id) => ({
    id,
    path: input,
    size: statSync(input).size,
    mimeType: 'audio/mp4',
    durationSeconds: 2.4,
    touched: Date.now(),
    stream: vi.fn(),
  }));
  const service = new ContinuousAudio(cache);
  services.push(service);
  const id = '00000000-0000-4000-8000-000000000001';
  const ids = ['abcdefghijk', 'lmnopqrstuv', 'zyxwvutsrqp', '12345678901'];
  service.plan('gabriele', id, ids);
  await vi.waitFor(
    async () =>
      expect((await service.metadata('gabriele', id))?.tracks).toHaveLength(3),
    { timeout: 10000 },
  );
  const initial = await service.manifest('gabriele', id);
  expect(initial).toContain('#EXT-X-DISCONTINUITY');
  expect(initial).not.toContain('#EXT-X-ENDLIST');
  const timeline = (await service.metadata('gabriele', id))!;
  expect(timeline.tracks[0]!.duration).toBeGreaterThan(2.3);
  expect(timeline.tracks[0]!.duration).toBeLessThan(2.5);
  expect(timeline.tracks[1]!.start).toBe(timeline.tracks[0]!.duration);
  const segment = await service.segment('gabriele', id, 1, 'segment-000000.ts');
  expect(readFileSync(segment!)[0]).toBe(0x47);
  await vi.waitFor(
    async () =>
      expect((await service.metadata('gabriele', id))?.complete).toBe(true),
    { timeout: 10000 },
  );
  expect(await service.manifest('gabriele', id)).toContain('#EXT-X-ENDLIST');
  expect(await service.metadata('marco', id)).toBeUndefined();
  expect(
    await service.segment('marco', id, 0, 'segment-000000.ts'),
  ).toBeUndefined();
  expect(() => service.plan('gabriele', id, [ids[1]!])).toThrow();
  const app = Fastify();
  apps.push(app);
  registerContinuousRoutes(app, service, (request) => {
    if (request.headers.cookie !== 'test-session')
      throw new AccountError(401, 'SIGN_IN_REQUIRED', 'Accedi');
    return { id: 'gabriele' };
  });
  app.setErrorHandler((error, _request, reply) =>
    reply.code(error instanceof AccountError ? error.status : 500).send(),
  );
  expect((await app.inject(`/api/me/continuous/${id}`)).statusCode).toBe(401);
  const manifest = await app.inject({
    url: `/api/continuous/${id}/index.m3u8`,
    headers: { cookie: 'test-session' },
  });
  expect(manifest.statusCode).toBe(200);
  expect(manifest.headers['content-type']).toContain(
    'application/vnd.apple.mpegurl',
  );
  expect(
    (
      await app.inject({
        url: `/api/continuous/${id}/0/segment-000000.ts`,
        headers: { cookie: 'test-session' },
      })
    ).statusCode,
  ).toBe(200);
  expect(
    (
      await app.inject({
        url: `/api/continuous/${id}/0/invalid.ts`,
        headers: { cookie: 'test-session' },
      })
    ).statusCode,
  ).toBe(400);
  service.stop('gabriele', id);
  expect(await service.metadata('gabriele', id)).toBeUndefined();
  const recommendations = vi.fn(async (seedId: string) => ({
    seedId,
    items: ids
      .slice(1)
      .map((trackId) => ({
        id: trackId,
        kind: 'track' as const,
        provider: 'youtube',
        title: 'Radio fixture',
        artist: 'Original tones',
        audioUrl: `/api/audio/${trackId}`,
        sourceUrl: 'https://example.com',
        playback: { available: true },
      })),
    timing: { cache: 'miss' as const, elapsedMs: 0 },
  }));
  const radio = new ContinuousAudio(cache, { recommendations });
  services.push(radio);
  radio.plan('gabriele', id, [ids[0]!], true, 4);
  await vi.waitFor(
    async () =>
      expect((await radio.metadata('gabriele', id))?.tracks).toHaveLength(3),
    { timeout: 10000 },
  );
  expect(recommendations).toHaveBeenCalledOnce();
  expect((await radio.metadata('gabriele', id))?.additions).toHaveLength(3);
  await radio.segment('gabriele', id, 2, 'segment-000000.ts');
  await vi.waitFor(
    async () =>
      expect((await radio.metadata('gabriele', id))?.complete).toBe(true),
    { timeout: 10000 },
  );
  expect(
    (await radio.manifest('gabriele', id))?.match(/#EXT-X-DISCONTINUITY/g),
  ).toHaveLength(3);
}, 20000);
