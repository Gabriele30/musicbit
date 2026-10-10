import assert from 'node:assert/strict';

const base = process.env.MUSICBIT_BASE_URL ?? 'http://127.0.0.1:4173';
const health = await fetch(`${base}/health`);
assert.equal(health.status, 200);
assert.equal((await health.json()).status, 'ok');
const response = await fetch(`${base}/api/tracks`);
assert.equal(response.status, 200);
const data = await response.json();
assert.equal(data.tracks.length, 3);
for (const path of [
  '/',
  '/manifest.webmanifest',
  '/sw.js',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/apple-touch-icon.png',
  ...data.tracks.map((track) => track.artworkUrl),
]) {
  const asset = await fetch(`${base}${path}`);
  assert.equal(asset.status, 200, path);
}
console.log(
  `PASS: health, catalog, app shell, manifest, service worker, icons and covers at ${base}`,
);
if (process.argv.includes('--audio')) {
  for (const track of data.tracks) {
    const source = await fetch(track.audioUrl, {
      headers: { Range: 'bytes=0-1023' },
      signal: AbortSignal.timeout(20000),
    });
    assert.equal(source.status, 206, track.title);
    assert.match(source.headers.get('content-type'), /^audio\/mpeg/);
    await source.body?.cancel();
    console.log(`PASS: authorized MP3 Range 206 — ${track.title}`);
  }
}
