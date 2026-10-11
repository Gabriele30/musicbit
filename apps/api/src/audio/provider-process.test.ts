import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
const { forkMock } = vi.hoisted(() => ({ forkMock: vi.fn() }));
vi.mock('node:child_process', () => ({ fork: forkMock }));
import { ProviderProcess, providerEnvironment } from './provider-process.js';
class Child extends EventEmitter {
  kill = vi.fn();
  send = vi.fn((_message: unknown, callback?: (error: null) => void) =>
    callback?.(null),
  );
}
const processes: ProviderProcess[] = [];
function setup(timeout = 12000) {
  const child = new Child();
  forkMock.mockReturnValue(child);
  const service = new ProviderProcess(timeout);
  processes.push(service);
  return { child, service };
}
afterEach(() => {
  processes.splice(0).forEach((p) => p.close());
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});
describe('provider process supervision', () => {
  it('does not inherit account secrets, sends only the video ID and limits process permissions', async () => {
    vi.stubEnv('MUSICBIT_DB_PATH', 'private.sqlite');
    vi.stubEnv('AUTH_SECRET', 'secret');
    expect(providerEnvironment().AUTH_SECRET).toBeUndefined();
    expect(providerEnvironment().MUSICBIT_DB_PATH).toBeUndefined();
    const { service, child } = setup();
    const request = service.resolve('abcdefghijk');
    const message = child.send.mock.calls[0]![0] as {
      id: number;
      videoId: string;
    };
    expect(Object.keys(message).sort()).toEqual(['id', 'videoId']);
    const options = forkMock.mock.calls[0]![2];
    expect(options.execArgv).toContain('--permission');
    expect(options.execArgv).toContain('--no-experimental-sqlite');
    expect(options.execArgv).toContain('--no-addons');
    expect(options.execArgv).toContain('--max-old-space-size=256');
    expect(options.execArgv).not.toContain('--allow-child-process');
    expect(options.stdio).toEqual(['ignore', 'ignore', 'ignore', 'ipc']);
    child.emit('message', {
      id: message.id,
      value: {
        url: 'https://r1.googlevideo.com/videoplayback',
        mimeType: 'audio/mp4',
        expiresAt: Date.now() + 3600000,
      },
    });
    await expect(request).resolves.toMatchObject({ mimeType: 'audio/mp4' });
  });
  it('cancels a single abandoned request without interrupting another song resolution', async () => {
    const { service, child } = setup();
    const controller = new AbortController();
    const a = service.resolve('aaaaaaaaaaa', controller.signal);
    const b = service.resolve('bbbbbbbbbbb');
    const failure = expect(a).rejects.toMatchObject({ code: 'CANCELLED' });
    controller.abort();
    await failure;
    expect(child.kill).not.toHaveBeenCalled();
    child.emit('message', {
      id: 2,
      value: {
        url: 'https://r1.googlevideo.com/videoplayback',
        mimeType: 'audio/mp4',
        expiresAt: Date.now() + 3600000,
      },
    });
    await expect(b).resolves.toBeDefined();
  });
  it('kills a hung process on deadline and starts a fresh one for a retry', async () => {
    vi.useFakeTimers();
    const { service, child } = setup(50);
    const failure = expect(
      service.resolve('abcdefghijk'),
    ).rejects.toMatchObject({ code: 'TIMEOUT' });
    await vi.advanceTimersByTimeAsync(50);
    await failure;
    expect(child.kill).toHaveBeenCalledOnce();
    const fresh = new Child();
    forkMock.mockReturnValue(fresh);
    const request = service.resolve('abcdefghijk');
    child.emit('error', new Error('late error'));
    expect(fresh.kill).not.toHaveBeenCalled();
    fresh.emit('message', {
      id: 2,
      value: {
        url: 'https://r1.googlevideo.com/videoplayback',
        mimeType: 'audio/mp4',
        expiresAt: Date.now() + 3600000,
      },
    });
    await expect(request).resolves.toBeDefined();
  });
});
