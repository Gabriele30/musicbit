import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  isListeningEvent,
  isPlaybackSnapshot,
  type AccountProfile,
  type ListeningEvent,
  type PlaybackSnapshot,
} from '@musicbit/shared';
import { AccountError, type AccountStore } from './store.js';

export function registerExperienceRoutes(
  app: FastifyInstance,
  store: AccountStore,
  requireUser: (request: FastifyRequest) => AccountProfile,
) {
  app.get('/api/me/playback', async (request) =>
    store.experience.playback(requireUser(request).id),
  );
  app.put<{
    Body: { revision: number; session: PlaybackSnapshot; deviceId: string };
  }>('/api/me/playback', { bodyLimit: 5_000_000 }, async (request) => {
    const user = requireUser(request),
      b = request.body;
    if (
      !b ||
      !Number.isSafeInteger(b.revision) ||
      b.revision < 0 ||
      !isPlaybackSnapshot(b.session) ||
      typeof b.deviceId !== 'string' ||
      !/^[a-zA-Z0-9_-]{8,100}$/.test(b.deviceId)
    )
      throw new AccountError(
        400,
        'INVALID_PLAYBACK',
        'Sessione d’ascolto non valida.',
      );
    return store.experience.savePlayback(
      user.id,
      b.revision,
      b.session,
      b.deviceId,
    );
  });
  app.post<{ Body: { events: ListeningEvent[] } }>(
    '/api/me/listening',
    { bodyLimit: 300000 },
    async (request) => {
      const user = requireUser(request),
        b = request.body;
      if (
        !b ||
        !Array.isArray(b.events) ||
        b.events.length > 50 ||
        !b.events.length ||
        !b.events.every(isListeningEvent)
      )
        throw new AccountError(
          400,
          'INVALID_LISTENING',
          'Dati d’ascolto non validi.',
        );
      return store.experience.record(user.id, b.events);
    },
  );
  app.get<{ Querystring: { year?: string; month?: string } }>(
    '/api/me/stats',
    async (request) => {
      const user = requireUser(request);
      const year = Number(request.query.year ?? new Date().getUTCFullYear());
      const month =
        request.query.month === undefined
          ? undefined
          : Number(request.query.month);
      if (
        !Number.isInteger(year) ||
        year < 2020 ||
        year > 2100 ||
        (month !== undefined &&
          (!Number.isInteger(month) || month < 1 || month > 12))
      )
        throw new AccountError(400, 'INVALID_PERIOD', 'Periodo non valido.');
      const from = `${year}-${String(month ?? 1).padStart(2, '0')}-01`;
      const to =
        month === undefined
          ? `${year}-12-31`
          : new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
      return store.experience.stats(user.id, from, to);
    },
  );
  app.delete('/api/me/stats', async (request) => {
    store.experience.clearStats(requireUser(request).id);
    return { ok: true };
  });
}
