import { readFile } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { buildYouTubePlaybackLab } from '../../apps/api/dist/youtube-playback/lab.js';
import { YouTubePlaybackProvider } from '../../apps/api/dist/youtube-playback/provider.js';
import { loadPermissions } from '../../apps/api/dist/youtube-playback/permissions.js';
import { PlaybackResolver } from '../../apps/api/dist/playback/resolver.js';
const secure = process.env.YOUTUBE_PLAYBACK_LAB_HTTPS === 'true';
const port = Number(
  process.env.YOUTUBE_PLAYBACK_LAB_PORT || (secure ? 4463 : 4183),
);
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error('Invalid M5 port');
const ttl = Number(process.env.YOUTUBE_PLAYBACK_TTL_MS ?? 60000);
const timeout = Number(process.env.YOUTUBE_PLAYBACK_TIMEOUT_MS ?? 10000);
if (
  !Number.isInteger(ttl) ||
  ttl < 0 ||
  ttl > 3600000 ||
  !Number.isInteger(timeout) ||
  timeout < 100 ||
  timeout > 60000
)
  throw new Error('Invalid M5 TTL/timeout');
const permissions = await loadPermissions(
  process.env.YOUTUBE_PLAYBACK_PERMISSIONS_FILE,
);
const provider = new YouTubePlaybackProvider(
  process.env.YOUTUBE_PLAYBACK_LAB_ENABLED === 'true',
  permissions,
);
const app = buildYouTubePlaybackLab(
  secure
    ? {
        https: {
          key: await readFile('artifacts/https/server-key.pem'),
          cert: await readFile('artifacts/https/server.pem'),
        },
      }
    : {},
  provider,
  undefined,
  new PlaybackResolver(provider, ttl, timeout),
);
await app.listen({ host: secure ? '0.0.0.0' : '127.0.0.1', port });
const hosts = secure
  ? [
      '127.0.0.1',
      ...Object.values(networkInterfaces())
        .flat()
        .filter((item) => item?.family === 'IPv4' && !item.internal)
        .map((item) => item.address),
    ]
  : ['127.0.0.1'];
for (const host of hosts)
  console.log(`${secure ? 'https' : 'http'}://${host}:${port}/__youtube/`);
console.log(
  `M5 isolated lab. Direct source enabled: ${provider.enabled}; authorized IDs: ${provider.availability().authorizedVideoIds.length}. No SW/media proxy/download.`,
);
for (const signal of ['SIGINT', 'SIGTERM'])
  process.once(signal, () => {
    void app.close().then(() => process.exit(0));
  });
