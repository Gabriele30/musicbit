const authNames = new Set([
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
export function exportSession(cookies, now = Date.now()) {
  const accepted = new Map();
  for (const cookie of cookies) {
    if (
      !['.youtube.com', 'youtube.com', 'www.youtube.com'].includes(
        cookie.domain,
      ) ||
      cookie.path !== '/' ||
      !authNames.has(cookie.name)
    )
      continue;
    if (
      cookie.expirationDate !== undefined &&
      cookie.expirationDate * 1000 <= now
    )
      continue;
    if (!/^[\x21-\x3a\x3c-\x7e]+$/.test(cookie.value))
      throw Error('Sessione non valida.');
    if (accepted.has(cookie.name) && accepted.get(cookie.name) !== cookie.value)
      throw Error('Sessione ambigua.');
    accepted.set(cookie.name, cookie.value);
  }
  if (!accepted.has('SAPISID'))
    throw Error('Accedi prima a YouTube nel tuo browser normale.');
  const result = [...accepted]
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');
  if (result.length > 65536) throw Error('Sessione troppo grande.');
  return result;
}
