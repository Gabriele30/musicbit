import { afterEach, expect, it, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import Fastify from 'fastify';
import {
  ContinuousAudio,
  parseHlsTrack,
  registerContinuousRoutes,
} from './continuous.js';
import { AudioDiskCache } from './disk-cache.js';
import { AudioStreamService } from './stream-service.js';
import { AccountError } from '../accounts/store.js';
import { catalogItemToTrack, emptyLibrary } from '@musicbit/shared';
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
    parseHlsTrack(
      '#EXTM3U\n#EXTINF:2.020144,\nsegment-000000.ts\n#EXT-X-ENDLIST',
      true,
    )[0]?.duration,
  ).toBe((87 * 1024) / 44100);
  expect(
    parseHlsTrack('#EXTM3U\n#EXTINF:2.02,\nsegment-000001.ts\n#EXT-X-ENDLIST'),
  ).toEqual([{ duration: 2.02, name: 'segment-000001.ts' }]);
  expect(
    parseHlsTrack(
      '#EXTINF:0.000023,\nsegment-000001.ts\n#EXT-X-ENDLIST',
      true,
    )[0]?.duration,
  ).toBe(1024 / 44100);
  expect(() =>
    parseHlsTrack(
      '#EXTINF:2,\nhttps://external.test/segment.ts\n#EXT-X-ENDLIST',
    ),
  ).toThrow();
  expect(() => parseHlsTrack('#EXTINF:2,\nsegment-000001.ts')).toThrow();
});
it('replaces abandoned sessions after reload without stopping another device or account', async () => {
  const root = mkdtempSync(join(tmpdir(), 'musicbit-reload-session-'));
  roots.push(root);
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
  vi.spyOn(cache, 'get').mockReturnValue(undefined);
  const service = new ContinuousAudio(cache);
  services.push(service);
  const ids = Array.from(
    { length: 6 },
    (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
  );
  const plan = (user: string, id: string, device: string) =>
    service.plan(user, id, ['abcdefghijk'], false, 100, 0, device);
  plan('gabriele', ids[0]!, 'iphone-window');
  plan('gabriele', ids[1]!, 'desktop-window');
  plan('marco', ids[2]!, 'iphone-window');
  for (const id of ids.slice(3)) plan('gabriele', id, 'iphone-window');
  expect(await service.metadata('gabriele', ids[0]!)).toBeUndefined();
  expect(await service.metadata('gabriele', ids[4]!)).toBeUndefined();
  expect(await service.metadata('gabriele', ids[5]!)).toBeDefined();
  expect(await service.metadata('gabriele', ids[1]!)).toBeDefined();
  expect(await service.metadata('marco', ids[2]!)).toBeDefined();
  expect(() => plan('gabriele', crypto.randomUUID(), 'third-window')).toThrow(
    'Too many',
  );
});
it.each([false, true])(
  'keeps cached radio open during an upstream restriction and recovers (new account: %s)',
  async (newAccount) => {
    const root = mkdtempSync(join(tmpdir(), 'musicbit-radio-restricted-'));
    roots.push(root);
    const input = join(root, 'tone.m4a');
    expect(
      spawnSync(
        'ffmpeg',
        [
          '-v',
          'error',
          '-f',
          'lavfi',
          '-i',
          'sine=frequency=440:sample_rate=44100',
          '-t',
          '1',
          '-c:a',
          'aac',
          '-ac',
          '2',
          '-y',
          input,
        ],
        { windowsHide: true },
      ).status,
    ).toBe(0);
    const seed = 'cached00001',
      fallback = 'cached00002',
      fresh = 'fresh000001';
    const cache = new AudioDiskCache(
      join(root, 'cache'),
      new AudioStreamService(),
    );
    caches.push(cache);
    let restricted = false,
      recovered = false;
    vi.spyOn(cache, 'plan').mockImplementation((_user, _device, ids) => {
      if (ids.includes(fresh) && !recovered) restricted = true;
      return { bytes: 0, quotaBytes: 5_000_000_000, tracks: 2, preparing: 0 };
    });
    vi.spyOn(cache, 'get').mockImplementation((_user, id) =>
      [seed, fallback].includes(id) || (recovered && id === fresh)
        ? {
            id,
            path: input,
            size: statSync(input).size,
            mimeType: 'audio/mp4',
            durationSeconds: 1,
            touched: Date.now(),
            stream: vi.fn(),
          }
        : undefined,
    );
    const failed = Array.from({ length: 6 }, (_, i) => `failed0000${i}`);
    vi.spyOn(cache, 'failure').mockImplementation((_user, id) =>
      failed.includes(id)
        ? 'UNAVAILABLE'
        : restricted && id === fresh
          ? 'PROVIDER_RESTRICTED'
          : undefined,
    );
    vi.spyOn(cache, 'providerRestricted').mockImplementation(() => restricted);
    const item = (id: string) => ({
      id,
      provider: 'youtube',
      kind: 'track' as const,
      title: id,
      artist: 'Artist',
      audioUrl: `/api/audio/${id}`,
      sourceUrl: 'https://music.youtube.com',
      playback: { available: true },
    });
    const library = emptyLibrary();
    library.history = (newAccount ? [] : [seed, fallback]).map((id) => ({
      track: catalogItemToTrack(item(id)),
      playedAt: Date.now(),
    }));
    const recommendations = vi.fn(async (seedId: string) => ({
      seedId,
      items: [
        ...failed.map((id) => ({ ...item(id), artist: id })),
        item(fresh),
      ],
      timing: { cache: 'miss' as const, elapsedMs: 0 },
    }));
    const radio = new ContinuousAudio(
      cache,
      {
        recommendations,
        details: vi.fn(async () => ({
          item: item(seed),
          timing: { cache: 'hit' as const, elapsedMs: 0 },
        })),
      },
      undefined,
      () => library,
    );
    services.push(radio);
    const id = '00000000-0000-4000-8000-000000000099';
    radio.plan('listener', id, [seed], true, 1);
    await vi.waitFor(
      async () =>
        expect(
          (await radio.metadata('listener', id))?.tracks.length,
        ).toBeGreaterThanOrEqual(3),
      { timeout: 15000 },
    );
    const blocked = (await radio.metadata('listener', id))!;
    expect(blocked.error).toBeUndefined();
    expect(blocked.complete).toBe(false);
    expect(blocked.notice).toContain('verifica di accesso');
    expect(blocked.tracks[1]?.id).toBe(newAccount ? seed : fallback);
    expect(
      blocked.additions?.some((addition) => addition.track.id === fresh),
    ).toBe(false);
    expect(await radio.manifest('listener', id)).not.toContain(
      '#EXT-X-ENDLIST',
    );
    expect(
      await radio.segment('listener', id, 1, 'segment-000000.ts'),
    ).toBeTruthy();
    recovered = true;
    restricted = false;
    expect(
      await radio.segment('listener', id, 2, 'segment-000000.ts'),
    ).toBeTruthy();
    await vi.waitFor(
      async () =>
        expect(
          (await radio.metadata('listener', id))?.tracks.some(
            (track) => track.id === fresh,
          ),
        ).toBe(true),
      { timeout: 15000 },
    );
    expect((await radio.metadata('listener', id))?.notice).toBeUndefined();
    expect(await radio.manifest('listener', id)).not.toContain(
      '#EXT-X-ENDLIST',
    );
  },
  30000,
);
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
      '-ac',
      '2',
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
  const initialPlan = service.plan('gabriele', id, ids);
  expect(initialPlan.revision).toBe(1);
  await vi.waitFor(
    async () =>
      expect((await service.metadata('gabriele', id))?.tracks).toHaveLength(3),
    { timeout: 10000 },
  );
  const initial = await service.manifest('gabriele', id);
  expect(initial).toContain('#EXT-X-VERSION:6');
  expect(initial).toContain('#EXT-X-START:TIME-OFFSET=0,PRECISE=YES');
  expect(initial).toContain('#EXT-X-DISCONTINUITY');
  expect(initial).not.toContain('#EXT-X-ENDLIST');
  const timeline = (await service.metadata('gabriele', id))!;
  expect(timeline.revision).toBeGreaterThan(initialPlan.revision!);
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
  expect((await service.metadata('gabriele', id))!.revision).toBeGreaterThan(
    timeline.revision!,
  );
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
  const complete = (await service.metadata('gabriele', id))!;
  const fileManifest = (await service.manifest('gabriele', id))!.split('\n');
  for (let index = 0; index < fileManifest.length; index++) {
    const match = fileManifest[index]!.match(
      /\/api\/continuous\/[^/]+\/(\d+)\/(segment-\d{6}\.ts)$/,
    );
    if (match)
      fileManifest[index] = (await service.segment(
        'gabriele',
        id,
        Number(match[1]),
        match[2]!,
      ))!.replace(/\\/g, '/');
  }
  const playlist = join(root, 'complete.m3u8');
  writeFileSync(playlist, fileManifest.join('\n'));
  const decoded = spawnSync(
    'ffmpeg',
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      playlist,
      '-c:a',
      'pcm_s16le',
      '-ac',
      '1',
      '-ar',
      '44100',
      '-f',
      's16le',
      'pipe:1',
    ],
    { windowsHide: true },
  );
  expect(decoded.status, decoded.stderr.toString()).toBe(0);
  const pcm = decoded.stdout;
  expect(pcm.length / (44100 * 2)).toBeCloseTo(
    complete.tracks.reduce((sum, track) => sum + track.duration, 0),
    1,
  );
  // Inspect the decoded samples after every discontinuity: no one-second
  // silent handoff is introduced by the generated playlist/segment timestamps.
  for (const track of complete.tracks.slice(1)) {
    const start = Math.floor((track.start + 0.05) * 44100);
    const end = Math.floor((track.start + 0.95) * 44100);
    let energy = 0;
    for (let sample = start; sample < end; sample++)
      energy += pcm.readInt16LE(sample * 2) ** 2;
    expect(Math.sqrt(energy / (end - start))).toBeGreaterThan(100);
  }
  service.stop('gabriele', id);
  expect(await service.metadata('gabriele', id)).toBeUndefined();
  const recommendations = vi.fn(async (seedId: string) => ({
    seedId,
    items: ids.slice(1).map((trackId) => ({
      id: trackId,
      kind: 'track' as const,
      provider: 'youtube',
      title: 'Radio fixture',
      artist: trackId,
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
      expect((await radio.metadata('gabriele', id))?.tracks).toHaveLength(4),
    { timeout: 10000 },
  );
  expect((await radio.metadata('gabriele', id))?.complete).toBe(false);
  expect(await radio.manifest('gabriele', id)).not.toContain('#EXT-X-ENDLIST');
  expect(
    (await radio.manifest('gabriele', id))?.match(/#EXT-X-DISCONTINUITY\n/g),
  ).toHaveLength(3);
}, 20000);

it('keeps native radio open through provider failures, crosses the old cap and rolls a bounded absolute timeline', async () => {
  const root = mkdtempSync(join(tmpdir(), 'musicbit-radio-test-'));
  roots.push(root);
  const input = join(root, 'tone.m4a');
  expect(
    spawnSync(
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
        '-ac',
        '2',
        '-y',
        input,
      ],
      { windowsHide: true },
    ).status,
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
  const trackId = (index: number) => `track${String(index).padStart(6, '0')}`;
  const recommendations = vi.fn(async (seedId: string) => {
    if (recommendations.mock.calls.length === 1)
      throw new Error('Transient outage');
    const seed = Number(seedId.slice(5));
    return {
      seedId,
      items: [1, 2, 3].map((offset) => ({
        id: trackId(seed + offset),
        kind: 'track' as const,
        provider: 'youtube',
        title: `Radio ${seed + offset}`,
        artist: `Artist ${seed + offset}`,
        audioUrl: `/api/audio/${trackId(seed + offset)}`,
        sourceUrl: 'https://music.youtube.com',
        playback: { available: true },
      })),
      timing: { cache: 'miss' as const, elapsedMs: 0 },
    };
  });
  const profile = vi.fn(() => emptyLibrary());
  const budget = 1.5 * 1024 * 1024;
  const radio = new ContinuousAudio(
    cache,
    { recommendations },
    undefined,
    profile,
    budget,
  );
  services.push(radio);
  const id = '00000000-0000-4000-8000-000000000002';
  radio.plan('gabriele', id, [trackId(0)], true, 1);
  await vi.waitFor(
    async () =>
      expect((await radio.metadata('gabriele', id))?.tracks).toHaveLength(1),
    { timeout: 10000 },
  );
  const duringOutage = await radio.manifest('gabriele', id);
  const originalSegment = (await radio.segment(
    'gabriele',
    id,
    0,
    'segment-000000.ts',
  ))!;
  expect(duringOutage).not.toContain('#EXT-X-ENDLIST');
  expect((await radio.metadata('gabriele', id))?.error).toBeUndefined();
  await vi.waitFor(
    async () =>
      expect((await radio.metadata('gabriele', id))?.tracks).toHaveLength(3),
    { timeout: 10000 },
  );
  const firstTimeline = (await radio.metadata('gabriele', id))!;
  const edge = (await radio.manifest('gabriele', id))!
    .split('\n')
    .filter((line) => line.includes(`/${id}/2/segment-`))
    .at(-1)!;
  const edgeName = edge.split('/').at(-1)!;
  expect(edgeName).not.toBe('segment-000000.ts');
  // A native live-edge probe must not turn preloading into listened history.
  for (let probe = 0; probe < 4; probe++)
    expect(await radio.segment('gabriele', id, 2, edgeName)).toBeTruthy();
  await new Promise((resolve) => setTimeout(resolve, 300));
  expect((await radio.metadata('gabriele', id))!.tracks).toHaveLength(3);
  expect((await radio.metadata('gabriele', id))!.queueStart).toBe(0);
  const first = firstTimeline.tracks[0]!;
  for (let index = 1; index <= 25; index++) {
    await vi.waitFor(
      async () =>
        expect(
          (await radio.metadata('gabriele', id))?.tracks.some(
            (track) => track.index === index,
          ),
        ).toBe(true),
      { timeout: 10000 },
    );
    expect(
      await radio.segment('gabriele', id, index, 'segment-000000.ts'),
    ).toBeTruthy();
  }
  const timeline = (await radio.metadata('gabriele', id))!;
  expect(timeline.revision).toBeGreaterThan(firstTimeline.revision!);
  expect(timeline.queueStart).toBe(5);
  expect(timeline.tracks[0]).toMatchObject({
    index: 5,
    start: first.duration * 5,
  });
  expect(timeline.tracks.length).toBeLessThanOrEqual(23);
  expect(timeline.additions!.every((addition) => addition.index >= 5)).toBe(
    true,
  );
  expect(timeline.additions!.length).toBeLessThanOrEqual(26);
  expect(profile.mock.calls.length).toBeGreaterThan(5);
  const lateProgram = new Set(
    timeline.tracks
      .filter((track) => track.index >= 20)
      .map((track) => track.id),
  );
  expect(
    recommendations.mock.calls.some(([seed]) => lateProgram.has(seed)),
  ).toBe(true);
  const manifest = (await radio.manifest('gabriele', id))!;
  expect(manifest).toContain('#EXT-X-MEDIA-SEQUENCE:10\n');
  expect(manifest).toContain('#EXT-X-DISCONTINUITY-SEQUENCE:5\n');
  expect(manifest).not.toContain('#EXT-X-PLAYLIST-TYPE:EVENT');
  expect(manifest).not.toContain('#EXT-X-ENDLIST');
  expect(existsSync(originalSegment)).toBe(false);
  // Disk pressure may remove retired bytes, but a stale native manifest can
  // still retrieve the same URI, remuxed from the persistent source cache.
  const retiredSegment = await radio.segment(
    'gabriele',
    id,
    0,
    'segment-000000.ts',
  );
  expect(retiredSegment).toBe(originalSegment);
  expect(readFileSync(retiredSegment!)[0]).toBe(0x47);
  const size = (path: string): number =>
    statSync(path).isDirectory()
      ? readdirSync(path).reduce(
          (total, name) => total + size(join(path, name)),
          0,
        )
      : statSync(path).size;
  expect(size(dirname(dirname(retiredSegment!)))).toBeLessThanOrEqual(budget);
  // A late POST from a suspended tab cannot restore or remap the removed prefix.
  const revised = radio.plan('gabriele', id, [trackId(0)], true, 1);
  expect(revised.revision).toBeGreaterThan(timeline.revision!);
  expect((await radio.metadata('gabriele', id))!.queueStart).toBe(5);
  const leasedStream = (await radio.openSegment(
    'gabriele',
    id,
    0,
    'segment-000000.ts',
  ))!;
  for (let index = 26; index <= 28; index++) {
    await vi.waitFor(
      async () =>
        expect(
          (await radio.metadata('gabriele', id))?.tracks.some(
            (track) => track.index === index,
          ),
        ).toBe(true),
      { timeout: 10000 },
    );
    expect(
      await radio.segment('gabriele', id, index, 'segment-000000.ts'),
    ).toBeTruthy();
  }
  expect(existsSync(originalSegment)).toBe(false);
  const chunks: Buffer[] = [];
  for await (const chunk of leasedStream) chunks.push(Buffer.from(chunk));
  expect(Buffer.concat(chunks)[0]).toBe(0x47);
  // Path-only callers retain a lease for one event-loop turn. Expiry takes
  // effect after that open/read opportunity has finished.
  await new Promise<void>((resolve) => setImmediate(resolve));
  vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 180000);
  expect(
    await radio.segment('gabriele', id, 0, 'segment-000000.ts'),
  ).toBeUndefined();
  expect(existsSync(originalSegment)).toBe(false);
}, 60000);

it('serves authenticated personalized radio independently of native HLS and validates exclusions', async () => {
  const app = Fastify();
  apps.push(app);
  const recommendations = vi.fn(async (seedId: string) => ({
    seedId,
    items: [
      {
        id: 'related0001',
        kind: 'track' as const,
        provider: 'youtube',
        title: 'Related',
        artist: 'Related artist',
        sourceUrl: 'https://music.youtube.com',
        playback: { available: true },
      },
    ],
    timing: { cache: 'miss' as const, elapsedMs: 0 },
  }));
  const profile = vi.fn(() => emptyLibrary());
  registerContinuousRoutes(
    app,
    undefined,
    (request) => {
      if (request.headers.cookie !== 'test-session')
        throw new AccountError(401, 'SIGN_IN_REQUIRED', 'Accedi');
      return { id: 'gabriele' };
    },
    { recommendations },
    profile,
  );
  app.setErrorHandler((error, _request, reply) =>
    reply.code(error instanceof AccountError ? error.status : 400).send(),
  );
  expect((await app.inject('/api/me/radio/original001')).statusCode).toBe(401);
  const response = await app.inject({
    url: '/api/me/radio/original001',
    headers: { cookie: 'test-session' },
  });
  expect(response.statusCode).toBe(200);
  expect(response.json()).toMatchObject({
    seedId: 'original001',
    items: [{ id: 'related0001' }],
    partial: false,
    retry: false,
  });
  expect(profile).toHaveBeenCalledWith('gabriele');
  const excluded = await app.inject({
    url: '/api/me/radio/original001?exclude=related0001',
    headers: { cookie: 'test-session' },
  });
  expect(excluded.json()).toMatchObject({ items: [], retry: true });
  expect(
    (
      await app.inject({
        url: '/api/me/radio/original001?exclude=invalid',
        headers: { cookie: 'test-session' },
      })
    ).statusCode,
  ).toBe(400);
});

it('progressive radio uses only personal cached audio during provider restrictions and respects exclusions', async () => {
  const app = Fastify();
  apps.push(app);
  const library = emptyLibrary();
  library.history = ['original001', 'cached00001', 'missing0001'].map((id) => ({
    track: catalogItemToTrack({
      id,
      kind: 'track',
      provider: 'youtube',
      title: id,
      artist: id,
      sourceUrl: 'https://music.youtube.com',
      playback: { available: true },
    }),
    playedAt: Date.now(),
  }));
  const recommendations = vi.fn();
  const cache = {
    providerRestricted: vi.fn(() => true),
    get: vi.fn((_user: string, id: string) =>
      id === 'cached00001'
        ? {
            id,
            path: '/cached-test-audio',
            size: 10,
            mimeType: 'audio/mp4',
            touched: Date.now(),
            stream: vi.fn(),
          }
        : undefined,
    ),
  };
  registerContinuousRoutes(
    app,
    undefined,
    () => ({ id: 'gabriele' }),
    { recommendations },
    () => library,
    cache,
  );
  const response = await app.inject('/api/me/radio/original001');
  expect(response.statusCode).toBe(200);
  expect(response.headers['cache-control']).toBe('private, no-store');
  expect(response.json()).toMatchObject({
    seedId: 'original001',
    items: [{ id: 'cached00001', playback: { available: true } }],
    partial: true,
    retry: false,
  });
  expect(response.json().notice).toContain('già in cache');
  expect(recommendations).not.toHaveBeenCalled();
  expect(cache.get).toHaveBeenCalledWith('gabriele', 'cached00001');
  const exhausted = await app.inject(
    '/api/me/radio/original001?exclude=cached00001',
  );
  expect(exhausted.json()).toMatchObject({ items: [], retry: true });
  cache.providerRestricted.mockReturnValue(false);
  recommendations.mockResolvedValue({
    seedId: 'original001',
    items: [
      {
        id: 'fresh000001',
        kind: 'track',
        provider: 'youtube',
        title: 'Fresh song',
        artist: 'Fresh artist',
        sourceUrl: 'https://music.youtube.com',
        playback: { available: true },
      },
    ],
    timing: { cache: 'miss', elapsedMs: 0 },
  });
  const recovered = await app.inject('/api/me/radio/original001');
  expect(recovered.json()).toMatchObject({
    items: [{ id: 'fresh000001' }],
    retry: false,
  });
  expect(recommendations).toHaveBeenCalled();
});

it('converts provider Opus fallbacks to AAC-LC for native iPhone HLS', async () => {
  const root = mkdtempSync(join(tmpdir(), 'musicbit-opus-hls-test-'));
  roots.push(root);
  const input = join(root, 'tone.webm');
  expect(
    spawnSync(
      'ffmpeg',
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=440:sample_rate=48000',
        '-t',
        '2.4',
        '-c:a',
        'libopus',
        '-y',
        input,
      ],
      { windowsHide: true },
    ).status,
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
    mimeType: 'audio/webm',
    durationSeconds: 2.4,
    touched: Date.now(),
    stream: vi.fn(),
  }));
  const service = new ContinuousAudio(cache);
  services.push(service);
  const id = '00000000-0000-4000-8000-000000000003';
  service.plan('gabriele', id, ['fallback001']);
  await vi.waitFor(
    async () =>
      expect((await service.metadata('gabriele', id))?.complete).toBe(true),
    { timeout: 10000 },
  );
  const segment = await service.segment('gabriele', id, 0, 'segment-000000.ts');
  const probe = spawnSync(
    'ffprobe',
    ['-v', 'error', '-show_streams', '-of', 'json', segment!],
    { windowsHide: true, encoding: 'utf8' },
  );
  expect(probe.status).toBe(0);
  expect(JSON.parse(probe.stdout).streams[0]).toMatchObject({
    codec_name: 'aac',
    profile: 'LC',
    sample_rate: '44100',
    channels: 2,
  });
});
