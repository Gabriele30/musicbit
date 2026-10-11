import { PlaybackResolver } from '../apps/api/dist/playback/resolver.js';
import { CatalogService } from '../apps/api/dist/catalog/service.js';
import { buildYouTubePlaybackLab } from '../apps/api/dist/youtube-playback/lab.js';
// ORIGINAL local PCM fixture only: exercises UI plumbing, never claims a YouTube stream.
const samples = 8000 * 10;
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
const catalog = new CatalogService({
  id: 'youtube',
  async search() {
    return ['m5fixture01', 'm5fixture02'].map((id) => ({
      id,
      provider: 'youtube',
      kind: 'track',
      title: `Original TEST ONLY ${id}`,
      artist: 'MusicBit fixture',
      sourceUrl: `https://music.youtube.com/watch?v=${id}`,
      playback: { available: false, reason: 'catalog-only' },
    }));
  },
  async details() {},
});
const resolver = new PlaybackResolver({
  id: 'original-test-tone',
  async resolve(reference) {
    if (
      !['m5fixture01', 'm5fixture02', 'm5fixture03', 'm5fixture04'].includes(
        reference.catalogId,
      )
    )
      return { status: 'unavailable', code: 'NO_AUTHORIZED_SOURCE' };
    return {
      status: 'available',
      source: {
        provider: this.id,
        reference,
        title: 'Original TEST ONLY',
        artist: 'MusicBit fixture',
        url: `/__youtube/test-media/${reference.catalogId}.wav`,
        mimeType: 'audio/wav',
        delivery: 'progressive',
        validUntil: null,
        authorization: {
          sourceUrl: 'https://example.test/original-tone',
          permission: 'Original test tone',
          attribution: 'MusicBit',
        },
      },
    };
  },
});
const app = buildYouTubePlaybackLab({}, undefined, catalog, resolver);
const forbidden = { 'm5fixture03.wav': 0, 'm5fixture04.wav': 0 };
app.get('/__youtube/test-observations', async () => forbidden);
app.get('/__youtube/test-media/:file', async (request, reply) => {
  if (Object.hasOwn(forbidden, request.params.file)) {
    forbidden[request.params.file]++;
    return reply.code(403).send();
  }
  if (!/^m5fixture0[12]\.wav$/.test(request.params.file))
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
  port: Number(process.env.MUSICBIT_YOUTUBE_E2E_PORT || 4184),
});
for (const signal of ['SIGINT', 'SIGTERM'])
  process.once(signal, () => {
    void app.close().then(() => process.exit(0));
  });
