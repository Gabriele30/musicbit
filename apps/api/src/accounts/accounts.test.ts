import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { emptyLibrary } from '@musicbit/shared';
import { buildApp } from '../app.js';
import { AccountStore } from './store.js';

const apps: ReturnType<typeof buildApp>[] = [];
const headers = { 'x-musicbit-request': '1' };
function setup(store = new AccountStore()) {
  const app = buildApp({}, undefined, undefined, undefined, store);
  apps.push(app);
  return app;
}
async function register(app: ReturnType<typeof setup>, username: string) {
  const result = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    headers,
    payload: { username, password: 'a-test-password' },
  });
  expect(result.statusCode).toBe(200);
  const cookie = String(result.headers['set-cookie']).split(';')[0]!;
  return { cookie, user: result.json().user };
}
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  vi.unstubAllEnvs();
  vi.useRealTimers();
});
describe('accounts and isolated server libraries', () => {
  it('requires authenticated sessions and browser CSRF protection', async () => {
    const app = setup();
    expect((await app.inject('/api/me/library')).statusCode).toBe(401);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/auth/login',
          payload: { username: 'unknown', password: 'password' },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/auth/login',
          headers: { ...headers, 'sec-fetch-site': 'cross-site' },
          payload: { username: 'unknown', password: 'password' },
        })
      ).statusCode,
    ).toBe(403);
    const result = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers,
      payload: { username: 'unknown', password: 'password' },
    });
    expect(result.statusCode).toBe(401);
    expect(result.json().code).toBe('INVALID_CREDENTIALS');
  });
  it('keeps two accounts separate and rejects stale revisions without changing data', async () => {
    const app = setup();
    const a = await register(app, 'listener_a');
    const b = await register(app, 'listener_b');
    const library = emptyLibrary();
    library.playlists = [
      { id: 'mix', name: 'Private mix', tracks: [], updatedAt: Date.now() },
    ];
    const save = await app.inject({
      method: 'PUT',
      url: '/api/me/library',
      headers: { ...headers, cookie: a.cookie },
      payload: { revision: 0, library },
    });
    expect(save.statusCode).toBe(200);
    expect(save.json().revision).toBe(1);
    expect(
      (
        await app.inject({
          url: '/api/me/library',
          headers: { cookie: b.cookie },
        })
      ).json().library.playlists,
    ).toEqual([]);
    const stale = await app.inject({
      method: 'PUT',
      url: '/api/me/library',
      headers: { ...headers, cookie: a.cookie },
      payload: { revision: 0, library: emptyLibrary() },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().code).toBe('LIBRARY_CONFLICT');
    expect(
      (
        await app.inject({
          url: '/api/me/library',
          headers: { cookie: a.cookie },
        })
      ).json().library.playlists[0].name,
    ).toBe('Private mix');
    const malformed = await app.inject({
      method: 'PUT',
      url: '/api/me/library',
      headers: { ...headers, cookie: a.cookie },
      payload: { revision: 1, library: { version: 1 } },
    });
    expect(malformed.statusCode).toBe(400);
    const result = await app.inject({
      url: '/api/me/library',
      headers: { cookie: a.cookie },
    });
    expect(result.headers['cache-control']).toContain('no-store');
    const switched = await app.inject({
      method: 'PUT',
      url: '/api/me/library',
      headers: {
        ...headers,
        cookie: b.cookie,
        'x-musicbit-account': a.user.id,
      },
      payload: { revision: 0, library },
    });
    expect(switched.statusCode).toBe(401);
    expect(switched.json().code).toBe('ACCOUNT_CHANGED');
    expect(
      (
        await app.inject({
          url: '/api/me/library',
          headers: { cookie: b.cookie },
        })
      ).json().library.playlists,
    ).toEqual([]);
  });
  it('updates profile, rotates sessions after password change and invalidates logout', async () => {
    const app = setup();
    const a = await register(app, 'listener');
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { ...headers, origin: 'https://musicbit.test' },
      payload: { username: 'LISTENER', password: 'a-test-password' },
    });
    expect(login.headers['set-cookie']).toContain('Secure');
    expect(login.headers['set-cookie']).toContain('HttpOnly');
    expect(login.headers['set-cookie']).toContain('SameSite=Strict');
    const second = String(login.headers['set-cookie']).split(';')[0]!;
    const profile = await app.inject({
      method: 'PUT',
      url: '/api/me/profile',
      headers: { ...headers, cookie: a.cookie },
      payload: { displayName: 'My profile', color: '#91c9ef' },
    });
    expect(profile.json().user.displayName).toBe('My profile');
    expect(profile.json().user.password_hash).toBeUndefined();
    const change = await app.inject({
      method: 'POST',
      url: '/api/me/password',
      headers: { ...headers, cookie: a.cookie },
      payload: {
        currentPassword: 'a-test-password',
        password: 'a-new-password',
      },
    });
    expect(change.statusCode).toBe(200);
    expect(
      (
        await app.inject({
          url: '/api/me/library',
          headers: { cookie: second },
        })
      ).statusCode,
    ).toBe(401);
    const fresh = String(change.headers['set-cookie']).split(';')[0]!;
    const out = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { ...headers, cookie: fresh },
      payload: {},
    });
    expect(out.statusCode).toBe(200);
    expect(out.headers['set-cookie']).toContain('Max-Age=0');
    expect(
      (await app.inject({ url: '/api/me/library', headers: { cookie: fresh } }))
        .statusCode,
    ).toBe(401);
    const old = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers,
      payload: { username: 'listener', password: 'a-test-password' },
    });
    expect(old.statusCode).toBe(401);
  });
  it('can disable registration and bounds password attempts', async () => {
    const app = setup();
    vi.stubEnv('AUTH_REGISTRATION', 'false');
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/auth/register',
          headers,
          payload: { username: 'listener', password: 'a-test-password' },
        })
      ).statusCode,
    ).toBe(403);
    for (let n = 0; n < 19; n++)
      await app.inject({
        method: 'POST',
        url: '/api/auth/register',
        headers,
        payload: { username: 'listener', password: 'a-test-password' },
      });
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/auth/login',
          headers,
          payload: { username: 'listener', password: 'a-test-password' },
        })
      ).statusCode,
    ).toBe(429);
  });
  it('persists sessions and data across restarts, stores password hashes, and expires sessions', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'musicbit-accounts-'));
    const path = join(directory, 'accounts.sqlite');
    let store = new AccountStore(path);
    try {
      const user = await store.createUser('persistent', 'unique-test-password');
      const token = store.createSession(user.id);
      const lib = emptyLibrary();
      lib.playlists = [
        { id: 'saved', name: 'Saved', tracks: [], updatedAt: 1 },
      ];
      store.saveLibrary(user.id, 0, lib);
      store.close();
      expect(
        readFileSync(path).includes(Buffer.from('unique-test-password')),
      ).toBe(false);
      store = new AccountStore(path);
      expect(store.session(token)?.id).toBe(user.id);
      expect(store.library(user.id).library.playlists[0]?.name).toBe('Saved');
      vi.useFakeTimers();
      vi.setSystemTime(Date.now() + 31 * 86400000);
      expect(store.session(token)).toBeUndefined();
    } finally {
      store.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
  it('renews a valid session when the application opens without reviving an expired one', async () => {
    const app = setup();
    const account = await register(app, 'renewed_listener');
    const startedAt = Date.now();
    vi.useFakeTimers();
    vi.setSystemTime(startedAt + 29 * 86400000);
    const renewed = await app.inject({
      url: '/api/auth/session',
      headers: { cookie: account.cookie, 'x-forwarded-proto': 'https' },
    });
    expect(renewed.json().user.username).toBe('renewed_listener');
    expect(renewed.headers['set-cookie']).toContain('Max-Age=2592000');
    expect(renewed.headers['set-cookie']).toContain('Secure');
    vi.setSystemTime(Date.now() + 2 * 86400000);
    expect(
      (await app.inject({ url: '/api/auth/session', headers: { cookie: account.cookie } })).json()
        .user.username,
    ).toBe('renewed_listener');
  });
});
