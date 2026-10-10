import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';

const launchedAt = Date.now();
const child = spawn(process.execPath, ['experiments/hls/server.mjs'], {
  env: { ...process.env, HLS_DURATION: '18' },
  windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe'],
});
let output = '';
child.stdout.on('data', (data) => {
  output += data;
});
child.stderr.on('data', (data) => {
  output += data;
});
const base = 'http://127.0.0.1:4180';
async function playlist() {
  try {
    const response = await fetch(`${base}/stream.m3u8`);
    return response.ok ? response.text() : '';
  } catch {
    return '';
  }
}
async function command(bin, args, input) {
  return new Promise((resolve, reject) => {
    const process = spawn(bin, args, { windowsHide: true });
    let stdout = '',
      stderr = '';
    process.stdout.on('data', (data) => {
      stdout += data;
    });
    process.stderr.on('data', (data) => {
      stderr += data;
    });
    process.on('error', reject);
    process.on('close', (code) =>
      code === 0 ? resolve(stdout) : reject(new Error(stderr)),
    );
    process.stdin.on('error', reject);
    process.stdin.end(input);
  });
}
try {
  let first = '';
  const deadline = Date.now() + 10000;
  while (!first.includes('#EXTINF')) {
    if (Date.now() > deadline) throw new Error(`HLS startup failed: ${output}`);
    await delay(250);
    first = await playlist();
  }
  const firstAt = new Date().toISOString();
  const status = await fetch(`${base}/status`).then((response) =>
    response.json(),
  );
  assert(
    status.startedAt >= launchedAt,
    'Port 4180 belongs to another HLS session. Stop it before smoke:hls.',
  );
  assert(!first.includes('#EXT-X-ENDLIST'), 'Expected live playlist');
  let rolling = first;
  const rollingDeadline = Date.now() + 18000;
  while (Number(rolling.match(/#EXT-X-MEDIA-SEQUENCE:(\d+)/)?.[1] ?? 0) === 0) {
    if (Date.now() > rollingDeadline) throw new Error('Playlist did not roll');
    await delay(500);
    rolling = await playlist();
  }
  const segments = rolling
    .split('\n')
    .filter((line) => /^segment-\d+\.ts$/.test(line));
  assert.equal(segments.length, 6);
  const buffers = [];
  for (const segment of segments.slice(-2)) {
    const response = await fetch(`${base}/${segment}`);
    assert(response.ok);
    buffers.push(Buffer.from(await response.arrayBuffer()));
  }
  const data = Buffer.concat(buffers);
  const probe = JSON.parse(
    await command(
      process.env.FFPROBE_PATH ?? 'ffprobe',
      [
        '-v',
        'error',
        '-i',
        'pipe:0',
        '-select_streams',
        'a:0',
        '-show_packets',
        '-show_entries',
        'packet=pts_time,duration_time',
        '-of',
        'json',
      ],
      data,
    ),
  );
  const packets = probe.packets;
  let maximumGapSeconds = 0;
  for (let i = 1; i < packets.length; i++) {
    const previous = packets[i - 1];
    maximumGapSeconds = Math.max(
      maximumGapSeconds,
      Math.abs(
        Number(packets[i].pts_time) -
          Number(previous.pts_time) -
          Number(previous.duration_time),
      ),
    );
  }
  assert(maximumGapSeconds < 0.00001, 'AAC PTS discontinuity');
  await command(
    process.env.FFMPEG_PATH ?? 'ffmpeg',
    ['-v', 'error', '-i', 'pipe:0', '-f', 'null', '-'],
    data,
  );
  const report = {
    testedAt: new Date().toISOString(),
    firstAt,
    firstPlaylist: first,
    rollingPlaylist: rolling,
    packetsChecked: packets.length,
    maximumGapSeconds,
    decoder: 'FFmpeg decoded adjacent live segments; AAC 48 kHz stereo',
    limitation:
      'Server/PTS proof using original tones only. Native Safari playback, locked-screen continuity, CarPlay, CPU under deployment load and arbitrary music transitions untested.',
  };
  await writeFile(
    'docs/performance/hls-smoke.json',
    JSON.stringify(report, null, 2) + '\n',
  );
  console.log(
    `PASS live HLS: rolling 6-segment playlist; ${packets.length} AAC packets, max gap ${maximumGapSeconds}s; decode OK.`,
  );
} finally {
  child.kill();
}
