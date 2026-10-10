import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// Isolated live HLS proof. Original mathematical tones only; no remote music.
await mkdir('artifacts/hls', { recursive: true });
const directory = await mkdtemp(resolve('artifacts/hls/session-'));
const duration = Number(process.env.HLS_DURATION ?? 300);
if (!Number.isFinite(duration) || duration < 8 || duration > 3600)
  throw new Error('HLS_DURATION: 8–3600 s');
const startedAt = Date.now();
const html = await readFile(new URL('index.html', import.meta.url));
const encoder = spawn(
  process.env.FFMPEG_PATH ?? 'ffmpeg',
  [
    '-hide_banner',
    '-loglevel',
    'warning',
    '-re',
    '-f',
    'lavfi',
    '-i',
    'aevalsrc=0.04*sin(2*PI*(220+110*floor(mod(t\\,30)/10))*t):s=48000',
    '-t',
    String(duration),
    '-c:a',
    'aac',
    '-b:a',
    '96k',
    '-ac',
    '2',
    '-f',
    'hls',
    '-hls_time',
    '2',
    '-hls_list_size',
    '6',
    '-hls_flags',
    'delete_segments+program_date_time+temp_file',
    '-hls_segment_filename',
    resolve(directory, 'segment-%06d.ts'),
    resolve(directory, 'stream.m3u8'),
  ],
  { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true },
);
encoder.stderr.on('data', (chunk) => process.stderr.write(chunk));
encoder.on('error', (error) => {
  console.error(`FFmpeg unavailable: ${error.message}`);
  server.close();
  process.exitCode = 1;
});
let encoderExit = null;
encoder.on('exit', (code) => {
  encoderExit = code;
  console.log(
    `Encoder stopped (${code}). HTTP stays up for inspection; Ctrl+C to stop.`,
  );
});
const server = createServer(async (req, res) => {
  const name = new URL(req.url, 'http://localhost').pathname.slice(1);
  if (name === 'status') {
    res.writeHead(200, {
      'content-type': 'application/json',
      'cache-control': 'no-store',
    });
    res.end(
      JSON.stringify({
        startedAt,
        elapsedSeconds: (Date.now() - startedAt) / 1000,
        encoderExit,
        segmentTargetSeconds: 2,
        playlistSize: 6,
        audio: 'Original tones: 220 / 330 / 440 Hz, 10 s each, repeat',
      }),
    );
    return;
  }
  if (name === '' || name === 'index.html') {
    res.writeHead(200, {
      'content-type': 'text/html',
      'cache-control': 'no-store',
    });
    res.end(html);
    return;
  }
  if (name !== 'stream.m3u8' && !/^segment-\d{6}\.ts$/.test(name)) {
    res.writeHead(404);
    res.end();
    return;
  }
  try {
    const data = await readFile(resolve(directory, name));
    res.writeHead(200, {
      'content-type': name.endsWith('.m3u8')
        ? 'application/vnd.apple.mpegurl'
        : 'video/mp2t',
      'cache-control': 'no-store',
      'content-length': data.length,
    });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end('Segment/playlist not ready or expired.');
  }
});
server.on('error', (error) => {
  console.error(`HLS HTTP server: ${error.message}`);
  encoder.kill();
  process.exitCode = 1;
});
server.listen(4180, '127.0.0.1', () => {
  console.log(
    'Isolated HLS: http://127.0.0.1:4180 (HTTPS test proxy: /__hls/)',
  );
  console.log(
    `Output: ${directory}; ${duration}s maximum, rolling 6 × ~2s segments.`,
  );
});
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => {
    encoder.kill();
    server.close(() => process.exit(0));
  });
