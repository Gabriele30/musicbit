import { buildApp } from './app.js';
import { AccountStore } from './accounts/store.js';
import { fileURLToPath } from 'node:url';

const accountPath =
  process.env.MUSICBIT_DB_PATH ??
  fileURLToPath(new URL('../../../data/musicbit.sqlite', import.meta.url));
const app = buildApp(
  { logger: true },
  undefined,
  undefined,
  undefined,
  new AccountStore(accountPath),
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
