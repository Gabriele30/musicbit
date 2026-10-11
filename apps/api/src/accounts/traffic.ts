import type { FastifyInstance } from 'fastify';
import { AccountError, type AccountStore } from './store.js';
/** Count warm audio connections too; descriptor-resolution limits are not stream limits. */
export function registerTrafficControls(
  app: FastifyInstance,
  accounts: AccountStore,
) {
  const requests = new Map<string, { count: number; until: number }>();
  const streams = new Map<string, number>();
  let total = 0;
  app.addHook('onRequest', async (request, reply) => {
    if (
      !request.url.startsWith('/api/') ||
      request.url.startsWith('/api/auth/') ||
      request.url.startsWith('/api/me/')
    )
      return;
    const cookie =
      request.headers.cookie
        ?.split(';')
        .map((v) => v.trim())
        .find((v) => v.startsWith('musicbit_session='))
        ?.slice(17) ?? '';
    const user = accounts.session(cookie);
    if (process.env.MUSICBIT_REQUIRE_ACCOUNT === 'true' && !user)
      throw new AccountError(
        401,
        'SIGN_IN_REQUIRED',
        'Accedi per usare il catalogo e ascoltare musica.',
      );
    const key = user?.id ?? request.ip;
    const now = Date.now();
    for (const [id, entry] of requests)
      if (entry.until <= now) requests.delete(id);
    const entry = requests.get(key) ?? { count: 0, until: now + 60000 };
    if (entry.count >= 240 || (!requests.has(key) && requests.size >= 1000)) {
      reply.header('Retry-After', '60');
      throw new AccountError(
        429,
        'TRAFFIC_LIMIT',
        'Troppe richieste. Riprova tra un minuto.',
      );
    }
    entry.count++;
    requests.set(key, entry);
    if (!request.url.startsWith('/api/audio/') || request.method === 'HEAD')
      return;
    if (total >= 64 || (streams.get(key) ?? 0) >= 8) {
      reply.header('Retry-After', '5');
      throw new AccountError(
        429,
        'STREAM_LIMIT',
        'Troppi stream aperti. Chiudi gli altri player e riprova.',
      );
    }
    total++;
    streams.set(key, (streams.get(key) ?? 0) + 1);
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      total--;
      const count = (streams.get(key) ?? 1) - 1;
      if (count) streams.set(key, count);
      else streams.delete(key);
    };
    reply.raw.once('close', release);
    reply.raw.once('finish', release);
  });
}
