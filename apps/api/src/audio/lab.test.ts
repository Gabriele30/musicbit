import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import { afterAll, describe, expect, it } from 'vitest';
import type { AudioDiskCache } from './disk-cache.js';
import {
  DiagnosticsStore,
  PlaybackLab,
  registerLabRoutes,
  sanitizeDiagnostic,
} from './lab.js';

const ffmpeg = process.env.FFMPEG_PATH ?? 'ffmpeg';
const hasFfmpeg =
  spawnSync(ffmpeg, ['-version'], { stdio: 'ignore' }).status === 0;
const root = mkdtempSync(join(tmpdir(), 'musicbit-lab-test-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

function fakeCache(files: { id: string; path: string; duration: number }[]) {
  return {
    entries: () =>
      files.map((file, index) => ({
        id: file.id,
        size: 1,
        mimeType: 'audio/mp4',
        durationSeconds: file.duration,
        touched: index,
      })),
    get: (_user: string, id: string) => {
      const file = files.find((item) => item.id === id);
      return file && { path: file.path };
    },
  } as unknown as AudioDiskCache;
}

describe('diagnostics', () => {
  it('keeps only bounded scalar fields', () => {
    expect(
      sanitizeDiagnostic({
        ev: 'playing',
        pos: 1.23456,
        paused: false,
        nested: { cookie: 'x' },
        url: 'https://example.com/?sig=<script>',
        'bad key': 1,
      }),
    ).toEqual({ ev: 'playing', pos: 1.235, paused: false });
  });
  it('stores records per account and isolates them', async () => {
    const store = new DiagnosticsStore(join(root, 'diag'));
    const app = Fastify();
    let user = 'a';
    registerLabRoutes(app, () => ({ id: user }), store, undefined);
    const posted = await app.inject({
      method: 'POST',
      url: '/api/me/diagnostics',
      payload: { records: [{ ev: 'ended', pos: 3 }] },
    });
    expect(posted.json()).toEqual({ stored: 1 });
    user = 'b';
    const other = await app.inject({ url: '/api/me/diagnostics' });
    expect(other.json<{ records: unknown[] }>().records).toEqual([]);
    user = 'a';
    const mine = await app.inject({ url: '/api/me/diagnostics' });
    expect(mine.json<{ records: { ev: string }[] }>().records[0]!.ev).toBe(
      'ended',
    );
    await app.close();
  });
});

describe.skipIf(!hasFfmpeg)('playback lab clips', () => {
  it('cuts three clips and publishes one finite HLS program', async () => {
    const files = ['aaaaaaaaaaa', 'bbbbbbbbbbb', 'ccccccccccc'].map(
      (id, index) => {
        const path = join(root, `${id}.m4a`);
        execFileSync(ffmpeg, [
          '-hide_banner',
          '-loglevel',
          'error',
          '-f',
          'lavfi',
          '-i',
          `sine=frequency=${300 + index * 200}:duration=70`,
          '-c:a',
          'aac',
          '-y',
          path,
        ]);
        return { id, path, duration: 70 };
      },
    );
    const lab = new PlaybackLab(fakeCache(files), join(root, 'lab'));
    const clips = await lab.clips('user');
    expect(clips.map((clip) => clip.sourceId).sort()).toEqual(
      files.map((file) => file.id).sort(),
    );
    const playlist = lab.playlist('user')!;
    expect(playlist).toContain('#EXT-X-PLAYLIST-TYPE:VOD');
    expect(playlist.match(/#EXT-X-DISCONTINUITY/g)).toHaveLength(2);
    expect(playlist.trim().endsWith('#EXT-X-ENDLIST')).toBe(true);
    const total = [...playlist.matchAll(/#EXTINF:([\d.]+)/g)].reduce(
      (sum, match) => sum + Number(match[1]),
      0,
    );
    expect(total).toBeGreaterThan(59);
    expect(total).toBeLessThan(61);

    const app = Fastify();
    registerLabRoutes(app, () => ({ id: 'user' }), undefined, lab);
    const range = await app.inject({
      url: '/api/me/lab/clip/clip-1.m4a',
      headers: { range: 'bytes=0-99' },
    });
    expect(range.statusCode).toBe(206);
    expect(range.rawPayload).toHaveLength(100);
    expect(range.headers['content-range']).toMatch(/^bytes 0-99\/\d+$/);
    const escape = await app.inject({
      url: '/api/me/lab/clip/..%2Fclips.json',
    });
    expect(escape.statusCode).toBe(404);
    const fragment = readFileSync(
      join(lab.directory('user'), 'clip-0.frag.mp4'),
    );
    expect(fragment.includes(Buffer.from('moof'))).toBe(true);
    await app.close();
  }, 60000);
});
