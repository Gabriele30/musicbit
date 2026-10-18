import { ProviderAudioResolver } from './provider-resolver.js';

const resolver = new ProviderAudioResolver();
let completed = 0;
let active = 0;
const controllers = new Map<number, AbortController>();
process.on('message', (message: unknown) => {
  if (!message || typeof message !== 'object') return;
  if ('cancel' in message && typeof message.cancel === 'number') {
    controllers.get(message.cancel)?.abort();
    return;
  }
  const { id, videoId } = message as { id: number; videoId: string };
  if (
    !Number.isSafeInteger(id) ||
    typeof videoId !== 'string' ||
    !/^[A-Za-z0-9_-]{11}$/.test(videoId)
  )
    return;
  active++;
  const controller = new AbortController();
  controllers.set(id, controller);
  void resolver
    .resolve(videoId, controller.signal)
    .then((value) => process.send?.({ id, value }))
    .catch((e: unknown) =>
      process.send?.({
        id,
        code:
          e &&
          typeof e === 'object' &&
          'code' in e &&
          (e.code === 'NOT_FOUND' || e.code === 'PROVIDER_RESTRICTED')
            ? e.code
            : 'UNAVAILABLE',
      }),
    )
    .finally(() => {
      // Recycling occurs only once no more requests are pending in the supervisor;
      // this process also has a thirty minute idle lifetime and a bounded V8 heap.
      completed++;
      active--;
      controllers.delete(id);
      if (completed >= 200 && active === 0) {
        resolver.close();
        process.disconnect();
      }
    });
});
process.on('disconnect', () => {
  resolver.close();
  process.exit(0);
});
