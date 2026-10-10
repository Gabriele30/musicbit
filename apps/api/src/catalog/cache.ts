import type { CatalogTiming } from '@musicbit/shared';
import { CatalogError } from './errors.js';

interface Flight<T> {
  controller: AbortController;
  promise: Promise<T>;
  users: number;
}

/** Bounded TTL/LRU cache and single-flight requests with subscriber cancellation. */
export class MetadataCache {
  private values = new Map<string, { expires: number; value: unknown }>();
  private flights = new Map<string, Flight<unknown>>();
  constructor(
    readonly ttlMs: number,
    readonly timeoutMs: number,
    private capacity = 200,
    private maxConcurrent = 32,
  ) {}

  async get<T>(
    key: string,
    load: (signal: AbortSignal) => Promise<T>,
    signal: AbortSignal,
  ): Promise<{ value: T; timing: CatalogTiming }> {
    const start = performance.now();
    if (signal.aborted) throw new CatalogError('CANCELLED');
    const cached = this.values.get(key);
    if (cached && cached.expires > Date.now()) {
      this.values.delete(key);
      this.values.set(key, cached);
      return {
        value: structuredClone(cached.value) as T,
        timing: { cache: 'hit', elapsedMs: performance.now() - start },
      };
    }
    this.values.delete(key);
    let flight = this.flights.get(key) as Flight<T> | undefined;
    const cache = flight ? 'shared' : 'miss';
    if (!flight) {
      if (this.flights.size >= this.maxConcurrent)
        throw new CatalogError('BUSY');
      const controller = new AbortController();
      const created: Flight<T> = {
        controller,
        users: 0,
        promise: Promise.resolve(undefined as T),
      };
      // Race as well as abort: a broken provider must not hold an HTTP request forever.
      created.promise = new Promise<T>((resolve, reject) => {
        const aborted = () => reject(controller.signal.reason);
        controller.signal.addEventListener('abort', aborted, { once: true });
        Promise.resolve()
          .then(() => {
            controller.signal.throwIfAborted();
            return load(controller.signal);
          })
          .then(resolve, reject)
          .finally(() =>
            controller.signal.removeEventListener('abort', aborted),
          );
      });
      const timer = setTimeout(
        () => controller.abort(new CatalogError('TIMEOUT')),
        this.timeoutMs,
      );
      created.promise = created.promise
        .then((value) => {
          if (
            !controller.signal.aborted &&
            this.ttlMs > 0 &&
            value !== undefined
          ) {
            this.values.set(key, {
              expires: Date.now() + this.ttlMs,
              value: structuredClone(value),
            });
            while (this.values.size > this.capacity)
              this.values.delete(this.values.keys().next().value!);
          }
          return value;
        })
        .finally(() => {
          clearTimeout(timer);
          if (this.flights.get(key) === created) this.flights.delete(key);
        });
      this.flights.set(key, created);
      flight = created;
    }
    const task = flight;
    task.users++;
    const value = await new Promise<T>((resolve, reject) => {
      let settled = false;
      const finish = (outcome: { error: unknown } | { value: T }) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener('abort', abort);
        task.users--;
        if (!task.users && this.flights.get(key) === task) {
          this.flights.delete(key);
          task.controller.abort(new CatalogError('CANCELLED'));
        }
        if ('error' in outcome) reject(outcome.error);
        else {
          try {
            resolve(structuredClone(outcome.value));
          } catch (error) {
            reject(error);
          }
        }
      };
      const abort = () => finish({ error: new CatalogError('CANCELLED') });
      signal.addEventListener('abort', abort, { once: true });
      task.promise.then(
        (value) => finish({ value }),
        (error) => finish({ error }),
      );
      if (signal.aborted) abort();
    });
    return { value, timing: { cache, elapsedMs: performance.now() - start } };
  }

  close() {
    for (const flight of this.flights.values())
      flight.controller.abort(new CatalogError('CANCELLED'));
    this.flights.clear();
    this.values.clear();
  }
}
