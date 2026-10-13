import { spawn, spawnSync } from 'node:child_process';
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type {
  ContinuousTimeline,
  ContinuousTrack,
  ContinuousPlan,
} from '@musicbit/shared';
import type { AudioDiskCache } from './disk-cache.js';
import { catalogItemToTrack } from '@musicbit/shared';
import type { CatalogService } from '../catalog/service.js';

interface Segment {
  duration: number;
  name: string;
}
interface Prepared {
  track: ContinuousTrack;
  segments: Segment[];
  directory: string;
}
interface Session {
  user: string;
  id: string;
  ids: string[];
  directory: string;
  prepared: Prepared[];
  cursor: number;
  touched: number;
  controller: AbortController;
  work?: Promise<void>;
  error?: string;
  autoplay: boolean;
  maxTracks: number;
  additions: NonNullable<ContinuousTimeline['additions']>;
}
const SESSION_ID = /^[a-f0-9-]{36}$/;
const MAX_TEMP_BYTES = 512 * 1024 * 1024;

export function parseHlsTrack(text: string): Segment[] {
  const lines = text.trim().split(/\r?\n/),
    result: Segment[] = [];
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i]!.match(/^#EXTINF:([\d.]+),/);
    if (!match) continue;
    const duration = Number(match[1]),
      name = lines[i + 1] ?? '';
    if (
      !Number.isFinite(duration) ||
      duration <= 0 ||
      duration > 10 ||
      !/^segment-\d{6}\.ts$/.test(name)
    )
      throw new Error('Invalid generated HLS');
    result.push({ duration, name });
  }
  if (!result.length || !lines.includes('#EXT-X-ENDLIST'))
    throw new Error('Incomplete generated HLS');
  return result;
}

/** Native HLS owns transitions; no browser source replacement at song boundaries. */
export class ContinuousAudio {
  private sessions = new Map<string, Session>();
  private jobs = new Set<Promise<void>>();
  private conversion: Promise<void> = Promise.resolve();
  private root: string;
  private cleanupTimer: ReturnType<typeof setInterval>;
  readonly enabled: boolean;
  constructor(
    private cache: AudioDiskCache,
    private catalog?: Pick<CatalogService, 'recommendations'>,
    private ffmpeg = process.env.FFMPEG_PATH ?? 'ffmpeg',
  ) {
    this.enabled =
      process.env.MUSICBIT_CONTINUOUS_ENABLED !== 'false' &&
      spawnSync(ffmpeg, ['-version'], { stdio: 'ignore', windowsHide: true })
        .status === 0;
    this.root = mkdtempSync(join(tmpdir(), 'musicbit-continuous-'));
    this.cleanupTimer = setInterval(() => this.expire(), 60000);
    this.cleanupTimer.unref();
  }
  private key(user: string, id: string) {
    return `${user}:${id}`;
  }
  private expire() {
    for (const [key, session] of this.sessions)
      if (Date.now() - session.touched > 20 * 60000) {
        session.controller.abort();
        this.sessions.delete(key);
        void session.work
          ?.finally(() =>
            rmSync(session.directory, { recursive: true, force: true }),
          )
          .catch(() => {});
        if (!session.work)
          rmSync(session.directory, { recursive: true, force: true });
      }
  }
  plan(
    user: string,
    id: string,
    ids: string[],
    autoplay = false,
    maxTracks = 500,
  ) {
    if (!this.enabled || !SESSION_ID.test(id))
      throw new Error('Continuous playback unavailable');
    this.expire();
    const key = this.key(user, id);
    let session = this.sessions.get(key);
    if (session) {
      if (
        session.prepared.some(
          (part, index) => index < ids.length && ids[index] !== part.track.id,
        )
      )
        throw new Error('Buffered queue cannot be replaced');
      if (ids.length >= session.ids.length) session.ids = [...ids];
      session.autoplay = autoplay && !!this.catalog;
      session.touched = Date.now();
      this.pump(session);
      return this.timeline(session);
    }
    if (
      this.sessions.size >= 4 ||
      [...this.sessions.values()].filter((s) => s.user === user).length >= 2
    )
      throw new Error('Too many continuous sessions');
    const directory = mkdtempSync(join(this.root, 'session-'));
    session = {
      user,
      id,
      ids: [...ids],
      directory,
      prepared: [],
      cursor: 0,
      touched: Date.now(),
      controller: new AbortController(),
      autoplay: autoplay && !!this.catalog,
      maxTracks,
      additions: [],
    };
    this.sessions.set(key, session);
    this.pump(session);
    return this.timeline(session);
  }
  private timeline(session: Session): ContinuousTimeline {
    return {
      tracks: session.prepared.map((p) => p.track),
      complete:
        session.prepared.length === session.ids.length && !session.autoplay,
      additions: session.additions,
      ...(session.error ? { error: session.error } : {}),
    };
  }
  async find(user: string, id: string, waitMs = 5000) {
    if (!SESSION_ID.test(id)) return;
    const deadline = Date.now() + waitMs;
    do {
      const session = this.sessions.get(this.key(user, id));
      if (session) {
        session.touched = Date.now();
        return session;
      }
      if (Date.now() >= deadline) return;
      await delay(50);
    } while (Date.now() <= deadline);
  }
  async manifest(user: string, id: string) {
    const session = await this.find(user, id);
    if (!session) return;
    const deadline = Date.now() + 90000;
    while (
      !session.prepared.length &&
      !session.error &&
      !session.controller.signal.aborted &&
      Date.now() < deadline
    )
      await delay(100);
    if (!session.prepared.length) return;
    const lines = [
      '#EXTM3U',
      '#EXT-X-VERSION:3',
      '#EXT-X-TARGETDURATION:3',
      '#EXT-X-MEDIA-SEQUENCE:0',
      '#EXT-X-PLAYLIST-TYPE:EVENT',
      '#EXT-X-START:TIME-OFFSET=0,PRECISE=YES',
    ];
    for (const part of session.prepared) {
      if (part.track.index > 0) lines.push('#EXT-X-DISCONTINUITY');
      for (const segment of part.segments)
        lines.push(
          `#EXTINF:${segment.duration.toFixed(6)},`,
          `/api/continuous/${id}/${part.track.index}/${segment.name}`,
        );
    }
    if (
      (session.prepared.length === session.ids.length && !session.autoplay) ||
      session.error
    )
      lines.push('#EXT-X-ENDLIST');
    return `${lines.join('\n')}\n`;
  }
  async metadata(user: string, id: string) {
    const session = await this.find(user, id, 0);
    return session && this.timeline(session);
  }
  async segment(user: string, id: string, index: number, name: string) {
    const session = await this.find(user, id, 0);
    const part = session?.prepared[index];
    if (
      !session ||
      !part ||
      !part.segments.some((segment) => segment.name === name)
    )
      return;
    session.cursor = Math.max(session.cursor, index);
    this.pump(session);
    const path = join(part.directory, name);
    if (!existsSync(path)) await this.convert(session, index, part.directory);
    return existsSync(path) ? path : undefined;
  }
  stop(user: string, id: string) {
    const session = this.sessions.get(this.key(user, id));
    if (!session) return;
    session.touched = 0;
    session.controller.abort();
    this.expire();
  }
  private pump(session: Session) {
    if (session.work || session.error || session.controller.signal.aborted)
      return;
    const work = (async () => {
      while (
        session.prepared.length <= session.cursor + 2 &&
        !session.controller.signal.aborted
      ) {
        if (session.prepared.length >= session.ids.length) {
          if (
            !session.autoplay ||
            session.ids.length >= session.maxTracks ||
            !this.catalog
          ) {
            session.autoplay = false;
            break;
          }
          const response = await this.catalog.recommendations(
            session.ids.at(-1)!,
            session.controller.signal,
          );
          const known = new Set(session.ids);
          const tracks = response.items
            .filter(
              (item) =>
                item.kind === 'track' &&
                item.playback.available &&
                !known.has(item.id),
            )
            .map(catalogItemToTrack)
            .filter((track) =>
              /^\/api\/audio\/[A-Za-z0-9_-]{11}$/.test(track.audioUrl),
            )
            .slice(0, Math.min(10, session.maxTracks - session.ids.length));
          if (!tracks.length) {
            session.autoplay = false;
            break;
          }
          for (const track of tracks) {
            session.additions.push({ index: session.ids.length, track });
            session.ids.push(track.id);
          }
        }
        const index = session.prepared.length;
        const directory = join(session.directory, String(index));
        const segments = await this.convert(session, index, directory);
        const previous = session.prepared.at(-1)?.track;
        session.prepared.push({
          directory,
          segments,
          track: {
            index,
            id: session.ids[index]!,
            start: previous ? previous.start + previous.duration : 0,
            duration: segments.reduce(
              (sum, segment) => sum + segment.duration,
              0,
            ),
          },
        });
      }
    })()
      .catch(() => {
        if (!session.controller.signal.aborted)
          session.error =
            'Preparazione del flusso continuo non riuscita. Tocca Play per riprovare.';
      })
      .finally(() => {
        session.work = undefined;
        this.jobs.delete(work);
      });
    session.work = work;
    this.jobs.add(work);
  }
  private trim(required: number, active: Session, activeIndex: number) {
    let total = 0;
    const directories: { session: Session; part: Prepared; size: number }[] =
      [];
    for (const session of this.sessions.values())
      for (const part of session.prepared) {
        const size = existsSync(part.directory)
          ? readdirSync(part.directory).reduce(
              (sum, name) => sum + statSync(join(part.directory, name)).size,
              0,
            )
          : 0;
        total += size;
        directories.push({ session, part, size });
      }
    directories.sort(
      (a, b) =>
        a.session.touched - b.session.touched ||
        a.part.track.index - b.part.track.index,
    );
    for (const entry of directories) {
      if (total + required <= MAX_TEMP_BYTES) break;
      if (
        (entry.session === active && entry.part.track.index === activeIndex) ||
        Math.abs(entry.part.track.index - entry.session.cursor) <= 1
      )
        continue;
      rmSync(entry.part.directory, { recursive: true, force: true });
      total -= entry.size;
    }
    if (total + required > MAX_TEMP_BYTES)
      throw new Error('Continuous working storage full');
  }
  private async convert(
    session: Session,
    index: number,
    directory: string,
  ): Promise<Segment[]> {
    const id = session.ids[index]!;
    this.cache.plan(
      session.user,
      `hls-${session.id}`,
      session.ids.slice(index, index + 11),
    );
    const deadline = Date.now() + 100000;
    let cached = this.cache.get(session.user, id);
    while (
      !cached &&
      Date.now() < deadline &&
      !session.controller.signal.aborted
    ) {
      await delay(100, undefined, { signal: session.controller.signal });
      cached = this.cache.get(session.user, id);
    }
    if (!cached) throw new Error('Audio not prepared');
    const input = cached;
    let release!: () => void;
    const previous = this.conversion;
    this.conversion = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      if (session.controller.signal.aborted) throw new Error('Cancelled');
      if (existsSync(join(directory, 'track.m3u8')))
        return parseHlsTrack(
          readFileSync(join(directory, 'track.m3u8'), 'utf8'),
        );
      this.trim(Math.ceil(input.size * 1.5) + 1024 * 1024, session, index);
      mkdirSync(directory, { recursive: true });
      await new Promise<void>((resolve, reject) => {
        const process = spawn(
          this.ffmpeg,
          [
            '-hide_banner',
            '-loglevel',
            'error',
            '-nostdin',
            '-y',
            '-i',
            input.path,
            '-map',
            '0:a:0',
            '-vn',
            '-c:a',
            'copy',
            '-f',
            'hls',
            '-hls_time',
            '2',
            '-hls_playlist_type',
            'vod',
            '-hls_flags',
            'independent_segments',
            '-hls_segment_filename',
            join(directory, 'segment-%06d.ts'),
            join(directory, 'track.m3u8'),
          ],
          { stdio: 'ignore', windowsHide: true },
        );
        const abort = () => {
          process.kill();
        };
        const timeout = setTimeout(abort, 30000);
        session.controller.signal.addEventListener('abort', abort, {
          once: true,
        });
        process.once('error', reject);
        process.once('close', (code) => {
          clearTimeout(timeout);
          session.controller.signal.removeEventListener('abort', abort);
          if (code === 0) resolve();
          else reject(new Error('Remux failed'));
        });
      });
      return parseHlsTrack(readFileSync(join(directory, 'track.m3u8'), 'utf8'));
    } catch (error) {
      rmSync(directory, { recursive: true, force: true });
      throw error;
    } finally {
      release();
    }
  }
  async close() {
    clearInterval(this.cleanupTimer);
    for (const session of this.sessions.values()) session.controller.abort();
    await Promise.allSettled(this.jobs);
    rmSync(this.root, { recursive: true, force: true });
  }
}

export function registerContinuousRoutes(
  app: FastifyInstance,
  service: ContinuousAudio | undefined,
  requireUser: (request: FastifyRequest) => { id: string },
) {
  app.get('/api/me/continuous', async (request) => {
    requireUser(request);
    return { enabled: service?.enabled ?? false };
  });
  app.post<{ Params: { id: string }; Body: ContinuousPlan }>(
    '/api/me/continuous/:id',
    {
      schema: {
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string', pattern: '^[a-f0-9-]{36}$' } },
        },
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['ids'],
          properties: {
            autoplay: { type: 'boolean' },
            maxTracks: { type: 'integer', minimum: 1, maximum: 500 },
            ids: {
              type: 'array',
              minItems: 1,
              maxItems: 500,
              items: { type: 'string', pattern: '^[A-Za-z0-9_-]{11}$' },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const user = requireUser(request);
      if (!service?.enabled)
        return reply
          .code(503)
          .send({ error: 'Flusso continuo non disponibile.' });
      try {
        return service.plan(
          user.id,
          request.params.id,
          request.body.ids,
          request.body.autoplay,
          request.body.maxTracks,
        );
      } catch {
        return reply.code(409).send({
          error: 'Coda continua non aggiornabile. Riavvia la riproduzione.',
        });
      }
    },
  );
  app.delete<{ Params: { id: string } }>(
    '/api/me/continuous/:id',
    async (request) => {
      service?.stop(requireUser(request).id, request.params.id);
      return { ok: true };
    },
  );
  app.get<{ Params: { id: string } }>(
    '/api/me/continuous/:id',
    async (request, reply) => {
      const result = await service?.metadata(
        requireUser(request).id,
        request.params.id,
      );
      return (
        result ?? reply.code(404).send({ error: 'Sessione continua scaduta.' })
      );
    },
  );
  app.get<{ Params: { id: string } }>(
    '/api/continuous/:id/index.m3u8',
    async (request, reply) => {
      reply.header('Cache-Control', 'private, no-store');
      const manifest = await service?.manifest(
        requireUser(request).id,
        request.params.id,
      );
      return manifest
        ? reply.type('application/vnd.apple.mpegurl').send(manifest)
        : reply.code(503).send();
    },
  );
  app.get<{ Params: { id: string; index: string; name: string } }>(
    '/api/continuous/:id/:index/:name',
    async (request, reply) => {
      const user = requireUser(request);
      if (
        !/^\d{1,3}$/.test(request.params.index) ||
        !/^segment-\d{6}\.ts$/.test(request.params.name)
      )
        return reply.code(400).send();
      const path = await service?.segment(
        user.id,
        request.params.id,
        Number(request.params.index),
        request.params.name,
      );
      return path
        ? reply
            .type('video/mp2t')
            .header('Cache-Control', 'private, max-age=300')
            .send(createReadStream(path))
        : reply.code(404).send();
    },
  );
}
