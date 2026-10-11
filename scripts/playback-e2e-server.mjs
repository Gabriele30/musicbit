import { PlaybackResolver } from '../apps/api/dist/playback/resolver.js';
import { buildPlaybackLab } from '../apps/api/dist/playback/lab.js';

// Test-only original 220 Hz PCM tone. No remote media, no runtime fixture flag.
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
const resolver = new PlaybackResolver({
  id: 'original-test-tone',
  async resolve(reference) {
    if (reference.catalogProvider !== 'soundhelix-demo')
      return { status: 'unavailable', code: 'NO_AUTHORIZED_SOURCE' };
    return {
      status: 'available',
      source: {
        provider: this.id,
        reference,
        title: 'Original test tone',
        artist: 'MusicBit',
        url: `/__playback/test-media/${reference.catalogId}.wav`,
        mimeType: 'audio/wav',
        delivery: 'progressive',
        validUntil: null,
        authorization: {
          sourceUrl: 'https://example.com/original-test-tone',
          permission: 'Original fixture for automated tests',
          attribution: 'MusicBit',
        },
      },
    };
  },
});
const app = buildPlaybackLab({}, resolver);
app.get('/__playback/test-media/:file', async (request, reply) => {
  if (!/^soundhelix-[123]\.wav$/.test(request.params.file))
    return reply.code(404).send();
  const range = request.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
  const start = Number(range?.[1] ?? 0),
    end = Math.min(Number(range?.[2] || wav.length - 1), wav.length - 1);
  if (start > end) return reply.code(416).send();
  const body = wav.subarray(start, end + 1);
  reply
    .code(range ? 206 : 200)
    .type('audio/wav')
    .header('Content-Length', body.length)
    .header('Accept-Ranges', 'bytes');
  if (range)
    reply.header('Content-Range', `bytes ${start}-${end}/${wav.length}`);
  return reply.send(body);
});
await app.listen({
  host: '127.0.0.1',
  port: Number(process.env.MUSICBIT_PLAYBACK_E2E_PORT || 4182),
});
for (const signal of ['SIGTERM', 'SIGINT'])
  process.on(signal, () => {
    void app.close().then(() => process.exit(0));
  });
