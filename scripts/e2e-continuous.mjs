import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';

/** Original AAC tones served over real HTTP: native media bypasses page routing. */
export async function continuousFixture() {
  await mkdir('artifacts/continuous-e2e', { recursive: true });
  const root = await mkdtemp(resolve('artifacts/continuous-e2e/session-'));
  const tones = new Map();
  const definitions = [220, 330, 440].map((frequency, index) => ({
    id: `hlstone000${index + 1}`,
    frequency,
    duration: 8,
  }));
  definitions.push({ id: 'rolltone000', frequency: 550, duration: 0.5 });
  for (const { id, frequency, duration } of definitions) {
    const directory = resolve(root, id);
    await mkdir(directory);
    await new Promise((done, reject) => {
      const child = spawn(
        process.env.FFMPEG_PATH ?? 'ffmpeg',
        [
          '-hide_banner',
          '-loglevel',
          'error',
          '-nostdin',
          '-y',
          '-f',
          'lavfi',
          '-i',
          `sine=frequency=${frequency}:sample_rate=48000`,
          '-t',
          String(duration),
          '-ac',
          '2',
          '-c:a',
          'aac',
          '-b:a',
          '64k',
          '-f',
          'hls',
          '-hls_time',
          '2',
          '-hls_playlist_type',
          'vod',
          '-hls_flags',
          'independent_segments',
          '-hls_segment_filename',
          resolve(directory, 'segment-%06d.ts'),
          resolve(directory, 'track.m3u8'),
        ],
        { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] },
      );
      let error = '';
      child.stderr.on('data', (chunk) => {
        error += chunk;
      });
      child.on('error', reject);
      child.on('close', (code) =>
        code === 0 ? done() : reject(new Error(error)),
      );
    });
    const playlist = await readFile(resolve(directory, 'track.m3u8'), 'utf8');
    const segments = [
      ...playlist.matchAll(/#EXTINF:([\d.]+),\r?\n(segment-\d{6}\.ts)/g),
    ].map((match) => ({ duration: Number(match[1]), name: match[2] }));
    if (!segments.length) throw new Error('Missing AAC HLS fixture segments');
    tones.set(id, {
      directory,
      segments,
      duration: segments.reduce((sum, item) => sum + item.duration, 0),
    });
  }
  const tone = (id) =>
    /^rolltone\d{3}$/.test(id) ? tones.get('rolltone000') : tones.get(id);
  const rollingTrack = (index) => ({
    id: `rolltone${String(index).padStart(3, '0')}`,
    title:
      index < 3 ? `SoundHelix Song ${index + 1}` : `Radio tone ${index + 1}`,
    artist: 'Original test tone',
    album: 'Continuous radio fixture',
    audioUrl: `/api/audio/rolltone${String(index).padStart(3, '0')}`,
    artworkUrl: '/artwork/1.svg',
    mimeType: 'audio/mp4',
    sourceUrl: 'https://example.com/original-tone',
    permission: 'Original mathematical tone',
    attribution: 'MusicBit tests',
    durationSeconds: tones.get('rolltone000').duration,
  });
  const sessions = new Map();
  const json = (response, data, status = 200) => {
    response.writeHead(status, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    });
    response.end(JSON.stringify(data));
  };
  const timeline = (session) => {
    if (session.rolling) {
      const duration = tones.get('rolltone000').duration;
      const indices = Array.from(
        { length: session.available - session.queueStart },
        (_, index) => session.queueStart + index,
      );
      return {
        complete: false,
        queueStart: session.queueStart,
        tracks: indices.map((index) => ({
          index,
          id: rollingTrack(index).id,
          start: index * duration,
          duration,
        })),
        additions: indices.map((index) => ({
          index,
          track: rollingTrack(index),
        })),
      };
    }
    let start = 0;
    return {
      complete: true,
      tracks:
        Date.now() < session.metadataAt
          ? []
          : session.ids.map((id, index) => {
              const duration = tone(id).duration;
              const track = { id, index, start, duration };
              start += duration;
              return track;
            }),
    };
  };
  return {
    async handle(request, response, path) {
      const control = path.match(
        /^\/__test_continuous\/([a-f0-9-]{36})(?:\/(stats))?$/,
      );
      if (control) {
        const id = control[1];
        if (request.method === 'POST') {
          const chunks = [];
          for await (const chunk of request) chunks.push(chunk);
          const plan = JSON.parse(Buffer.concat(chunks).toString());
          if (!plan.ids.length || !plan.ids.every((track) => !!tone(track))) {
            json(response, { error: 'Invalid fixture plan' }, 400);
            return true;
          }
          const session = sessions.get(id) ?? {
            metadataAt: Date.now() + Number(plan.metadataDelayMs ?? 0),
            manifests: 0,
            segments: [],
            rolling: plan.rolling === true,
            createdAt: Date.now(),
            available: 3,
            queueStart: 0,
            manifestStarts: [],
          };
          session.ids = session.rolling
            ? Array.from({ length: 36 }, (_, index) => rollingTrack(index).id)
            : plan.ids;
          sessions.set(id, session);
          json(response, timeline(session));
        } else if (request.method === 'DELETE') {
          sessions.delete(id);
          response.writeHead(204).end();
        } else {
          const session = sessions.get(id);
          json(
            response,
            !session
              ? { error: 'Missing fixture session' }
              : control[2]
                ? {
                    manifests: session.manifests,
                    segments: session.segments,
                    queueStart: session.queueStart,
                    manifestStarts: session.manifestStarts,
                    available: session.available,
                    trackDuration: tones.get('rolltone000').duration,
                  }
                : timeline(session),
            session ? 200 : 404,
          );
        }
        return true;
      }
      const manifest = path.match(
        /^\/api\/continuous\/([a-f0-9-]{36})\/index\.m3u8$/,
      );
      const segment = path.match(
        /^\/api\/continuous\/([a-f0-9-]{36})\/(\d+)\/(segment-\d{6}\.ts)$/,
      );
      if (!manifest && !segment) return false;
      const id = manifest?.[1] ?? segment[1];
      // The native GET is intentionally issued before the gesture's plan POST.
      const deadline = Date.now() + 3000;
      while (!sessions.has(id) && Date.now() < deadline)
        await new Promise((done) => setTimeout(done, 10));
      const session = sessions.get(id);
      if (!session) {
        response.writeHead(404).end();
        return true;
      }
      if (manifest) {
        session.manifests++;
        session.manifestStarts.push(session.queueStart);
        const lines = [
          '#EXTM3U',
          '#EXT-X-VERSION:3',
          `#EXT-X-TARGETDURATION:${session.rolling ? 1 : 3}`,
          `#EXT-X-MEDIA-SEQUENCE:${session.queueStart}`,
          `#EXT-X-DISCONTINUITY-SEQUENCE:${session.queueStart}`,
          ...(session.queueStart === 0
            ? ['#EXT-X-START:TIME-OFFSET=0,PRECISE=YES']
            : []),
        ];
        const ids = session.rolling
          ? session.ids.slice(session.queueStart, session.available)
          : session.ids;
        ids.forEach((track, relativeIndex) => {
          const index = relativeIndex + session.queueStart;
          if (relativeIndex) lines.push('#EXT-X-DISCONTINUITY');
          for (const item of tone(track).segments)
            lines.push(
              `#EXTINF:${item.duration.toFixed(6)},`,
              `${index}/${item.name}`,
            );
        });
        if (!session.rolling) lines.push('#EXT-X-ENDLIST');
        lines.push('');
        response.writeHead(200, {
          'Content-Type': 'application/vnd.apple.mpegurl',
          'Cache-Control': 'no-store',
        });
        response.end(lines.join('\n'));
      } else {
        const index = Number(segment[2]);
        const track = tone(session.ids[index]);
        if (!track?.segments.some((item) => item.name === segment[3])) {
          response.writeHead(404).end();
          return true;
        }
        if (session.rolling) {
          // Pace publication instead of allowing a short synthetic song to let
          // the decoder preload the entire fixture before the first boundary.
          const availableAt =
            session.createdAt + Math.max(0, index - 3) * track.duration * 1000;
          if (availableAt > Date.now())
            await new Promise((done) =>
              setTimeout(done, availableAt - Date.now()),
            );
          session.available = Math.min(
            36,
            Math.max(session.available, index + 3),
          );
          session.queueStart = Math.max(session.queueStart, index - 20);
        }
        session.segments.push(index);
        const body = await readFile(resolve(track.directory, segment[3]));
        response.writeHead(200, {
          'Content-Type': 'video/mp2t',
          'Content-Length': body.length,
          'Cache-Control': 'no-store',
        });
        response.end(body);
      }
      return true;
    },
    async close() {
      await rm(root, { recursive: true, force: true });
    },
  };
}
