import { fork, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { existsSync, realpathSync } from 'node:fs';
import {
  AudioResolutionError,
  type ResolvedAudioStream,
} from './stream-service.js';

export function providerEnvironment(): NodeJS.ProcessEnv {
  // No API environment, cookies, database location or host credentials cross IPC.
  return {
    SystemRoot: process.env.SystemRoot,
    WINDIR: process.env.WINDIR,
    LANG: 'en_US.UTF-8',
    TZ: 'UTC',
    NODE_ENV: 'production',
  };
}
export class ProviderProcess {
  private child?: ChildProcess;
  private sequence = 0;
  private pending = new Map<
    number,
    {
      resolve: (v: ResolvedAudioStream) => void;
      reject: (e: Error) => void;
      cleanup: () => void;
    }
  >();
  private idle?: ReturnType<typeof setTimeout>;
  constructor(private timeoutMs = 45000) {}
  private start() {
    if (this.child) return this.child;
    const worker = new URL('./provider-worker.js', import.meta.url);
    // tsx dev also uses the compiled provider, built by the dev entry point.
    const entry = existsSync(worker)
      ? fileURLToPath(worker)
      : fileURLToPath(
          new URL('../../dist/audio/provider-worker.js', import.meta.url),
        );
    const apiRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
    const dist = resolve(entry, '../..');
    const moduleRoots = [
      resolve(apiRoot, 'node_modules'),
      resolve(apiRoot, '../../node_modules'),
    ]
      .filter(existsSync)
      .map((p) => realpathSync(p));
    const child = fork(entry, [], {
      execArgv: [
        '--max-old-space-size=256',
        '--permission',
        '--no-addons',
        '--no-experimental-sqlite',
        ...new Set([dist, ...moduleRoots].map((p) => `--allow-fs-read=${p}`)),
      ],
      env: providerEnvironment(),
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      serialization: 'json',
    });
    this.child = child;
    child.on('message', (message: unknown) => {
      if (!message || typeof message !== 'object') return;
      const msg = message as {
        id: number;
        value?: ResolvedAudioStream;
        code?: string;
      };
      const item = this.pending.get(msg.id);
      if (!item) return;
      this.pending.delete(msg.id);
      item.cleanup();
      if (
        msg.value &&
        typeof msg.value.url === 'string' &&
        /^https:\/\/[^/]+\.googlevideo\.com\//.test(msg.value.url) &&
        typeof msg.value.mimeType === 'string' &&
        msg.value.mimeType.startsWith('audio/') &&
        Number.isFinite(msg.value.expiresAt)
      )
        item.resolve(msg.value);
      else
        item.reject(
          new AudioResolutionError(
            'Stream temporaneamente non disponibile. Riprova.',
            msg.code === 'NOT_FOUND' ? 'NOT_FOUND' : 'UNAVAILABLE',
            msg.code === 'NOT_FOUND' ? 404 : 503,
          ),
        );
      if (!this.pending.size)
        this.idle = setTimeout(() => this.close(), 5 * 60000);
    });
    child.on('error', () => {
      if (this.child === child) this.fail();
    });
    child.on('exit', () => {
      if (this.child === child) this.fail();
    });
    return child;
  }
  resolve(videoId: string, signal?: AbortSignal): Promise<ResolvedAudioStream> {
    signal?.throwIfAborted();
    if (!/^[A-Za-z0-9_-]{11}$/.test(videoId))
      return Promise.reject(
        new AudioResolutionError('ID video non valido', 'INVALID_ID', 400),
      );
    if (this.pending.size >= 8)
      return Promise.reject(
        new AudioResolutionError('Troppe richieste. Riprova.', 'BUSY', 429),
      );
    clearTimeout(this.idle);
    const child = this.start();
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const aborted = () => {
        if (signal?.reason?.code === 'TIMEOUT') {
          this.fail('TIMEOUT');
          return;
        }
        const item = this.pending.get(id);
        if (!item) return;
        this.pending.delete(id);
        item.cleanup();
        item.reject(
          new AudioResolutionError('Richiesta annullata.', 'CANCELLED', 499),
        );
        if (!this.pending.size) this.close();
        else child.send({ cancel: id }, () => {});
      };
      const timer = setTimeout(() => this.fail('TIMEOUT'), this.timeoutMs);
      const cleanup = () => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', aborted);
      };
      this.pending.set(id, { resolve, reject, cleanup });
      signal?.addEventListener('abort', aborted, { once: true });
      child.send({ id, videoId }, (error) => {
        if (error && this.child === child) this.fail();
      });
    });
  }
  private fail(code: 'UNAVAILABLE' | 'TIMEOUT' | 'CANCELLED' = 'UNAVAILABLE') {
    const child = this.child;
    this.child = undefined;
    child?.kill();
    clearTimeout(this.idle);
    for (const item of this.pending.values()) {
      item.cleanup();
      item.reject(
        new AudioResolutionError(
          'Risoluzione del brano interrotta. Riprova.',
          code,
          code === 'TIMEOUT' ? 504 : code === 'CANCELLED' ? 499 : 503,
        ),
      );
    }
    this.pending.clear();
  }
  close() {
    this.fail('CANCELLED');
  }
}
