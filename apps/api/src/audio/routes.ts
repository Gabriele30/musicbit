import { Readable, Transform } from 'node:stream';
import { patchAudioChunk, type AudioBytePatch } from './mp4.js';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AudioDiskCache } from './disk-cache.js';
import { AUDIO_PREFETCH_LIMIT, AudioByteCache } from './byte-cache.js';
import {
  AudioResolutionError,
  type AudioStreamService,
} from './stream-service.js';

export function registerAudioRoutes(
  app: FastifyInstance,
  service: AudioStreamService,
  options: {
    headerTimeoutMs?: number;
    idleTimeoutMs?: number;
    diskCache?: AudioDiskCache;
    userId?: (request: FastifyRequest) => string | undefined;
  } = {},
) {
  const byteCache = new AudioByteCache();
  const diskEntry = (user: string | undefined, id: string) => {
    try {
      return user ? options.diskCache?.get(user, id) : undefined;
    } catch {
      app.log.warn(
        { code: 'AUDIO_CACHE_READ_ERROR' },
        'Audio cache unavailable',
      );
      return undefined;
    }
  };
  let cacheWrites = 0;
  app.addHook('onClose', async () => byteCache.clear());
  app.get<{ Params: { id: string } }>(
    '/api/audio/:id/info',
    async (request, reply) => {
      reply.header('Cache-Control', 'private, no-store');
      try {
        const user = options.userId?.(request);
        const cached = diskEntry(user, request.params.id);
        if (cached) return { durationSeconds: cached.durationSeconds ?? null };
        const resolved = await service.resolve(request.params.id);
        // Warm the first visible choice before the user presses play, too.
        if (user) {
          try {
            options.diskCache?.plan(user, 'discovery', [request.params.id]);
          } catch {
            /* Optional warmup must not affect metadata or playback. */
          }
        }
        return { durationSeconds: resolved.durationSeconds ?? null };
      } catch (error) {
        if (error instanceof AudioResolutionError)
          return reply.code(error.status).send({
            code: error.code,
            error: error.message,
          });
        throw error;
      }
    },
  );
  app.route<{ Params: { id: string } }>({
    method: ['GET', 'HEAD'],
    url: '/api/audio/:id',
    handler: async (request, reply) => {
      reply.header('Cache-Control', 'private, no-store');
      const { id } = request.params;
      if (!/^[A-Za-z0-9_-]{11}$/.test(id))
        return reply
          .code(400)
          .send({ code: 'INVALID_ID', error: 'ID video non valido.' });
      const range = request.headers.range;
      if (range && !/^bytes=(?:\d+-\d*|-\d+)$/.test(range))
        return reply.code(400).send({
          code: 'INVALID_RANGE',
          error: 'Intervallo audio non valido.',
        });

      const user = options.userId?.(request);
      const disk = !request.headers['if-range']
        ? diskEntry(user, id)
        : undefined;
      const cached =
        !request.headers['if-range'] && (disk || byteCache.get(id));
      if (cached) {
        const total = 'size' in cached ? cached.size : cached.bytes.length;
        const [from, to] = range?.slice(6).split('-') ?? [];
        const start =
          from === '' ? Math.max(0, total - Number(to)) : Number(from ?? 0);
        const end =
          from === '' || !to ? total - 1 : Math.min(Number(to), total - 1);
        reply.header('Cache-Control', 'private, no-store');
        reply.header('Accept-Ranges', 'bytes');
        reply.header('X-MusicBit-Audio-Cache', 'hit');
        if (disk) reply.header('X-MusicBit-Audio-Storage', 'disk');
        if (start > end || start >= total) {
          reply.header('Content-Range', `bytes */${total}`);
          return reply.code(416).send();
        }
        reply.type(cached.mimeType);
        reply.header('Content-Length', end - start + 1);
        if (range) {
          reply.code(206);
          reply.header('Content-Range', `bytes ${start}-${end}/${total}`);
        }
        return reply.send(
          request.method === 'HEAD'
            ? undefined
            : 'stream' in cached
              ? cached.stream(start, end)
              : cached.bytes.subarray(start, end + 1),
        );
      }

      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      let timedOut = false;
      const disconnected = () => {
        if (!reply.raw.writableFinished) controller.abort();
        cleanup();
      };
      const cleanup = () => {
        clearTimeout(timer);
        request.raw.removeListener('aborted', disconnected);
        reply.raw.removeListener('close', disconnected);
        reply.raw.removeListener('finish', cleanup);
      };
      const armTimeout = (ms: number) => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          timedOut = true;
          controller.abort();
        }, ms);
        timer.unref();
      };
      request.raw.once('aborted', disconnected);
      reply.raw.once('close', disconnected);
      reply.raw.once('finish', cleanup);
      const headers: Record<string, string> = {
        'User-Agent': 'Mozilla/5.0',
        Referer: 'https://music.youtube.com/',
        Origin: 'https://music.youtube.com',
      };
      if (range) headers.Range = range;
      if (typeof request.headers['if-range'] === 'string')
        headers['If-Range'] = request.headers['if-range'];

      let upstream: Response;
      let mimeType: string;
      let patches: AudioBytePatch[] | undefined;
      try {
        let resolved = await service.resolve(id, controller.signal);
        const fetchStream = () => {
          armTimeout(options.headerTimeoutMs ?? 15000);
          return fetch(resolved.url, {
            method: request.method,
            headers,
            signal: controller.signal,
          });
        };
        try {
          upstream = await fetchStream();
        } catch (error) {
          if (controller.signal.aborted) throw error;
          // A cached descriptor may point at an edge that just stopped answering.
          // Retry once before headers, with a freshly resolved descriptor.
          service.evict(id);
          resolved = await service.resolve(id, controller.signal);
          upstream = await fetchStream();
        }
        if (upstream.status === 403 || upstream.status === 410) {
          // Release the rejected response before opening another connection.
          await upstream.body?.cancel();
          service.evict(id);
          resolved = await service.resolve(id, controller.signal);
          upstream = await fetchStream();
        }
        clearTimeout(timer);
        mimeType = resolved.mimeType;
        patches = resolved.patches;
      } catch (error) {
        cleanup();
        if (controller.signal.aborted && !timedOut) return;
        if (timedOut)
          return reply.code(504).send({
            code: 'TIMEOUT',
            error: 'Lo stream ha impiegato troppo tempo. Riprova.',
          });
        if (error instanceof AudioResolutionError)
          return reply
            .code(error.status)
            .send({ code: error.code, error: error.message });
        // Upstream exceptions can contain signed URLs and tokens: log only a code.
        request.log.warn(
          { code: 'AUDIO_UPSTREAM_ERROR' },
          'Audio request failed',
        );
        return reply.code(502).send({
          code: 'UPSTREAM_ERROR',
          error: 'Connessione allo stream audio non riuscita. Riprova.',
        });
      }

      if (upstream.status === 416) {
        await upstream.body?.cancel();
        cleanup();
        const contentRange = upstream.headers.get('content-range');
        if (contentRange) reply.header('Content-Range', contentRange);
        return reply.code(416).send();
      }
      if (upstream.status !== 200 && upstream.status !== 206) {
        await upstream.body?.cancel();
        cleanup();
        return reply.code(502).send({
          code: 'UPSTREAM_ERROR',
          error: 'Stream temporaneamente non disponibile. Riprova.',
        });
      }
      if (
        patches?.length &&
        upstream.status === 206 &&
        !/^bytes \d+-\d+\/\d+$/.test(
          upstream.headers.get('content-range') ?? '',
        )
      ) {
        await upstream.body?.cancel();
        cleanup();
        return reply.code(502).send({
          code: 'UPSTREAM_ERROR',
          error: 'Intervallo dello stream non valido. Riprova.',
        });
      }
      reply.code(upstream.status).type(mimeType);
      for (const header of [
        'content-range',
        'content-length',
        'accept-ranges',
        'etag',
        'last-modified',
      ]) {
        const value = upstream.headers.get(header);
        if (patches?.length && header === 'etag') continue;
        if (value) reply.header(header, value);
      }
      if (request.method === 'HEAD' || !upstream.body) {
        await upstream.body?.cancel();
        cleanup();
        return reply.send();
      }
      // A long song is allowed; only a connection with no data is timed out.
      const stream = Readable.fromWeb(
        upstream.body as import('node:stream/web').ReadableStream<Uint8Array>,
      );
      armTimeout(options.idleTimeoutMs ?? 30000);
      stream.on('data', () => armTimeout(options.idleTimeoutMs ?? 30000));
      stream.once('end', cleanup);
      stream.once('error', cleanup);
      stream.once('close', cleanup);
      const contentLength = Number(upstream.headers.get('content-length'));
      const completeRange = upstream.headers
        .get('content-range')
        ?.match(/^bytes 0-(\d+)\/(\d+)$/);
      const canCache =
        cacheWrites < 2 &&
        Number.isSafeInteger(contentLength) &&
        contentLength > 0 &&
        contentLength <= AUDIO_PREFETCH_LIMIT &&
        (upstream.status === 200 ||
          (upstream.status === 206 &&
            !!completeRange &&
            Number(completeRange[1]) + 1 === contentLength &&
            Number(completeRange[2]) === contentLength));
      if (!patches?.length && !canCache) return reply.send(stream);
      if (canCache) {
        cacheWrites++;
        reply.header('X-MusicBit-Audio-Cache', 'warming');
      }
      if (patches?.length)
        reply.header('X-MusicBit-Audio-Compatibility', 'aac-fragmented-edit');
      let offset = Number(
        upstream.headers.get('content-range')?.match(/^bytes (\d+)-/)?.[1] ?? 0,
      );
      const edits = patches;
      let collected = 0;
      let collecting = canCache;
      const chunks: Buffer[] = [];
      const patched = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          const output = edits?.length
            ? patchAudioChunk(chunk, offset, edits)
            : chunk;
          offset += chunk.length;
          if (collecting) {
            collected += output.length;
            if (collected > contentLength) {
              collecting = false;
              chunks.length = 0;
            } else chunks.push(Buffer.from(output));
          }
          callback(null, output);
        },
        flush(callback) {
          if (
            collecting &&
            !controller.signal.aborted &&
            collected === contentLength
          )
            byteCache.put(id, Buffer.concat(chunks, collected), mimeType);
          callback();
        },
      });
      let releasedCacheSlot = false;
      const releaseCacheSlot = () => {
        if (canCache && !releasedCacheSlot) {
          cacheWrites--;
          releasedCacheSlot = true;
        }
      };
      patched.once('close', releaseCacheSlot);
      stream.once('error', (error) => patched.destroy(error));
      patched.once('close', () => {
        stream.destroy();
        cleanup();
      });
      return reply.send(stream.pipe(patched));
    },
  });
}
