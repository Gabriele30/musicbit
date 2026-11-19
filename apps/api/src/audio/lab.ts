import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  appendFileSync,
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AudioDiskCache } from './disk-cache.js';

/**
 * Device playback laboratory.
 *
 * Windows browsers cannot reproduce how iOS schedules a locked PWA. These
 * routes let the real device compare track-transition strategies on short
 * clips cut from the account's own cached audio, and record what the media
 * element actually did. Nothing here is used by normal playback.
 */
export const LAB_CLIPS = 3;
export const LAB_CLIP_SECONDS = 20;
const LAB_CLIP_OFFSET = 45;
const DIAGNOSTICS_MAX_BYTES = 4 * 1024 * 1024;
const DIAGNOSTICS_MAX_BATCH = 400;

const hash = (value: string) =>
  createHash('sha256').update(value).digest('hex').slice(0, 32);

function run(command: string, args: string[], timeoutMs = 30000) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'ignore', 'pipe'],
      windowsHide: true,
    });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-2000);
    });
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.on('error', reject);
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-300)}`));
    });
  });
}

export interface LabClip {
  index: number;
  sourceId: string;
  duration: number;
}

export class PlaybackLab {
  private preparing = new Map<string, Promise<LabClip[]>>();
  constructor(
    private cache: AudioDiskCache,
    private root = join(tmpdir(), 'musicbit-lab'),
    private ffmpeg = process.env.FFMPEG_PATH ?? 'ffmpeg',
  ) {}
  directory(user: string) {
    return join(this.root, hash(user));
  }
  clips(user: string): Promise<LabClip[]> {
    const existing = this.preparing.get(user);
    if (existing) return existing;
    const work = this.prepare(user).finally(() => {
      // Keep the finished result on disk; allow later re-preparation.
      setTimeout(() => this.preparing.delete(user), 1000).unref?.();
    });
    this.preparing.set(user, work);
    return work;
  }
  private async prepare(user: string): Promise<LabClip[]> {
    const directory = this.directory(user);
    const manifest = join(directory, 'clips.json');
    if (existsSync(manifest)) {
      try {
        const clips = JSON.parse(readFileSync(manifest, 'utf8')) as LabClip[];
        if (
          clips.length === LAB_CLIPS &&
          clips.every((clip) =>
            existsSync(join(directory, `clip-${clip.index}.m4a`)),
          )
        )
          return clips;
      } catch {
        /* Regenerate below. */
      }
    }
    rmSync(directory, { recursive: true, force: true });
    mkdirSync(directory, { recursive: true });
    const sources = this.cache
      .entries(user)
      .filter(
        (entry) =>
          (entry.durationSeconds ?? 0) >= LAB_CLIP_OFFSET + LAB_CLIP_SECONDS,
      )
      .sort((a, b) => b.touched - a.touched)
      .slice(0, LAB_CLIPS);
    if (sources.length < LAB_CLIPS)
      throw new Error('Servono almeno tre brani già in cache.');
    const clips: LabClip[] = [];
    for (const [index, source] of sources.entries()) {
      const input = this.cache.get(user, source.id)?.path;
      if (!input) throw new Error('Sorgente non disponibile.');
      const m4a = join(directory, `clip-${index}.m4a`);
      // Re-encode: exact clip boundaries, canonical AAC-LC 44.1 kHz stereo.
      await run(this.ffmpeg, [
        '-hide_banner',
        '-nostdin',
        '-ss',
        String(LAB_CLIP_OFFSET),
        '-t',
        String(LAB_CLIP_SECONDS),
        '-i',
        input,
        '-vn',
        '-ac',
        '2',
        '-ar',
        '44100',
        '-c:a',
        'aac',
        '-b:a',
        '128k',
        '-af',
        'afade=t=in:d=0.3',
        '-movflags',
        '+faststart',
        '-y',
        m4a,
      ]);
      await run(this.ffmpeg, [
        '-hide_banner',
        '-nostdin',
        '-i',
        m4a,
        '-c',
        'copy',
        '-movflags',
        'frag_keyframe+empty_moov+default_base_moof',
        '-y',
        join(directory, `clip-${index}.frag.mp4`),
      ]);
      const hls = join(directory, `hls-${index}`);
      mkdirSync(hls, { recursive: true });
      await run(this.ffmpeg, [
        '-hide_banner',
        '-nostdin',
        '-i',
        m4a,
        '-c',
        'copy',
        '-f',
        'hls',
        '-hls_time',
        '2',
        '-hls_playlist_type',
        'vod',
        '-hls_segment_type',
        'mpegts',
        '-hls_segment_filename',
        join(hls, 'segment-%03d.ts'),
        '-y',
        join(hls, 'index.m3u8'),
      ]);
      clips.push({ index, sourceId: source.id, duration: LAB_CLIP_SECONDS });
    }
    writeFileSync(manifest, JSON.stringify(clips));
    return clips;
  }
  /** One finite VOD playlist: clip boundaries are discontinuities, no JS needed. */
  playlist(user: string) {
    const directory = this.directory(user);
    const lines = [
      '#EXTM3U',
      '#EXT-X-VERSION:3',
      '#EXT-X-TARGETDURATION:3',
      '#EXT-X-PLAYLIST-TYPE:VOD',
      '#EXT-X-MEDIA-SEQUENCE:0',
    ];
    for (let index = 0; index < LAB_CLIPS; index++) {
      const path = join(directory, `hls-${index}`, 'index.m3u8');
      if (!existsSync(path)) return;
      const source = readFileSync(path, 'utf8').split('\n');
      if (index > 0) lines.push('#EXT-X-DISCONTINUITY');
      for (let i = 0; i < source.length; i++) {
        const line = source[i]!.trim();
        if (line.startsWith('#EXTINF')) {
          const name = source[i + 1]?.trim();
          if (!name || !/^segment-\d{3}\.ts$/.test(name)) return;
          lines.push(line, `/api/me/lab/hls/${index}/${name}`);
          i++;
        }
      }
    }
    lines.push('#EXT-X-ENDLIST');
    return `${lines.join('\n')}\n`;
  }
}

function sendFile(
  request: FastifyRequest,
  reply: FastifyReply,
  path: string,
  type: string,
) {
  if (!existsSync(path)) return reply.code(404).send();
  const size = statSync(path).size;
  reply
    .header('Accept-Ranges', 'bytes')
    .header('Cache-Control', 'private, no-store')
    .type(type);
  const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range ?? '');
  if (!range) {
    reply.header('Content-Length', size);
    return reply.send(createReadStream(path));
  }
  let start = range[1] ? Number(range[1]) : size - Number(range[2]);
  let end = range[1] && range[2] ? Number(range[2]) : size - 1;
  start = Math.max(0, start);
  end = Math.min(size - 1, end);
  if (!(start <= end))
    return reply.code(416).header('Content-Range', `bytes */${size}`).send();
  return reply
    .code(206)
    .header('Content-Range', `bytes ${start}-${end}/${size}`)
    .header('Content-Length', end - start + 1)
    .send(createReadStream(path, { start, end }));
}

/** Bounded per-account JSONL store for device playback diagnostics. */
export class DiagnosticsStore {
  constructor(private root: string) {
    mkdirSync(root, { recursive: true });
  }
  private file(user: string) {
    return join(this.root, `${hash(user)}.jsonl`);
  }
  append(user: string, records: unknown[]) {
    const path = this.file(user);
    const text = records
      .map((record) => JSON.stringify({ receivedAt: Date.now(), ...(record as object) }))
      .join('\n');
    if (!text) return;
    try {
      if (existsSync(path) && statSync(path).size > DIAGNOSTICS_MAX_BYTES)
        renameSync(path, `${path}.1`);
    } catch {
      /* Rotation is best-effort. */
    }
    appendFileSync(path, `${text}\n`);
  }
  read(user: string, limit = 2000) {
    const path = this.file(user);
    if (!existsSync(path)) return [];
    return readFileSync(path, 'utf8').trim().split('\n').slice(-limit);
  }
  clear(user: string) {
    for (const name of readdirSync(this.root))
      if (name.startsWith(hash(user)))
        rmSync(join(this.root, name), { force: true });
  }
}

const SAFE_TEXT = /^[\w .:/=,+\-#[\]()'"àèéìòù%|@]*$/i;
/** Diagnostics carry event names and numbers only; drop anything unexpected. */
export function sanitizeDiagnostic(input: unknown) {
  if (!input || typeof input !== 'object') return;
  const output: Record<string, string | number | boolean | null> = {};
  let fields = 0;
  for (const [key, value] of Object.entries(input)) {
    if (++fields > 40 || !/^[a-zA-Z][a-zA-Z0-9]{0,31}$/.test(key)) continue;
    if (typeof value === 'number' && Number.isFinite(value))
      output[key] = Math.round(value * 1000) / 1000;
    else if (typeof value === 'boolean' || value === null) output[key] = value;
    else if (
      typeof value === 'string' &&
      value.length <= 200 &&
      SAFE_TEXT.test(value)
    )
      output[key] = value;
  }
  return output;
}

export function registerLabRoutes(
  app: FastifyInstance,
  requireUser: (request: FastifyRequest) => { id: string },
  diagnostics: DiagnosticsStore | undefined,
  lab: PlaybackLab | undefined,
) {
  app.post<{ Body: { records: unknown[] } }>(
    '/api/me/diagnostics',
    {
      bodyLimit: 512 * 1024,
      schema: {
        body: {
          type: 'object',
          required: ['records'],
          properties: {
            records: {
              type: 'array',
              maxItems: DIAGNOSTICS_MAX_BATCH,
              items: { type: 'object' },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const user = requireUser(request);
      if (!diagnostics) return reply.code(503).send({ stored: 0 });
      const records = request.body.records
        .map(sanitizeDiagnostic)
        .filter((record) => record !== undefined);
      diagnostics.append(user.id, records);
      return { stored: records.length };
    },
  );
  app.get('/api/me/diagnostics', async (request, reply) => {
    const user = requireUser(request);
    if (!diagnostics) return reply.code(503).send({ records: [] });
    reply.header('Cache-Control', 'private, no-store');
    return {
      records: diagnostics.read(user.id).map((line) => {
        try {
          return JSON.parse(line) as unknown;
        } catch {
          return null;
        }
      }),
    };
  });
  app.delete('/api/me/diagnostics', async (request) => {
    diagnostics?.clear(requireUser(request).id);
    return { ok: true };
  });
  app.get('/api/me/lab', async (request, reply) => {
    const user = requireUser(request);
    reply.header('Cache-Control', 'private, no-store');
    if (!lab)
      return reply
        .code(503)
        .send({ error: 'Laboratorio non disponibile su questo server.' });
    try {
      return { clips: await lab.clips(user.id), seconds: LAB_CLIP_SECONDS };
    } catch (error) {
      return reply.code(409).send({
        error:
          error instanceof Error && error.message.startsWith('Servono')
            ? error.message
            : 'Preparazione delle clip non riuscita.',
      });
    }
  });
  app.get<{ Params: { name: string } }>(
    '/api/me/lab/clip/:name',
    async (request, reply) => {
      const user = requireUser(request);
      const match = /^clip-(\d)\.(m4a|frag\.mp4)$/.exec(request.params.name);
      if (!lab || !match || Number(match[1]) >= LAB_CLIPS)
        return reply.code(404).send();
      return sendFile(
        request,
        reply,
        join(lab.directory(user.id), request.params.name),
        'audio/mp4',
      );
    },
  );
  app.get('/api/me/lab/hls.m3u8', async (request, reply) => {
    const user = requireUser(request);
    const playlist = lab?.playlist(user.id);
    return playlist
      ? reply
          .header('Cache-Control', 'private, no-store')
          .type('application/vnd.apple.mpegurl')
          .send(playlist)
      : reply.code(404).send();
  });
  app.get<{ Params: { index: string; name: string } }>(
    '/api/me/lab/hls/:index/:name',
    async (request, reply) => {
      const user = requireUser(request);
      if (
        !lab ||
        !/^\d$/.test(request.params.index) ||
        !/^segment-\d{3}\.ts$/.test(request.params.name)
      )
        return reply.code(404).send();
      return sendFile(
        request,
        reply,
        join(
          lab.directory(user.id),
          `hls-${request.params.index}`,
          request.params.name,
        ),
        'video/mp2t',
      );
    },
  );
}
