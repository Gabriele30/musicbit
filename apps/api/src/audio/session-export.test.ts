import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { exportSession } from '../../../../tools/youtube-session-extension/session.mjs';
import { parseProviderSession } from './provider-session.js';
const cookie = (name: string, value: string, domain = '.youtube.com') => ({
  name,
  value,
  domain,
  path: '/',
});
it('exports a provider-compatible file while excluding other accounts, expired values and unrelated preferences', () => {
  const text = exportSession([
    cookie('SAPISID', 'youtube-test'),
    cookie('SID', 'youtube-sid'),
    cookie('SID', 'other-account', '.google.com'),
    cookie('PREF', 'unrelated'),
    { ...cookie('SSID', 'expired'), expirationDate: 1 },
  ]);
  expect(parseProviderSession(text)).toBe(
    'SAPISID=youtube-test; SID=youtube-sid',
  );
  expect(text).not.toContain('other-account');
});
it('does not export a signed-out or ambiguous browser session', () => {
  expect(() => exportSession([cookie('PREF', 'anonymous')])).toThrow(
    'Accedi prima',
  );
  expect(() =>
    exportSession([cookie('SAPISID', 'one'), cookie('SAPISID', 'two')]),
  ).toThrow('ambigua');
});
it('requests only YouTube cookie access, without content scripts, browser automation or access to other sites', () => {
  const manifest = JSON.parse(
    readFileSync(
      new URL(
        '../../../../tools/youtube-session-extension/manifest.json',
        import.meta.url,
      ),
      'utf8',
    ),
  );
  expect(manifest.permissions).toEqual(['cookies']);
  expect(manifest.incognito).toBe('split');
  expect(manifest.host_permissions).toEqual(['https://*.youtube.com/*']);
  expect(manifest.content_scripts).toBeUndefined();
  expect(manifest.background).toBeUndefined();
});
