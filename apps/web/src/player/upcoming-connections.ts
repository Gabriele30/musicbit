const PREFIX_BYTES = 64 * 1024;

/** Small HTTP prefixes for rapid skips, independent of native audio ownership. */
export class UpcomingConnections {
  private desired: string[] = [];
  private requests = new Map<string, AbortController>();
  private completed = new Map<string, number>();
  constructor(private notify: (event: string) => void = () => {}) {}
  prepare(sources: string[]) {
    this.desired = [
      ...new Set(
        sources.filter((source) =>
          /^\/api\/audio\/[A-Za-z0-9_-]{11}$/.test(source),
        ),
      ),
    ].slice(0, 10);
    for (const [source, controller] of this.requests)
      if (!this.desired.includes(source)) controller.abort();
    for (const [source, until] of this.completed)
      if (until < Date.now() || !this.desired.includes(source))
        this.completed.delete(source);
    this.pump();
  }
  private pump() {
    for (const source of this.desired) {
      if (this.requests.size >= 2) return;
      if (this.requests.has(source) || this.completed.has(source)) continue;
      const controller = new AbortController();
      this.requests.set(source, controller);
      const timeout = setTimeout(() => controller.abort(), 60000);
      let ready = false;
      void this.load(source, controller)
        .then(() => {
          ready = true;
          if (!controller.signal.aborted) this.notify('ready');
        })
        .catch(() => {
          /* Preparation never controls playback. */
        })
        .finally(() => {
          clearTimeout(timeout);
          if (this.requests.get(source) === controller)
            this.requests.delete(source);
          if (this.desired.includes(source) && !controller.signal.aborted)
            this.completed.set(
              source,
              Date.now() + (ready ? 5 * 60000 : 15000),
            );
          this.pump();
        });
    }
  }
  private async load(source: string, controller: AbortController) {
    const response = await fetch(source, {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { Range: `bytes=0-${PREFIX_BYTES - 1}` },
      signal: controller.signal,
    });
    const reader = response.body?.getReader();
    if (!reader) throw new Error('No audio body');
    try {
      const range = response.headers
        .get('Content-Range')
        ?.match(/^bytes 0-(\d+)\/(\d+)$/);
      const length = Number(response.headers.get('Content-Length'));
      if (
        response.status !== 206 ||
        !range ||
        !response.headers.get('Content-Type')?.startsWith('audio/') ||
        !Number.isSafeInteger(length) ||
        length <= 0 ||
        length > PREFIX_BYTES ||
        Number(range[1]) + 1 !== length ||
        Number(range[2]) < length
      )
        throw new Error('Invalid audio prefix');
      let received = 0;
      while (!controller.signal.aborted) {
        const { value, done } = await reader.read();
        if (done) break;
        received += value.byteLength;
        if (received > length) throw new Error('Oversized audio prefix');
      }
      if (controller.signal.aborted || received !== length)
        throw new Error('Incomplete audio prefix');
    } finally {
      await reader.cancel().catch(() => {});
    }
  }
  clear() {
    this.desired = [];
    for (const controller of this.requests.values()) controller.abort();
    this.completed.clear();
  }
}
