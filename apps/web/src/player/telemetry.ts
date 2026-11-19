/**
 * Remote playback diagnostics.
 *
 * iOS decides what a locked PWA may do; desktop tests cannot observe it. The
 * player records compact media-element facts (event names, clock, readyState,
 * visibility) in a bounded ring and uploads them to the signed-in account.
 * Records contain no URLs, titles, tokens or cookies: track identity is the
 * public 11-character catalog id. Upload failures are ignored by design.
 */
export type TelemetryValue = string | number | boolean | null | undefined;
export type TelemetryRecord = Record<string, TelemetryValue>;

const MAX_PENDING = 400;
const FLUSH_MS = 20000;

export class PlaybackTelemetry {
  private pending: TelemetryRecord[] = [];
  private timer: ReturnType<typeof setInterval> | undefined;
  private sending = false;
  private enabled = false;
  readonly session = Math.random().toString(36).slice(2, 10);
  private sequence = 0;
  constructor(
    private endpoint = '/api/me/diagnostics',
    private fetcher: typeof fetch = (...args) => fetch(...args),
  ) {}
  /** Upload only for signed-in accounts; guests keep nothing remotely. */
  setEnabled(enabled: boolean) {
    if (enabled === this.enabled) return;
    this.enabled = enabled;
    if (typeof window === 'undefined') return;
    if (enabled) {
      this.timer = setInterval(() => void this.flush(), FLUSH_MS);
      document.addEventListener('visibilitychange', this.onVisibility);
      window.addEventListener('pagehide', this.onHide);
    } else {
      clearInterval(this.timer);
      this.timer = undefined;
      document.removeEventListener('visibilitychange', this.onVisibility);
      window.removeEventListener('pagehide', this.onHide);
      this.pending = [];
    }
  }
  record(record: TelemetryRecord) {
    if (!this.enabled) return;
    const clean: TelemetryRecord = {
      at: Date.now(),
      seq: ++this.sequence,
      session: this.session,
    };
    for (const [key, value] of Object.entries(record))
      if (value !== undefined)
        clean[key] =
          typeof value === 'number'
            ? Math.round(value * 1000) / 1000
            : typeof value === 'string'
              ? value.slice(0, 200)
              : value;
    this.pending.push(clean);
    if (this.pending.length > MAX_PENDING)
      this.pending.splice(0, this.pending.length - MAX_PENDING);
  }
  private onVisibility = () => {
    if (document.visibilityState === 'hidden') void this.flush(true);
  };
  private onHide = () => void this.flush(true);
  async flush(keepalive = false) {
    if (!this.enabled || this.sending || !this.pending.length) return;
    const batch = this.pending.splice(0, 200);
    this.sending = true;
    try {
      const response = await this.fetcher(this.endpoint, {
        method: 'POST',
        credentials: 'same-origin',
        // The API rejects account writes without this same-origin marker.
        headers: {
          'Content-Type': 'application/json',
          'X-MusicBit-Request': '1',
        },
        body: JSON.stringify({ records: batch }),
        // keepalive bodies are limited to 64 KiB by browsers.
        keepalive: keepalive && batch.length <= 150,
      });
      if (!response.ok && response.status >= 500)
        this.pending.unshift(...batch.slice(-100));
    } catch {
      this.pending.unshift(...batch.slice(-100));
    } finally {
      this.sending = false;
    }
  }
}

export const telemetry = new PlaybackTelemetry();
