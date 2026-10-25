import { isAbsolute } from 'node:path';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { fetchMetadata } from './network.js';

const MAX_BYTES = 65536;
const INVALID = 'Sessione YouTube non valida. Ricollega l’account.';
const NAMES = new Set([
  'SAPISID',
  'APISID',
  'SID',
  'HSID',
  'SSID',
  'SIDCC',
  'LOGIN_INFO',
  '__Secure-1PAPISID',
  '__Secure-3PAPISID',
  '__Secure-1PSID',
  '__Secure-3PSID',
  '__Secure-1PSIDCC',
  '__Secure-3PSIDCC',
  '__Secure-1PSIDTS',
  '__Secure-3PSIDTS',
]);

/** Explicit operator-supplied session only. Never inspect a browser profile. */
export function parseProviderSession(input: string, now = Date.now()): string {
  if (Buffer.byteLength(input) > MAX_BYTES) throw new Error(INVALID);
  const cookies = new Map<string, string>();
  const add = (name: string, value: string) => {
    if (!NAMES.has(name)) return;
    if (!/^[\x21-\x3a\x3c-\x7e]+$/.test(value)) throw new Error(INVALID);
    if (cookies.has(name) && cookies.get(name) !== value)
      throw new Error(INVALID);
    cookies.set(name, value);
  };
  const source = input.trim();
  if (source.includes('\t')) {
    for (const raw of source.split(/\r?\n/)) {
      const line = raw.replace(/^#HttpOnly_/, '');
      if (!line || line.startsWith('#')) continue;
      const fields = line.split('\t');
      if (fields.length !== 7) throw new Error(INVALID);
      const [domain, , path, , expires, name, value] = fields as string[];
      if (
        ![
          '.youtube.com',
          'youtube.com',
          'www.youtube.com',
          'music.youtube.com',
        ].includes(domain!) ||
        path !== '/'
      )
        continue;
      if (!/^\d+$/.test(expires!)) throw new Error(INVALID);
      if (Number(expires) && Number(expires) * 1000 <= now) continue;
      add(name!, value!);
    }
  } else {
    if (/[\r\n]/.test(source)) throw new Error(INVALID);
    for (const part of source.replace(/^Cookie:\s*/i, '').split(';')) {
      const entry = part.trim();
      const separator = entry.indexOf('=');
      if (separator <= 0) throw new Error(INVALID);
      add(entry.slice(0, separator), entry.slice(separator + 1));
    }
  }
  if (!cookies.has('SAPISID')) throw new Error(INVALID);
  return [...cookies]
    .sort(([a], [b]) =>
      a === 'SAPISID' ? -1 : b === 'SAPISID' ? 1 : a.localeCompare(b),
    )
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');
}

export function providerSessionFile(value = process.env.YOUTUBE_COOKIE_FILE) {
  if (!value) return undefined;
  try {
    if (!isAbsolute(value)) throw new Error(INVALID);
    const path = realpathSync(value);
    const stat = statSync(path);
    if (
      !stat.isFile() ||
      stat.size > MAX_BYTES ||
      (process.platform !== 'win32' && stat.mode & 0o077)
    )
      throw new Error(INVALID);
    return path;
  } catch {
    throw new Error(INVALID);
  }
}

export function readProviderSession() {
  const path = providerSessionFile();
  if (!path) return undefined;
  try {
    return parseProviderSession(readFileSync(path, 'utf8'));
  } catch {
    throw new Error(INVALID);
  }
}

/** Credentialed metadata never follows a redirect or reaches a media/foreign host. */
export const fetchSessionMetadata: typeof fetch = (input, init) => {
  const headers = new Headers(
    init?.headers ?? (input instanceof Request ? input.headers : undefined),
  );
  if (headers.has('cookie') || headers.has('authorization')) {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (
      url.protocol !== 'https:' ||
      ![
        'www.youtube.com',
        'music.youtube.com',
        'youtubei.googleapis.com',
      ].includes(url.hostname)
    )
      return Promise.reject(new Error(INVALID));
    return fetchMetadata(input, { ...init, redirect: 'error' });
  }
  return fetchMetadata(input, init);
};
