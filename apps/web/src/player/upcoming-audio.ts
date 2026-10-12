const MAX_BYTES = 16 * 1024 * 1024;

/** Warms one complete upcoming song in the server's bounded memory cache. */
export class UpcomingAudio {
  private request?: { source: string; controller: AbortController };
  private ready?: string;
  constructor(private notify: (event: string) => void = () => {}) {}

  prepare(source?: string) {
    if (source && (this.ready === source || this.request?.source === source))
      return;
    this.clear();
    if (!source || !/^\/api\/audio\/[A-Za-z0-9_-]{11}$/.test(source)) return;
    const controller = new AbortController();
    this.request = { source, controller };
    this.notify('loading');
    const timeout = setTimeout(() => controller.abort(), 60000);
    void this.load(source, controller)
      .catch(() => {
        // A failed/oversized prefetch must never interrupt the current song.
        if (!controller.signal.aborted) this.notify('error');
      })
      .finally(() => {
        clearTimeout(timeout);
        if (this.request?.controller === controller) this.request = undefined;
      });
  }

  private async load(source: string, controller: AbortController) {
    const response = await fetch(source, {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { Range: `bytes=0-${MAX_BYTES - 1}` },
      signal: controller.signal,
    });
    const reader = response.body?.getReader();
    if (!reader) return;
    try {
      const length = Number(response.headers.get('Content-Length'));
      const range = response.headers
        .get('Content-Range')
        ?.match(/^bytes 0-(\d+)\/(\d+)$/);
      const type = response.headers.get('Content-Type')?.split(';')[0]?.trim();
      if (
        !response.ok ||
        !['warming', 'hit'].includes(
          response.headers.get('X-MusicBit-Audio-Cache') ?? '',
        ) ||
        !type?.startsWith('audio/') ||
        !Number.isSafeInteger(length) ||
        length <= 0 ||
        length > MAX_BYTES ||
        (response.status === 206 &&
          (!range ||
            Number(range[1]) + 1 !== length ||
            Number(range[2]) !== length)) ||
        ![200, 206].includes(response.status)
      )
        return;
      let received = 0;
      while (!controller.signal.aborted) {
        const { value, done } = await reader.read();
        if (done) break;
        received += value.byteLength;
        if (received > length || received > MAX_BYTES) return;
      }
      if (controller.signal.aborted || received !== length) return;
      this.ready = source;
      this.notify('ready');
    } finally {
      await reader.cancel().catch(() => {});
    }
  }

  take(source: string): boolean {
    if (this.ready !== source) return false;
    this.ready = undefined;
    return true;
  }

  clear() {
    this.request?.controller.abort();
    this.request = undefined;
    this.ready = undefined;
  }
}
