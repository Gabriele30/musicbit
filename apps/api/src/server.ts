import { buildApp } from './app.js';

const app = buildApp({ logger: true });
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
