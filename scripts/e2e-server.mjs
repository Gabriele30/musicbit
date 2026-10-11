import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';

// Test-only host for the actual production bundle. Native WebKit media requests
// bypass Playwright routing on Windows, so serve fixtures over real local HTTP.
const root = resolve('apps/web/dist');
const apiBase = process.env.MUSICBIT_E2E_API_BASE ?? 'http://127.0.0.1:4703';
const samples = 8000 * 30;
const wav = Buffer.alloc(44 + samples * 2);
wav.write('RIFF');
wav.writeUInt32LE(wav.length - 8, 4);
wav.write('WAVEfmt ', 8);
wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20);
wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(8000, 24);
wav.writeUInt32LE(16000, 28);
wav.writeUInt16LE(2, 32);
wav.writeUInt16LE(16, 34);
wav.write('data', 36);
wav.writeUInt32LE(samples * 2, 40);
for (let i = 0; i < samples; i++)
  wav.writeInt16LE(
    Math.round(Math.sin((i * 2 * Math.PI * 220) / 8000) * 1000),
    44 + i * 2,
  );
const types = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
};
const server = createServer(async (request, response) => {
  try {
    const path = new URL(request.url, 'http://127.0.0.1:4174').pathname;
    if (path.startsWith('/api/auth/') || path.startsWith('/api/me/')) {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const headers = new Headers();
      for (const name of [
        'cookie',
        'content-type',
        'x-musicbit-request',
        'x-musicbit-account',
        'origin',
        'sec-fetch-site',
      ])
        if (typeof request.headers[name] === 'string')
          headers.set(name, request.headers[name]);
      const body = Buffer.concat(chunks);
      const upstream = await fetch(`${apiBase}${request.url}`, {
        method: request.method,
        headers,
        ...(body.length ? { body } : {}),
      });
      response.writeHead(upstream.status, {
        'Content-Type': 'application/json',
        'Cache-Control': 'private, no-store',
        ...(upstream.headers.getSetCookie().length
          ? { 'Set-Cookie': upstream.headers.getSetCookie() }
          : {}),
      });
      response.end(await upstream.text());
      return;
    }
    if (path === '/api/tracks' || path === '/health') {
      const upstream = await fetch(`${apiBase}${path}`);
      const data = await upstream.json();
      if (path === '/api/tracks')
        data.tracks.forEach((track) => {
          track.audioUrl = `/__test_media/${track.id}.wav`;
        });
      response.writeHead(upstream.status, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      });
      response.end(JSON.stringify(data));
      return;
    }
    if (path.startsWith('/__test_media/')) {
      if (!/^\/__test_media\/soundhelix-[123]\.wav$/.test(path)) {
        response.writeHead(404);
        response.end();
        return;
      }
      const range = request.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
      const start = Number(range?.[1] ?? 0);
      const end = Math.min(
        Number(range?.[2] || wav.length - 1),
        wav.length - 1,
      );
      if (start > end) {
        response.writeHead(416);
        response.end();
        return;
      }
      const body = wav.subarray(start, end + 1);
      response.writeHead(range ? 206 : 200, {
        'Content-Type': 'audio/wav',
        'Content-Length': body.length,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-store',
        ...(range
          ? { 'Content-Range': `bytes ${start}-${end}/${wav.length}` }
          : {}),
      });
      response.end(body);
      return;
    }
    const file = resolve(
      root,
      `.${decodeURIComponent(path === '/' ? '/index.html' : path)}`,
    );
    if (!file.startsWith(`${root}${sep}`)) {
      response.writeHead(403);
      response.end();
      return;
    }
    const body = await readFile(file);
    response.writeHead(200, {
      'Content-Type': types[extname(file)] ?? 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    response.end(body);
  } catch {
    response.writeHead(404);
    response.end();
  }
});
server.listen(Number(process.env.MUSICBIT_E2E_PORT || 4174), '127.0.0.1');
for (const signal of ['SIGTERM', 'SIGINT'])
  process.on(signal, () => server.close(() => process.exit(0)));
