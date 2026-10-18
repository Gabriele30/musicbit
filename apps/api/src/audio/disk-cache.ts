import { createHash, randomUUID } from 'node:crypto';
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  statfsSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { patchAudioChunk } from './mp4.js';
import {
  AudioResolutionError,
  type AudioStreamService,
} from './stream-service.js';
import { AUDIO_CACHE_QUOTA_BYTES } from '@musicbit/shared';

const validId = (id: string) => /^[A-Za-z0-9_-]{11}$/.test(id);
const MAX_FILE = 64 * 1024 * 1024;
interface Entry {
  id: string;
  size: number;
  mimeType: string;
  durationSeconds?: number;
  touched: number;
}
interface UserCache {
  directory: string;
  entries: Map<string, Entry>;
  windows: Map<string, { ids: string[]; until: number }>;
}

/** Canonical audio only: signed provider URLs and account tokens are never persisted. */
export class AudioDiskCache {
  private users = new Map<string, UserCache>();
  private jobs = new Map<
    string,
    { controller: AbortController; user: string; id: string }
  >();
  private failures = new Map<string, number>();
  private failureCodes = new Map<string, string>();
  private closed = false;
  private pending = new Set<Promise<void>>();
  private reservations = new Map<UserCache, Map<string, number>>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  constructor(
    private root: string,
    private service: AudioStreamService,
    readonly quotaBytes = AUDIO_CACHE_QUOTA_BYTES,
    private freeBytes = 1024 * 1024 * 1024,
  ) {
    if (!Number.isSafeInteger(quotaBytes) || quotaBytes < 1)
      throw new Error('Invalid audio cache quota');
    mkdirSync(root, { recursive: true });
  }
  private user(id: string): UserCache {
    let user = this.users.get(id);
    if (user) return user;
    const directory = join(
      this.root,
      createHash('sha256').update(id).digest('hex'),
    );
    mkdirSync(directory, { recursive: true });
    user = { directory, entries: new Map(), windows: new Map() };
    for (const name of readdirSync(directory)) {
      if (name.endsWith('.part')) {
        rmSync(join(directory, name), { force: true });
        continue;
      }
      if (!name.endsWith('.json')) continue;
      try {
        const entry = JSON.parse(
          readFileSync(join(directory, name), 'utf8'),
        ) as Entry;
        if (
          !validId(entry.id) ||
          name !== `${entry.id}.json` ||
          !/^audio\/[\w.+-]+$/.test(entry.mimeType) ||
          !Number.isSafeInteger(entry.size) ||
          entry.size <= 0 ||
          entry.size > MAX_FILE
        )
          throw new Error('Invalid cache entry');
        const file = statSync(join(directory, `${entry.id}.audio`));
        if (file.size !== entry.size) throw new Error('Incomplete audio');
        entry.touched = file.mtimeMs;
        user.entries.set(entry.id, entry);
      } catch {
        rmSync(join(directory, name), { force: true });
      }
    }
    for (const name of readdirSync(directory))
      if (name.endsWith('.audio') && !user.entries.has(name.slice(0, -6)))
        rmSync(join(directory, name), { force: true });
    this.users.set(id, user);
    this.makeRoom(user, 0);
    return user;
  }
  private desired(user: UserCache) {
    for (const [device, window] of user.windows)
      if (window.until < Date.now()) user.windows.delete(device);
    return [...new Set([...user.windows.values()].flatMap((w) => w.ids))];
  }
  private makeRoom(user: UserCache, needed: number) {
    let used = [...user.entries.values()].reduce((sum, e) => sum + e.size, 0);
    const pinned = new Set(this.desired(user));
    const victims = [...user.entries.values()].sort(
      (a, b) =>
        Number(pinned.has(a.id)) - Number(pinned.has(b.id)) ||
        a.touched - b.touched,
    );
    for (const entry of victims) {
      if (used + needed <= this.quotaBytes) break;
      if (needed > 0 && pinned.has(entry.id)) continue;
      rmSync(join(user.directory, `${entry.id}.json`), { force: true });
      rmSync(join(user.directory, `${entry.id}.audio`), { force: true });
      user.entries.delete(entry.id);
      used -= entry.size;
    }
    return used + needed <= this.quotaBytes;
  }
  get(userId: string, id: string) {
    if (!validId(id)) return;
    const user = this.user(userId),
      entry = user.entries.get(id);
    if (!entry) return;
    const path = join(user.directory, `${id}.audio`);
    if (!existsSync(path)) {
      user.entries.delete(id);
      return;
    }
    entry.touched = Date.now();
    try {
      utimesSync(path, new Date(), new Date());
    } catch {
      /* Playback can continue without a recency update. */
    }
    return {
      ...entry,
      path,
      stream: (start: number, end: number) =>
        createReadStream(path, { start, end }),
    };
  }
  plan(userId: string, device: string, ids: string[]) {
    const user = this.user(userId);
    this.desired(user);
    if (!user.windows.has(device) && user.windows.size >= 8)
      user.windows.delete(user.windows.keys().next().value!);
    user.windows.set(device, {
      ids: [...new Set(ids.filter(validId))].slice(0, 13),
      until: Date.now() + 30 * 60 * 1000,
    });
    for (const job of this.jobs.values())
      if (job.user === userId && !this.desired(user).includes(job.id))
        job.controller.abort();
    this.pump();
    return this.status(userId);
  }
  status(userId: string) {
    const user = this.user(userId);
    return {
      bytes: [...user.entries.values()].reduce((s, e) => s + e.size, 0),
      quotaBytes: this.quotaBytes,
      tracks: user.entries.size,
      preparing: [...this.jobs.values()].filter((j) => j.user === userId)
        .length,
    };
  }
  failure(userId: string, id: string) {
    const key = `${userId}:${id}`;
    return (this.failures.get(key) ?? 0) > Date.now()
      ? (this.failureCodes.get(key) ?? 'UNAVAILABLE')
      : undefined;
  }
  providerRestricted(userId: string) {
    return [...this.failureCodes].some(
      ([key, code]) =>
        key.startsWith(`${userId}:`) &&
        code === 'PROVIDER_RESTRICTED' &&
        (this.failures.get(key) ?? 0) > Date.now(),
    );
  }
  private pump() {
    if (this.closed) return;
    for (const [userId, user] of this.users) {
      for (const id of this.desired(user)) {
        if (this.jobs.size >= 2) return;
        const key = `${userId}:${id}`;
        if (
          user.entries.has(id) ||
          this.jobs.has(key) ||
          (this.failures.get(key) ?? 0) > Date.now()
        )
          continue;
        const controller = new AbortController();
        this.jobs.set(key, { controller, user: userId, id });
        const task = this.download(user, id, controller)
          .catch((error: unknown) => {
            if (!controller.signal.aborted) {
              this.failures.set(key, Date.now() + 60000);
              this.failureCodes.set(
                key,
                error instanceof AudioResolutionError
                  ? error.code
                  : 'UNAVAILABLE',
              );
            }
          })
          .finally(() => {
            this.jobs.delete(key);
            this.pending.delete(task);
            if (!this.closed) {
              this.pump();
              clearTimeout(this.timer);
              this.timer = setTimeout(() => this.pump(), 60000);
              this.timer.unref();
            }
          });
        this.pending.add(task);
      }
    }
    for (const [key, until] of this.failures)
      if (until < Date.now()) {
        this.failures.delete(key);
        this.failureCodes.delete(key);
      }
  }
  private async download(
    user: UserCache,
    id: string,
    controller: AbortController,
  ) {
    const timeout = setTimeout(() => controller.abort(), 120000);
    timeout.unref();
    const temp = join(user.directory, `${id}.${randomUUID()}.part`);
    try {
      let resolved = await this.service.resolve(id, controller.signal);
      const request = () =>
        fetch(resolved.url, {
          signal: controller.signal,
          headers: {
            'User-Agent': 'Mozilla/5.0',
            Referer: 'https://music.youtube.com/',
            Origin: 'https://music.youtube.com',
            Range: `bytes=0-${MAX_FILE - 1}`,
          },
        });
      let response = await request();
      if ([403, 410].includes(response.status)) {
        await response.body?.cancel();
        this.service.evict(id);
        resolved = await this.service.resolve(id, controller.signal);
        response = await request();
      }
      const size = Number(response.headers.get('content-length'));
      const completeRange = response.headers
        .get('content-range')
        ?.match(/^bytes 0-(\d+)\/(\d+)$/);
      const filesystem = statfsSync(this.root);
      if (
        ![200, 206].includes(response.status) ||
        (response.status === 206 &&
          (!completeRange ||
            Number(completeRange[1]) + 1 !== size ||
            Number(completeRange[2]) !== size)) ||
        !response.body ||
        !Number.isSafeInteger(size) ||
        size <= 0 ||
        size > MAX_FILE ||
        size > this.quotaBytes ||
        filesystem.bavail * filesystem.bsize < this.freeBytes + 2 * MAX_FILE
      ) {
        await response.body?.cancel();
        throw new Error('Uncacheable stream');
      }
      let reservations = this.reservations.get(user);
      if (!reservations) {
        reservations = new Map();
        this.reservations.set(user, reservations);
      }
      reservations.set(id, size);
      const reservedBytes = () =>
        [...reservations.values()].reduce((sum, value) => sum + value, 0);
      // Account for unfinished files as well as completed songs.
      if (!this.makeRoom(user, reservedBytes())) {
        await response.body.cancel();
        throw new Error('Cache full');
      }
      let received = 0;
      const patches = resolved.patches;
      const transform = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          const offset = received;
          received += chunk.length;
          if (received > size) {
            callback(new Error('Oversized audio'));
            return;
          }
          callback(
            null,
            patches?.length ? patchAudioChunk(chunk, offset, patches) : chunk,
          );
        },
      });
      await pipeline(
        Readable.fromWeb(
          response.body as import('node:stream/web').ReadableStream<Uint8Array>,
        ),
        transform,
        createWriteStream(temp, { flags: 'wx' }),
        { signal: controller.signal },
      );
      if (received !== size || controller.signal.aborted)
        throw new Error('Incomplete audio');
      if (!this.makeRoom(user, reservedBytes())) throw new Error('Cache full');
      const entry: Entry = {
        id,
        size,
        mimeType: resolved.mimeType.split(';')[0]!,
        durationSeconds: resolved.durationSeconds,
        touched: Date.now(),
      };
      const metadata = `${temp}.json.part`;
      try {
        writeFileSync(metadata, JSON.stringify(entry));
        renameSync(temp, join(user.directory, `${id}.audio`));
        renameSync(metadata, join(user.directory, `${id}.json`));
        user.entries.set(id, entry);
      } finally {
        rmSync(metadata, { force: true });
      }
    } finally {
      this.reservations.get(user)?.delete(id);
      clearTimeout(timeout);
      rmSync(temp, { force: true });
    }
  }
  async close() {
    this.closed = true;
    clearTimeout(this.timer);
    for (const job of this.jobs.values()) job.controller.abort();
    await Promise.allSettled(this.pending);
  }
}
