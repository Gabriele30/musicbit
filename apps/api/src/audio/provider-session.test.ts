import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  parseProviderSession,
  providerSessionFile,
  readProviderSession,
  fetchSessionMetadata,
} from './provider-session.js';
const roots: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
function file(content = 'SAPISID=test-only; SID=local-test') {
  const root = mkdtempSync(join(tmpdir(), 'musicbit-session-test-'));
  roots.push(root);
  const path = join(root, 'youtube.cookies');
  writeFileSync(path, content, { mode: 0o600 });
  return path;
}
it('accepts an explicitly provided session header, keeping only authentication cookies', () => {
  expect(
    parseProviderSession(
      'Cookie: SID=test-sid; SAPISID=test-sapisid; PREF=unrelated',
    ),
  ).toBe('SAPISID=test-sapisid; SID=test-sid');
});
it('filters foreign, expired and path-scoped cookies from a Netscape export', () => {
  const source = [
    '# Netscape HTTP Cookie File',
    '#HttpOnly_.youtube.com\tTRUE\t/\tTRUE\t0\tSAPISID\tvalid-test',
    '.google.com\tTRUE\t/\tTRUE\t0\tSID\tforeign-secret',
    '.youtube.com.evil.test\tTRUE\t/\tTRUE\t0\tHSID\tforeign-secret',
    '.youtube.com\tTRUE\t/\tTRUE\t1\tSSID\texpired-test',
    '.youtube.com\tTRUE\t/watch\tTRUE\t0\tSID\twrong-path',
    '.youtube.com\tTRUE\t/\tTRUE\t0\tSID\tvalid-sid',
  ].join('\n');
  expect(parseProviderSession(source)).toBe(
    'SAPISID=valid-test; SID=valid-sid',
  );
});
it.each([
  'SID=missing-auth',
  'SAPISID=test\r\nInjected: value',
  'SAPISID=first; SAPISID=second',
  'SAPISID=' + 'x'.repeat(65536),
])(
  'rejects invalid credentials without reproducing the supplied value',
  (source) => {
    expect(() => parseProviderSession(source)).toThrow(
      'Sessione YouTube non valida',
    );
    try {
      parseProviderSession(source);
    } catch (error) {
      expect(String(error)).not.toContain(source);
    }
  },
);
it('reads only an explicit private absolute file and does not accept relative or missing paths', () => {
  vi.stubEnv('YOUTUBE_COOKIE_FILE', '');
  expect(readProviderSession()).toBeUndefined();
  const path = file();
  vi.stubEnv('YOUTUBE_COOKIE_FILE', path);
  expect(providerSessionFile()).toBe(path);
  expect(readProviderSession()).toBe('SAPISID=test-only; SID=local-test');
  expect(() => providerSessionFile('relative.cookies')).toThrow(
    'Sessione YouTube non valida',
  );
  expect(() => providerSessionFile(join(path, 'missing'))).toThrow(
    'Sessione YouTube non valida',
  );
  if (process.platform !== 'win32') {
    chmodSync(path, 0o644);
    expect(() => readProviderSession()).toThrow('Sessione YouTube non valida');
  }
});
it('keeps cookie values off foreign/media hosts and disables credentialed redirects', async () => {
  const fetcher = vi.fn(async () => new Response('{}'));
  vi.stubGlobal('fetch', fetcher);
  const headers = { Cookie: 'SAPISID=test-only', Authorization: 'test-only' };
  await fetchSessionMetadata('https://www.youtube.com/youtubei/v1/player', {
    headers,
  });
  expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
    redirect: 'error',
    headers,
  });
  await expect(
    fetchSessionMetadata('https://r1.googlevideo.com/videoplayback', {
      headers,
    }),
  ).rejects.toThrow('Sessione YouTube non valida');
  await expect(
    fetchSessionMetadata(new Request('https://evil.test/', { headers })),
  ).rejects.toThrow('Sessione YouTube non valida');
  expect(fetcher).toHaveBeenCalledOnce();
});
