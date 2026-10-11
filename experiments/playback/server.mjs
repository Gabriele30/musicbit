import { readFile } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { buildPlaybackLab } from '../../apps/api/dist/playback/lab.js';
import { PlaybackResolver } from '../../apps/api/dist/playback/resolver.js';
const secure = process.env.PLAYBACK_LAB_HTTPS === 'true';
const port = Number(process.env.PLAYBACK_LAB_PORT || (secure ? 4453 : 4181));
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error('Invalid PLAYBACK_LAB_PORT');
const ttl = Number(process.env.PLAYBACK_TTL_MS ?? 60000);
const timeout = Number(process.env.PLAYBACK_TIMEOUT_MS ?? 10000);
if (
  !Number.isInteger(ttl) ||
  ttl < 0 ||
  ttl > 3600000 ||
  !Number.isInteger(timeout) ||
  timeout < 100 ||
  timeout > 60000
)
  throw new Error('Invalid playback TTL/timeout');
const app = buildPlaybackLab(
  secure
    ? {
        https: {
          key: await readFile('artifacts/https/server-key.pem'),
          cert: await readFile('artifacts/https/server.pem'),
        },
      }
    : {},
  new PlaybackResolver(undefined, ttl, timeout),
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
  console.log(`${secure ? 'https' : 'http'}://${host}:${port}/__playback/`);
console.log(
  'Isolated M4 lab; no SW/offline media. HTTPS reuses the existing test CA; no trust installed. Ctrl+C stops.',
);
for (const signal of ['SIGINT', 'SIGTERM'])
  process.once(signal, () => {
    void app.close().then(() => process.exit(0));
  });
