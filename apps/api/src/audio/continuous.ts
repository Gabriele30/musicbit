import { execFile, spawn, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import {
  createReadStream,
  existsSync,
  mkdirSync,
  openSync,
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
  LocalLibrary,
  Track,
} from '@musicbit/shared';
import type { AudioDiskCache } from './disk-cache.js';
import {
  catalogItemToTrack,
  emptyLibrary,
  PLAYBACK_QUEUE_LIMIT,
} from '@musicbit/shared';
import { cachedRadio, personalRadio, type RadioCatalog } from './radio.js';
import { AudioResolutionError } from './stream-service.js';

interface Segment {
  duration: number;
  name: string;
}
interface Prepared {
  track: ContinuousTrack;
  segments: Segment[];
  directory: string;
  longestWindowSeconds: number;
  leases: number;
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
  notice?: string;
  autoplay: boolean;
  maxTracks: number;
  additions: NonNullable<ContinuousTimeline['additions']>;
  queueStart: number;
  mediaSequence: number;
  radioRetries: number;
  recentIds: string[];
  retired: { part: Prepared; until: number }[];
  revision: number;
}
const SESSION_ID = /^[a-f0-9-]{36}$/;
const MAX_TEMP_BYTES = 512 * 1024 * 1024;
const probeFile = promisify(execFile);
const AAC_FRAME_SECONDS = 1024 / 44100;

export function parseHlsTrack(text: string, alignAacFrames = false): Segment[] {
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
    result.push({
      // MP4 can trim the last packet's declared duration, but MPEG-TS renders
      // the whole AAC frame. Keep the shared timeline aligned with the audio.
      duration: alignAacFrames
        ? Math.max(1, Math.ceil(duration / AAC_FRAME_SECONDS - 0.0001)) *
          AAC_FRAME_SECONDS
        : duration,
      name,
    });
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
    private catalog?: RadioCatalog,
    private ffmpeg = process.env.FFMPEG_PATH ?? 'ffmpeg',
    private profile?: (user: string) => LocalLibrary,
    private maxTempBytes = MAX_TEMP_BYTES,
  ) {
    if (!Number.isSafeInteger(maxTempBytes) || maxTempBytes < 1)
      throw new Error('Invalid continuous storage budget');
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
    for (const [key, session] of this.sessions) {
      this.expireRetired(session);
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
  }
  plan(
    user: string,
    id: string,
    ids: string[],
    autoplay = false,
    maxTracks = PLAYBACK_QUEUE_LIMIT,
    queueStart = 0,
  ) {
    if (!this.enabled || !SESSION_ID.test(id))
      throw new Error('Continuous playback unavailable');
    this.expire();
    const key = this.key(user, id);
    let session = this.sessions.get(key);
    if (session) {
      // Old requests can arrive after native playback has advanced the window.
      // Align by absolute index; never replace bytes already published in HLS.
      const start = Math.max(session.queueStart, queueStart);
      const next = ids.slice(start - queueStart);
      if (
        session.prepared.some(
          (part) =>
            part.track.index >= start &&
            part.track.index - start < next.length &&
            next[part.track.index - start] !== part.track.id,
        )
      )
        throw new Error('Buffered queue cannot be replaced');
      if (queueStart > session.queueStart + session.ids.length)
        throw new Error('Continuous queue contains a gap');
      if (queueStart + ids.length >= session.queueStart + session.ids.length)
        session.ids = [
          ...session.ids.slice(0, start - session.queueStart),
          ...next,
        ];
      session.autoplay = autoplay && !!this.catalog;
      session.maxTracks = Math.max(session.maxTracks, maxTracks);
      session.revision++;
      session.touched = Date.now();
      this.pump(session);
      return this.timeline(session);
    }
    if (
      this.sessions.size >= 4 ||
      [...this.sessions.values()].filter((s) => s.user === user).length >= 2
    )
      throw new Error('Too many continuous sessions');
    if (queueStart !== 0)
      throw new Error('New continuous queues start at zero');
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
      queueStart,
      mediaSequence: 0,
      radioRetries: 0,
      recentIds: [],
      retired: [],
      revision: 1,
    };
    this.sessions.set(key, session);
    this.pump(session);
    return this.timeline(session);
  }
  private timeline(session: Session): ContinuousTimeline {
    return {
      tracks: session.prepared.map((p) => p.track),
      revision: session.revision,
      queueStart: session.queueStart,
      complete:
        session.prepared.length === session.ids.length && !session.autoplay,
      additions: session.additions.map((addition) => ({ ...addition })),
      ...(session.error ? { error: session.error } : {}),
      ...(session.notice ? { notice: session.notice } : {}),
    };
  }
  async find(user: string, id: string, waitMs = 5000) {
    if (!SESSION_ID.test(id)) return;
    const deadline = Date.now() + waitMs;
    do {
      const session = this.sessions.get(this.key(user, id));
      if (session) {
        this.expireRetired(session);
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
    const windowSeconds = session.prepared.reduce(
      (total, part) => total + part.track.duration,
      0,
    );
    const lines = [
      '#EXTM3U',
      '#EXT-X-VERSION:3',
      '#EXT-X-TARGETDURATION:3',
      `#EXT-X-MEDIA-SEQUENCE:${session.mediaSequence}`,
      `#EXT-X-DISCONTINUITY-SEQUENCE:${session.queueStart}`,
      // The window may roll later (including when autoplay is enabled after
      // starting an album), so never promise the append-only EVENT contract.
      ...(session.queueStart === 0
        ? ['#EXT-X-START:TIME-OFFSET=0,PRECISE=YES']
        : []),
    ];
    for (const [index, part] of session.prepared.entries()) {
      part.longestWindowSeconds = Math.max(
        part.longestWindowSeconds,
        windowSeconds,
      );
      if (index > 0) lines.push('#EXT-X-DISCONTINUITY');
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
    return this.segmentResource(user, id, index, name, (path) => path, true);
  }
  async openSegment(user: string, id: string, index: number, name: string) {
    return this.segmentResource(user, id, index, name, (path) =>
      createReadStream(path, { fd: openSync(path, 'r'), autoClose: true }),
    );
  }
  private async segmentResource<T>(
    user: string,
    id: string,
    index: number,
    name: string,
    acquire: (path: string) => T,
    holdUntilNextTurn = false,
  ): Promise<T | undefined> {
    const session = await this.find(user, id, 0);
    const part =
      session?.prepared[index - session.queueStart] ??
      session?.retired.find((entry) => entry.part.track.index === index)?.part;
    if (
      !session ||
      !part ||
      !part.segments.some((segment) => segment.name === name)
    )
      return;
    part.leases++;
    try {
      if (
        index >= session.cursor &&
        session.recentIds.at(-1) !== part.track.id
      ) {
        session.recentIds.push(part.track.id);
        if (session.recentIds.length > 200) session.recentIds.shift();
      }
      session.cursor = Math.max(session.cursor, index);
      this.prune(session);
      this.pump(session);
      const path = join(part.directory, name);
      if (!existsSync(path))
        await this.convert(session, index, part.directory, part.track.id);
      return existsSync(path) ? acquire(path) : undefined;
    } finally {
      // Path consumers get one turn to open/read their resource. HTTP uses an
      // already-open file descriptor, which stays valid after pathname eviction.
      if (holdUntilNextTurn) setImmediate(() => part.leases--);
      else part.leases--;
    }
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
        session.queueStart + session.prepared.length <= session.cursor + 2 &&
        !session.controller.signal.aborted
      ) {
        if (session.prepared.length >= session.ids.length) {
          if (!session.autoplay || !this.catalog) {
            session.autoplay = false;
            break;
          }
          const tracks = await this.radioTracks(session);
          if (!tracks.length) {
            // Keep the same native playlist open through transient catalog
            // outages and empty batches. No JavaScript wake-up is needed.
            await delay(
              Math.min(1000 * 2 ** Math.min(session.radioRetries++, 5), 30000),
              undefined,
              {
                signal: session.controller.signal,
              },
            );
            continue;
          }
          session.radioRetries = 0;
          for (const track of tracks) {
            session.additions.push({
              index: session.queueStart + session.ids.length,
              track,
            });
            session.ids.push(track.id);
          }
          session.revision++;
        }
        const index = session.queueStart + session.prepared.length;
        const directory = join(session.directory, String(index));
        const segments = await this.convert(session, index, directory);
        const previous = session.prepared.at(-1)?.track;
        session.prepared.push({
          directory,
          segments,
          longestWindowSeconds: 0,
          leases: 0,
          track: {
            index,
            id: session.ids[index - session.queueStart]!,
            start: previous ? previous.start + previous.duration : 0,
            duration: segments.reduce(
              (sum, segment) => sum + segment.duration,
              0,
            ),
          },
        });
        session.revision++;
      }
    })()
      .catch((error: unknown) => {
        if (!session.controller.signal.aborted) {
          session.error =
            error instanceof AudioResolutionError &&
            error.code === 'PROVIDER_RESTRICTED'
              ? error.message
              : 'Preparazione del flusso continuo non riuscita. Tocca Play per riprovare.';
          session.revision++;
        }
      })
      .finally(() => {
        session.work = undefined;
        this.jobs.delete(work);
      });
    session.work = work;
    this.jobs.add(work);
  }
  private async radioTracks(session: Session): Promise<Track[]> {
    const library = this.profile?.(session.user) ?? emptyLibrary();
    const tracks: Track[] = [];
    if (!this.cache.providerRestricted(session.user)) {
      const response = await personalRadio(
        this.catalog!,
        session.ids[session.cursor - session.queueStart] ?? session.ids.at(-1)!,
        session.controller.signal,
        library,
        [...session.recentIds, ...session.ids],
      );
      // Do not publish a suggested track in the native program until its
      // complete source exists. One unavailable suggestion must not end radio.
      const deadline = Date.now() + 20000;
      for (const item of response.items.slice(0, 6)) {
        if (Date.now() >= deadline) break;
        const track = catalogItemToTrack(item);
        if (!/^\/api\/audio\/[A-Za-z0-9_-]{11}$/.test(track.audioUrl)) continue;
        this.cache.plan(session.user, `hls-${session.id}`, [
          track.id,
          ...session.ids.slice(-10),
        ]);
        while (
          !this.cache.get(session.user, track.id) &&
          !this.cache.failure(session.user, track.id) &&
          Date.now() < deadline
        ) {
          await delay(100, undefined, { signal: session.controller.signal });
        }
        if (this.cache.get(session.user, track.id)) tracks.push(track);
        if (tracks.length >= 3 || this.cache.providerRestricted(session.user))
          break;
      }
    }
    if (tracks.length) {
      session.notice = undefined;
      return tracks;
    }
    session.notice = this.cache.providerRestricted(session.user)
      ? 'Il fornitore richiede una verifica di accesso. Continuiamo con i tuoi ascolti già in cache.'
      : 'Nuovi brani temporaneamente non disponibili. Continuiamo con i tuoi ascolti già in cache.';
    session.revision++;
    const fallback = cachedRadio(
      library,
      (id) => !!this.cache.get(session.user, id),
      session.ids.slice(-3),
    );
    if (fallback.length || !this.catalog?.details) return fallback;
    // A new account may have cached its first song before history was synced.
    // Resolve only its catalog metadata; never require another audio download.
    const seed =
      session.ids[session.cursor - session.queueStart] ?? session.ids.at(-1)!;
    if (!this.cache.get(session.user, seed)) return [];
    try {
      const { item } = await this.catalog.details(
        'track',
        seed,
        session.controller.signal,
      );
      if (item.kind !== 'track' || item.id !== seed) return [];
      return cachedRadio(
        {
          ...library,
          favorites: [...library.favorites, catalogItemToTrack(item)],
        },
        (id) => !!this.cache.get(session.user, id),
        [],
      );
    } catch {
      session.controller.signal.throwIfAborted();
      return [];
    }
  }
  private prune(session: Session) {
    const count = Math.min(
      session.prepared.length - 1,
      session.cursor - session.queueStart - 20,
    );
    if (count <= 0) return;
    const windowSeconds = session.prepared.reduce(
      (total, part) => total + part.track.duration,
      0,
    );
    for (const part of session.prepared.splice(0, count)) {
      session.mediaSequence += part.segments.length;
      // RFC 8216 §6.2.2: a stale playlist may still request a removed URI.
      // Keep its identity until the longest published window plus a segment
      // duration expires. Under disk pressure its bytes can be remuxed again.
      session.retired.push({
        part,
        until:
          Date.now() +
          Math.ceil(
            (Math.max(windowSeconds, part.longestWindowSeconds) + 3) * 1000,
          ),
      });
    }
    session.ids.splice(0, count);
    session.queueStart += count;
    session.revision++;
    session.additions = session.additions.filter(
      (addition) => addition.index >= session.queueStart,
    );
    this.expireRetired(session);
  }
  private expireRetired(session: Session) {
    const now = Date.now();
    session.retired = session.retired.filter((entry) => {
      if (entry.until >= now || entry.part.leases > 0) return true;
      rmSync(entry.part.directory, { recursive: true, force: true });
      return false;
    });
  }
  private trim(required: number, active: Session, activeIndex: number) {
    const sizes = new Map<string, number>();
    const measure = (directory: string): number => {
      const size = readdirSync(directory, { withFileTypes: true }).reduce(
        (sum, entry) => {
          const path = join(directory, entry.name);
          return (
            sum + (entry.isDirectory() ? measure(path) : statSync(path).size)
          );
        },
        0,
      );
      sizes.set(directory, size);
      return size;
    };
    // Count completed conversions before their promise continuation publishes
    // metadata, and aborted sessions still finishing cleanup, as well.
    let total = measure(this.root);
    const directories: { session: Session; part: Prepared; size: number }[] =
      [];
    for (const session of this.sessions.values())
      for (const part of [
        ...session.prepared,
        ...session.retired.map((entry) => entry.part),
      ]) {
        const size = sizes.get(part.directory) ?? 0;
        directories.push({ session, part, size });
      }
    directories.sort(
      (a, b) =>
        a.session.touched - b.session.touched ||
        a.part.track.index - b.part.track.index,
    );
    for (const entry of directories) {
      if (total + required <= this.maxTempBytes) break;
      if (
        (entry.session === active && entry.part.track.index === activeIndex) ||
        entry.part.leases > 0 ||
        Math.abs(entry.part.track.index - entry.session.cursor) <= 1
      )
        continue;
      rmSync(entry.part.directory, { recursive: true, force: true });
      total -= entry.size;
    }
    if (total + required > this.maxTempBytes)
      throw new Error('Continuous working storage full');
  }
  private async convert(
    session: Session,
    index: number,
    directory: string,
    trackId?: string,
  ): Promise<Segment[]> {
    const relativeIndex = index - session.queueStart;
    const id = trackId ?? session.ids[relativeIndex]!;
    this.cache.plan(
      session.user,
      `hls-${session.id}`,
      relativeIndex < 0
        ? [
            id,
            ...session.ids.slice(
              Math.max(0, session.cursor - session.queueStart),
              Math.max(0, session.cursor - session.queueStart) + 10,
            ),
          ]
        : session.ids.slice(relativeIndex, relativeIndex + 11),
    );
    const deadline = Date.now() + 100000;
    let cached = this.cache.get(session.user, id);
    while (
      !cached &&
      Date.now() < deadline &&
      !session.controller.signal.aborted
    ) {
      if (this.cache.failure(session.user, id)) {
        const restricted =
          this.cache.failure(session.user, id) === 'PROVIDER_RESTRICTED';
        throw new AudioResolutionError(
          restricted
            ? 'Il fornitore richiede una verifica di accesso dal server. I brani già in cache restano disponibili.'
            : 'Audio temporaneamente non disponibile.',
          restricted ? 'PROVIDER_RESTRICTED' : 'UNAVAILABLE',
        );
      }
      await delay(100, undefined, { signal: session.controller.signal });
      cached = this.cache.get(session.user, id);
    }
    if (!cached) throw new Error('Audio not prepared');
    const input = cached;
    let copyAac = false;
    try {
      const probe = this.ffmpeg.replace(/ffmpeg(\.exe)?$/i, 'ffprobe$1');
      const { stdout } = await probeFile(
        probe,
        [
          '-v',
          'error',
          '-select_streams',
          'a:0',
          '-show_entries',
          'stream=codec_name,profile,sample_rate,channels',
          '-of',
          'json',
          input.path,
        ],
        {
          signal: session.controller.signal,
          timeout: 5000,
          maxBuffer: 64 * 1024,
          windowsHide: true,
        },
      );
      const stream = JSON.parse(stdout).streams?.[0];
      copyAac =
        stream?.codec_name === 'aac' &&
        stream.profile === 'LC' &&
        Number(stream.sample_rate) === 44100 &&
        stream.channels === 2;
    } catch {
      session.controller.signal.throwIfAborted();
      // Unknown formats are normalized instead of publishing an incompatible
      // Opus/profile/rate/channel change inside the iPhone's native decoder.
    }
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
          true,
        );
      this.trim(
        Math.ceil(
          copyAac
            ? input.size * 1.5
            : Math.max(
                input.size * 1.5,
                (input.durationSeconds ?? input.size / 12000) * 20000,
              ),
        ) +
          1024 * 1024,
        session,
        index,
      );
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
            ...(copyAac
              ? ['-c:a', 'copy']
              : [
                  '-c:a',
                  'aac',
                  '-profile:a',
                  'aac_low',
                  '-ar',
                  '44100',
                  '-ac',
                  '2',
                  '-b:a',
                  '128k',
                ]),
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
      return parseHlsTrack(
        readFileSync(join(directory, 'track.m3u8'), 'utf8'),
        true,
      );
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
  catalog?: RadioCatalog,
  profile?: (user: string) => LocalLibrary,
) {
  app.get<{ Params: { id: string }; Querystring: { exclude?: string } }>(
    '/api/me/radio/:id',
    {
      schema: {
        params: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'string', pattern: '^[A-Za-z0-9_-]{11}$' },
          },
        },
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            exclude: {
              type: 'string',
              maxLength: 2399,
              pattern: '^[A-Za-z0-9_-]{11}(,[A-Za-z0-9_-]{11}){0,199}$',
            },
          },
        },
      },
    },
    async (request, reply) => {
      const user = requireUser(request);
      if (!catalog)
        return reply.code(503).send({ error: 'Radio non disponibile.' });
      const controller = new AbortController();
      const closed = () => {
        if (!reply.raw.writableFinished) controller.abort();
      };
      reply.raw.once('close', closed);
      reply.header('Cache-Control', 'private, no-store');
      try {
        return await personalRadio(
          catalog,
          request.params.id,
          controller.signal,
          profile?.(user.id),
          request.query.exclude?.split(','),
        );
      } finally {
        reply.raw.off('close', closed);
      }
    },
  );
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
            maxTracks: {
              type: 'integer',
              minimum: 1,
              maximum: PLAYBACK_QUEUE_LIMIT,
            },
            queueStart: {
              type: 'integer',
              minimum: 0,
              maximum: Number.MAX_SAFE_INTEGER,
            },
            ids: {
              type: 'array',
              minItems: 1,
              maxItems: PLAYBACK_QUEUE_LIMIT,
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
          request.body.queueStart,
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
        !/^\d{1,15}$/.test(request.params.index) ||
        !Number.isSafeInteger(Number(request.params.index)) ||
        !/^segment-\d{6}\.ts$/.test(request.params.name)
      )
        return reply.code(400).send();
      const stream = await service?.openSegment(
        user.id,
        request.params.id,
        Number(request.params.index),
        request.params.name,
      );
      return stream
        ? reply
            .type('video/mp2t')
            .header('Cache-Control', 'private, max-age=300')
            .send(stream)
        : reply.code(404).send();
    },
  );
}
