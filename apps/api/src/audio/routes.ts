import { Readable, Transform } from 'node:stream';
import { patchAudioChunk, type AudioBytePatch } from './mp4.js';
import type { FastifyInstance } from 'fastify';
import {
  AudioResolutionError,
  type AudioStreamService,
} from './stream-service.js';

export function registerAudioRoutes(
  app: FastifyInstance,
  service: AudioStreamService,
  options: { headerTimeoutMs?: number; idleTimeoutMs?: number } = {},
) {
  app.get<{ Params: { id: string } }>(
    '/api/audio/:id/info',
    async (request, reply) => {
      reply.header('Cache-Control', 'private, no-store');
      try {
        const resolved = await service.resolve(request.params.id);
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
        upstream = await fetchStream();
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
      if (!patches?.length) return reply.send(stream);
      reply.header('X-MusicBit-Audio-Compatibility', 'aac-fragmented-edit');
      let offset = Number(
        upstream.headers.get('content-range')?.match(/^bytes (\d+)-/)?.[1] ?? 0,
      );
      const edits = patches;
      const patched = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          const output = patchAudioChunk(chunk, offset, edits);
          offset += chunk.length;
          callback(null, output);
        },
      });
      stream.once('error', (error) => patched.destroy(error));
      patched.once('close', () => {
        stream.destroy();
        cleanup();
      });
      return reply.send(stream.pipe(patched));
    },
  });
}
