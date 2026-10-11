import { isSourceFresh, type PlaybackSource } from '@musicbit/shared';

export interface Attempt {
  trackId: string;
  clickAt: number;
  kind: 'direct' | 'prepared' | 'resume' | 'next' | 'ended';
  requestIssuedAt?: number;
  loadstartAt?: number;
  firstDataAt?: number;
  playingAt?: number;
  waitingMs: number;
  error?: string;
  cancelled?: boolean;
}
export interface Preparation {
  trackId: string;
  startedAt: number;
  readyAt?: number;
  outcome: 'loading' | 'ready' | 'used' | 'cancelled' | 'error';
}

/** Isolated native-audio probe. Does not import or replace the production PlayerEngine. */
export class LabPlayer {
  private active?: PlaybackSource;
  private next?: PlaybackSource;
  private attempt?: Attempt;
  private generation = 0;
  private deadline?: ReturnType<typeof setTimeout>;
  private waitingAt?: number;
  private disposers: (() => void)[] = [];
  private handlers: MediaSessionAction[] = [];
  private listeners = new Set<() => void>();
  readonly attempts: Attempt[] = [];
  readonly preparations: Preparation[] = [];
  readonly events: {
    event: string;
    at: number;
    visibility: string;
    trackId?: string;
  }[] = [];
  status = 'idle';
  error: string | null = null;

  constructor(readonly audio: HTMLAudioElement) {
    audio.preload = 'none';
    for (const name of [
      'loadstart',
      'loadedmetadata',
      'loadeddata',
      'canplay',
      'playing',
      'waiting',
      'stalled',
      'pause',
      'ended',
      'error',
      'abort',
      'emptied',
      'timeupdate',
    ]) {
      const handler = () => this.event(name);
      audio.addEventListener(name, handler);
      this.disposers.push(() => audio.removeEventListener(name, handler));
    }
    const visible = () => {
      this.log('visibilitychange');
      this.emit();
    };
    document.addEventListener('visibilitychange', visible);
    this.disposers.push(() =>
      document.removeEventListener('visibilitychange', visible),
    );
    for (const name of ['pagehide', 'pageshow']) {
      const handler = () => {
        this.log(name);
        this.emit();
      };
      window.addEventListener(name, handler);
      this.disposers.push(() => window.removeEventListener(name, handler));
    }
    if ('mediaSession' in navigator) {
      const actions: Partial<Record<MediaSessionAction, () => void>> = {
        play: () => {
          if (this.active) this.play(this.active);
        },
        pause: () => this.pause(),
        nexttrack: () => this.playNext('next'),
      };
      for (const [action, handler] of Object.entries(actions)) {
        try {
          navigator.mediaSession.setActionHandler(
            action as MediaSessionAction,
            handler,
          );
          this.handlers.push(action as MediaSessionAction);
        } catch {
          /* Per-action feature detection. */
        }
      }
    }
  }
  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  private emit() {
    for (const listener of this.listeners) listener();
  }
  private log(event: string) {
    this.events.push({
      event,
      at: performance.now(),
      visibility: document.visibilityState,
      trackId: this.active?.reference.catalogId,
    });
    if (this.events.length > 100) this.events.shift();
  }
  private clearDeadline() {
    clearTimeout(this.deadline);
    this.deadline = undefined;
  }
  private armDeadline() {
    this.clearDeadline();
    this.deadline = setTimeout(() => {
      // Background suspension is not proof that the remote stream timed out.
      if (document.visibilityState === 'hidden') {
        this.armDeadline();
        return;
      }
      if (
        !this.audio.paused &&
        this.audio.readyState >= 3 &&
        this.audio.currentTime > 0
      ) {
        // Native playback can progress while JS events are suspended. Do not
        // invent a playing timestamp or tear down a working background stream.
        this.clearDeadline();
        this.status = 'playing';
        this.log('deadline-native-progress');
        this.emit();
        return;
      }
      this.fail('AUDIO_TIMEOUT');
    }, 15_000);
  }
  private usable(source: PlaybackSource) {
    if (!isSourceFresh(source)) {
      this.error = 'SOURCE_EXPIRED';
      this.emit();
      return false;
    }
    if (!this.audio.canPlayType(source.mimeType)) {
      this.error = 'UNSUPPORTED_FORMAT';
      this.emit();
      return false;
    }
    return true;
  }
  private attach(source: PlaybackSource) {
    this.generation++;
    this.audio.pause();
    this.active = source;
    this.error = null;
    this.audio.preload = 'auto';
    this.audio.src = source.url;
    this.audio.load();
    if ('mediaSession' in navigator && typeof MediaMetadata !== 'undefined') {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: source.title,
        artist: source.artist,
        album: 'MusicBit Playback Lab',
      });
    }
  }
  prepare(source: PlaybackSource) {
    if (!this.audio.paused || this.status === 'loading' || !this.usable(source))
      return false;
    this.cancelPreparation();
    this.preparations.push({
      trackId: source.reference.catalogId,
      startedAt: performance.now(),
      outcome: 'loading',
    });
    if (this.preparations.length > 20) this.preparations.shift();
    this.attach(source);
    this.status = 'preparing';
    this.armDeadline();
    this.emit();
    return true;
  }
  /** Must stay synchronous: audio.play() is invoked before returning to the click handler. */
  play(source: PlaybackSource, trigger?: 'next' | 'ended') {
    if (!this.usable(source)) return false;
    const same =
      this.active?.url === source.url &&
      this.active.reference.catalogId === source.reference.catalogId;
    const prep = this.preparations.at(-1);
    if (this.attempt && !this.attempt.playingAt && !this.attempt.error)
      this.attempt.cancelled = true;
    const attempt: Attempt = {
      trackId: source.reference.catalogId,
      clickAt: performance.now(),
      waitingMs: 0,
      kind:
        trigger ??
        (same && prep?.outcome === 'ready'
          ? 'prepared'
          : same
            ? 'resume'
            : 'direct'),
    };
    if (!same) {
      if (prep?.outcome === 'loading') prep.outcome = 'cancelled';
      this.attach(source);
      attempt.requestIssuedAt = performance.now();
    }
    if (same && prep && ['ready', 'loading'].includes(prep.outcome))
      prep.outcome = 'used';
    this.attempt = attempt;
    this.attempts.push(attempt);
    if (this.attempts.length > 30) this.attempts.shift();
    this.waitingAt = undefined;
    this.error = null;
    this.status = 'loading';
    const version = this.generation;
    this.armDeadline();
    try {
      this.audio.play()?.catch(() => {
        if (version === this.generation && this.attempt === attempt)
          this.fail(
            this.audio.error
              ? `MEDIA_${this.audio.error.code}`
              : 'PLAY_REJECTED',
          );
      });
    } catch {
      this.fail('PLAY_REJECTED');
    }
    this.emit();
    return true;
  }
  pause() {
    if (this.status === 'preparing' || this.status === 'ready') {
      this.cancelPreparation();
      return;
    }
    this.generation++;
    this.audio.pause();
    this.clearDeadline();
    if (this.attempt && !this.attempt.playingAt) this.attempt.cancelled = true;
    this.status = 'paused';
    this.emit();
  }
  cancelPreparation() {
    const prep = this.preparations.at(-1);
    if (prep?.outcome !== 'loading' && prep?.outcome !== 'ready') return;
    prep.outcome = 'cancelled';
    this.generation++;
    this.audio.pause();
    this.audio.removeAttribute('src');
    this.audio.load();
    this.active = undefined;
    this.clearDeadline();
    this.status = 'idle';
    this.emit();
  }
  stage(source: PlaybackSource) {
    if (!isSourceFresh(source)) return false;
    this.next = source;
    this.log('next-descriptor-ready');
    this.emit();
    return true;
  }
  playNext(trigger: 'next' | 'ended' = 'next') {
    if (!this.next) return false;
    const source = this.next;
    this.next = undefined;
    return this.play(source, trigger);
  }
  private fail(code: string) {
    this.clearDeadline();
    this.generation++;
    this.error = code;
    this.status = 'error';
    if (this.attempt && !this.attempt.playingAt && !this.attempt.cancelled)
      this.attempt.error = code;
    const prep = this.preparations.at(-1);
    if (prep?.outcome === 'loading') prep.outcome = 'error';
    // Abort the native media request after an actual failure or visible timeout.
    this.audio.pause();
    this.audio.removeAttribute('src');
    this.audio.load();
    this.active = undefined;
    this.log(code);
    this.emit();
  }
  private event(name: string) {
    if (name !== 'timeupdate') this.log(name);
    const now = performance.now();
    const attempt = this.attempt;
    const pending =
      attempt && !attempt.playingAt && !attempt.error && !attempt.cancelled;
    if (pending && name === 'loadstart') attempt.loadstartAt ??= now;
    if (pending && name === 'loadeddata') attempt.firstDataAt ??= now;
    const prep = this.preparations.at(-1);
    if (name === 'canplay' && prep?.outcome === 'loading') {
      prep.outcome = 'ready';
      prep.readyAt = now;
      this.status = 'ready';
      this.clearDeadline();
    }
    if (name === 'waiting') this.waitingAt ??= now;
    if (name === 'playing') {
      if (pending) attempt.playingAt = now;
      if (attempt && this.waitingAt !== undefined)
        attempt.waitingMs += now - this.waitingAt;
      this.waitingAt = undefined;
      this.status = 'playing';
      this.clearDeadline();
    }
    if (name === 'pause' && this.status === 'playing') this.status = 'paused';
    if (name === 'error')
      this.fail(`MEDIA_${this.audio.error?.code ?? 'UNKNOWN'}`);
    if (name === 'ended') {
      this.status = 'ended';
      this.playNext('ended');
    }
    if ('mediaSession' in navigator) {
      try {
        navigator.mediaSession.playbackState =
          this.status === 'playing' ? 'playing' : 'paused';
      } catch {
        /* Optional browser API. */
      }
    }
    this.emit();
  }
  snapshot() {
    const attempt = this.attempt;
    const ranges = Array.from(
      { length: this.audio.buffered.length },
      (_, i) => [this.audio.buffered.start(i), this.audio.buffered.end(i)],
    );
    return {
      status: this.status,
      error: this.error,
      active: this.active?.reference,
      next: this.next?.reference,
      position: this.audio.currentTime,
      readyState: this.audio.readyState,
      networkState: this.audio.networkState,
      ranges,
      mediaSession: 'mediaSession' in navigator,
      mediaActions: this.handlers,
      visibility: document.visibilityState,
      standalone:
        window.matchMedia?.('(display-mode: standalone)').matches ?? false,
      userAgent: navigator.userAgent,
      timeOrigin: performance.timeOrigin,
      exportedAt: new Date().toISOString(),
      clickToPlayingMs:
        attempt?.playingAt === undefined
          ? null
          : attempt.playingAt - attempt.clickAt,
      initialBufferEstimateMs:
        attempt?.firstDataAt === undefined || attempt.loadstartAt === undefined
          ? null
          : attempt.firstDataAt - attempt.loadstartAt,
      attempts: this.attempts,
      preparations: this.preparations,
      events: this.events,
    };
  }
  dispose() {
    this.clearDeadline();
    this.generation++;
    for (const dispose of this.disposers) dispose();
    for (const action of this.handlers) {
      try {
        navigator.mediaSession.setActionHandler(action, null);
      } catch {
        /* Optional. */
      }
    }
    this.listeners.clear();
    this.audio.pause();
  }
}
