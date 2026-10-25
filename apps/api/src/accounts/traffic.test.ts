import { describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { AccountError, AccountStore } from './store.js';
import { registerTrafficControls } from './traffic.js';
describe('hosted access controls', () => {
  it('can require an account before serving catalog/audio, and limits repeated warm requests', async () => {
    const app = Fastify();
    const accounts = new AccountStore();
    registerTrafficControls(app, accounts);
    app.get('/api/tracks', async () => ({ tracks: [] }));
    const segment =
      '/api/continuous/00000000-0000-4000-8000-000000000001/0/segment-000001.ts';
    app.get(segment, async () => 'aac-segment');
    app.setErrorHandler((error, _req, reply) =>
      reply
        .code(error instanceof AccountError ? error.status : 500)
        .send({ error: error.message }),
    );
    try {
      vi.stubEnv('MUSICBIT_REQUIRE_ACCOUNT', 'true');
      expect((await app.inject('/api/tracks')).statusCode).toBe(401);
      expect((await app.inject(segment)).statusCode).toBe(401);
      const user = await accounts.createUser(
        'listener',
        'traffic-test-password',
      );
      const token = accounts.createSession(user.id);
      const headers = { cookie: `musicbit_session=${token}` };
      for (let n = 0; n < 240; n++)
        expect(
          (await app.inject({ url: '/api/tracks', headers })).statusCode,
        ).toBe(200);
      const limited = await app.inject({ url: '/api/tracks', headers });
      expect(limited.statusCode).toBe(429);
      expect(limited.headers['retry-after']).toBe('60');
      // A real iPhone fetched >240 media segments in its first minute. Search
      // exhaustion must not prevent its decoder from completing the preload.
      for (let n = 0; n < 1200; n++)
        expect((await app.inject({ url: segment, headers })).statusCode).toBe(
          200,
        );
      expect((await app.inject({ url: segment, headers })).statusCode).toBe(
        429,
      );
    } finally {
      await app.close();
      accounts.close();
      vi.unstubAllEnvs();
    }
  });
});
