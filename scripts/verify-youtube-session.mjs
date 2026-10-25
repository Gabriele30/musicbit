// Run inside the configured API container. Never print URLs, cookies or tokens.
import { AudioStreamService } from './dist/audio/stream-service.js';
import { Innertube, Log } from 'youtubei.js';
import {
  readProviderSession,
  fetchSessionMetadata,
} from './dist/audio/provider-session.js';
Log.setLevel(Log.Level.NONE);
let authenticated = false;
try {
  const client = await Innertube.create({
    cookie: readProviderSession(),
    retrieve_player: false,
    fetch: fetchSessionMetadata,
  });
  const accounts = await client.account.getInfo(true);
  authenticated = accounts.length > 0;
} catch {
  // Do not print account identities, tokens or third-party response bodies.
}
console.log(JSON.stringify({ authenticated }));
if (!authenticated) process.exit(2);
const service = new AudioStreamService();
let passed = true;
try {
  for (const id of ['DF04hTcoH3s', 'UtMAolKOLM8']) {
    try {
      const stream = await service.resolve(id, AbortSignal.timeout(60000));
      const url = new URL(stream.url);
      if (
        url.protocol !== 'https:' ||
        !url.hostname.endsWith('.googlevideo.com')
      )
        throw Error('Invalid media');
      const response = await fetch(url, {
        headers: {
          Range: 'bytes=0-1023',
          'User-Agent': 'Mozilla/5.0',
          Referer: 'https://music.youtube.com/',
          Origin: 'https://music.youtube.com',
        },
        signal: AbortSignal.timeout(15000),
        redirect: 'error',
      });
      const type = response.headers.get('content-type') ?? '';
      let bytes = 0;
      const reader = response.body?.getReader();
      try {
        if (reader) {
          const chunk = await reader.read();
          bytes = chunk.value?.byteLength ?? 0;
        }
      } finally {
        await reader?.cancel();
      }
      const ok =
        [200, 206].includes(response.status) &&
        type.startsWith('audio/') &&
        bytes > 0;
      passed &&= ok;
      console.log(
        JSON.stringify({
          id,
          ok,
          status: response.status,
          mimeType: type.split(';')[0],
          duration: stream.durationSeconds,
        }),
      );
    } catch {
      passed = false;
      console.log(JSON.stringify({ id, ok: false }));
    }
  }
} finally {
  service.close();
}
process.exitCode = passed ? 0 : 1;
