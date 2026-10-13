import { buildApp } from './app.js';
import { AccountStore } from './accounts/store.js';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { AudioDiskCache } from './audio/disk-cache.js';
import { AudioStreamService } from './audio/stream-service.js';
import { ContinuousAudio } from './audio/continuous.js';
import { CatalogService } from './catalog/service.js';

const accountPath =
  process.env.MUSICBIT_DB_PATH ??
  fileURLToPath(new URL('../../../data/musicbit.sqlite', import.meta.url));
const audioService = new AudioStreamService();
const catalogService = new CatalogService();
const diskCache =
  accountPath === ':memory:'
    ? undefined
    : new AudioDiskCache(
        process.env.MUSICBIT_AUDIO_CACHE_PATH ??
          join(dirname(accountPath), 'audio-cache'),
        audioService,
      );
const app = buildApp(
  { logger: true },
  undefined,
  catalogService,
  audioService,
  new AccountStore(accountPath),
  undefined,
  diskCache,
  diskCache ? new ContinuousAudio(diskCache, catalogService) : undefined,
);
const port = Number(process.env.API_PORT ?? 3001);
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error('API_PORT deve essere tra 1 e 65535');

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void app.close().then(() => process.exit(0));
  });
}
try {
  await app.listen({ port, host: process.env.API_HOST ?? '127.0.0.1' });
} catch (error) {
  app.log.error(error);
  process.exitCode = 1;
}
