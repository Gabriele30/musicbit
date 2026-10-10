import type { Track } from '@musicbit/shared';

export type PlaybackStatus =
  | 'idle'
  | 'loading'
  | 'playing'
  | 'paused'
  | 'ended'
  | 'error';
export type Trigger = 'tap' | 'media-session' | 'ended';
export interface PlaybackAttempt {
  id: number;
  trackId: string;
  title: string;
  trigger: Trigger;
  kind: 'load' | 'resume';
  clickAt: number;
  requestIssuedAt?: number;
  loadstartAt?: number;
  firstDataAt?: number;
  playingAt?: number;
  error?: string;
}
export interface PlayerState {
  queue: Track[];
  index: number;
  status: PlaybackStatus;
  position: number;
  duration: number;
  error: string | null;
  attempts: PlaybackAttempt[];
  events: { event: string; at: number; visibility: string }[];
  mediaSession: boolean;
  mediaActions: string[];
}

const mediaErrorMessages: Record<number, string> = {
  1: 'Caricamento interrotto. Tocca Riprova.',
  2: 'Errore di rete durante il caricamento audio. Controlla la connessione e riprova.',
  3: 'Il browser non riesce a decodificare questa traccia.',
  4: 'Sorgente audio non disponibile o formato non supportato.',
};

/** Owns the one audio element. React subscribes to snapshots, never owns audio. */
export class PlayerEngine {
  private state: PlayerState = {
    queue: [],
    index: 0,
    status: 'idle',
    position: 0,
    duration: 0,
    error: null,
    attempts: [],
    events: [],
    mediaSession: false,
    mediaActions: [],
  };
  private listeners = new Set<() => void>();
  private audioListeners = new Map<string, EventListener>();
  private command = 0;
  private attemptId = 0;
  private activeAttempt: number | undefined;
  private source: string | undefined;
  private session: MediaSession | undefined;

  constructor(
    readonly audio: HTMLAudioElement,
    private now = () => performance.now(),
  ) {
    audio.preload = 'none';
    audio.setAttribute('playsinline', '');
    const on = (event: string, fn: () => void) => {
      const listener = () => {
        this.log(event);
        fn();
      };
      this.audioListeners.set(event, listener);
      audio.addEventListener(event, listener);
    };
    on('loadstart', () => this.mark('loadstartAt'));
    on('loadeddata', () => this.mark('firstDataAt'));
    on('loadedmetadata', () => this.syncPosition());
    on('durationchange', () => this.syncPosition());
    on('timeupdate', () => this.syncPosition());
    on('playing', () => {
      if (audio.paused) return;
      this.mark('playingAt');
      this.patch({ status: 'playing', error: null });
      this.setPlaybackState('playing');
    });
    on('pause', () => {
      if (
        audio.ended ||
        this.state.status === 'error' ||
        this.state.status === 'loading'
      )
        return;
      this.patch({ status: 'paused' });
      this.setPlaybackState('paused');
    });
    on('waiting', () => {
      if (!audio.paused) this.patch({ status: 'loading' });
    });
    on('stalled', () => {
      /* May recover automatically; do not replace the source. */
    });
    on('error', () =>
      this.fail(
        mediaErrorMessages[audio.error?.code ?? 0] ??
          'Errore audio. Tocca Riprova.',
      ),
    );
    on('ended', () => {
      if (this.state.index < this.state.queue.length - 1)
        this.select(this.state.index + 1, 'ended');
      else {
        this.patch({ status: 'ended', position: this.state.duration });
        this.setPlaybackState('paused');
      }
    });
    document.addEventListener('visibilitychange', this.visibilityChanged);
    this.setupMediaSession();
  }

  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private patch(patch: Partial<PlayerState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
  }
  private log(event: string) {
    // timeupdate can be frequent. Keep diagnostics useful and bounded.
    if (event === 'timeupdate') return;
    this.patch({
      events: [
        ...this.state.events,
        { event, at: this.now(), visibility: document.visibilityState },
      ].slice(-100),
    });
  }
  private visibilityChanged = () =>
    this.log(`visibility:${document.visibilityState}`);
  private mark(field: 'loadstartAt' | 'firstDataAt' | 'playingAt') {
    const at = this.now();
    this.patch({
      attempts: this.state.attempts.map((attempt) =>
        attempt.id === this.activeAttempt && attempt[field] === undefined
          ? { ...attempt, [field]: at }
          : attempt,
      ),
    });
  }

  setCatalog(tracks: Track[]) {
    if (this.state.queue.length > 0) return;
    this.patch({ queue: [...tracks] });
    this.updateMetadata();
  }
  enqueue(track: Track) {
    this.patch({ queue: [...this.state.queue, track] });
  }
  removeUpcoming(index: number) {
    if (index <= this.state.index || index >= this.state.queue.length) return;
    this.patch({ queue: this.state.queue.filter((_, i) => i !== index) });
  }
  moveUpcoming(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (
      index <= this.state.index ||
      target <= this.state.index ||
      target >= this.state.queue.length
    )
      return;
    const queue = [...this.state.queue];
    [queue[index], queue[target]] = [queue[target]!, queue[index]!];
    this.patch({ queue });
  }

  select(index: number, trigger: Trigger = 'tap') {
    const clickAt = this.now();
    const track = this.state.queue[index];
    if (!track) return;
    const token = ++this.command;
    const load =
      this.source !== track.audioUrl ||
      index !== this.state.index ||
      this.state.status === 'error';
    const attempt: PlaybackAttempt = {
      id: ++this.attemptId,
      trackId: track.id,
      title: track.title,
      trigger,
      kind: load ? 'load' : 'resume',
      clickAt,
    };
    this.activeAttempt = attempt.id;
    this.patch({
      index,
      status: 'loading',
      error: null,
      position: load ? 0 : this.audio.currentTime,
      duration: load ? 0 : this.state.duration,
      attempts: [...this.state.attempts, attempt].slice(-20),
    });
    this.updateMetadata();
    if (load) {
      this.source = track.audioUrl;
      const requestIssuedAt = this.now();
      this.patch({
        attempts: this.state.attempts.map((item) =>
          item.id === attempt.id ? { ...item, requestIssuedAt } : item,
        ),
      });
      // No fetch/blob/WebAudio indirection: preserve the native iOS audio pipeline.
      this.audio.src = track.audioUrl;
      this.audio.load();
    } else if (this.audio.ended) this.audio.currentTime = 0;
    // Keep play in the synchronous user gesture stack; catch failures afterwards.
    try {
      void this.audio.play().catch((error: unknown) => {
        if (token !== this.command) return; // Superseded rapid tap / pause.
        const name =
          error && typeof error === 'object' && 'name' in error
            ? error.name
            : '';
        this.fail(
          name === 'NotAllowedError'
            ? 'Il browser richiede un tocco sul pulsante Play per avviare l’audio.'
            : 'Riproduzione non riuscita. Controlla la connessione e tocca Riprova.',
        );
      });
    } catch {
      this.fail('Impossibile avviare l’audio. Tocca Riprova.');
    }
  }
  play(trigger: Trigger = 'tap') {
    this.select(this.state.index, trigger);
  }
  pause() {
    ++this.command;
    this.audio.pause();
    this.patch({ status: 'paused' });
    this.setPlaybackState('paused');
  }
  next(trigger: Trigger = 'tap') {
    if (this.state.index < this.state.queue.length - 1)
      this.select(this.state.index + 1, trigger);
  }
  previous(trigger: Trigger = 'tap') {
    if (this.audio.currentTime > 3) this.seek(0);
    else if (this.state.index > 0) this.select(this.state.index - 1, trigger);
  }
  seek(seconds: number) {
    if (!Number.isFinite(seconds) || this.state.duration <= 0) return;
    this.audio.currentTime = Math.max(
      0,
      Math.min(seconds, this.state.duration),
    );
    this.syncPosition();
  }
  private fail(message: string) {
    ++this.command;
    this.audio.pause();
    this.patch({
      status: 'error',
      error: message,
      attempts: this.state.attempts.map((attempt) =>
        attempt.id === this.activeAttempt
          ? { ...attempt, error: message }
          : attempt,
      ),
    });
    this.setPlaybackState('paused');
  }
  private syncPosition() {
    const duration = Number.isFinite(this.audio.duration)
      ? this.audio.duration
      : 0;
    this.patch({ duration, position: this.audio.currentTime || 0 });
    if (duration > 0 && typeof this.session?.setPositionState === 'function') {
      try {
        this.session.setPositionState({
          duration,
          playbackRate: this.audio.playbackRate,
          position: Math.min(this.audio.currentTime, duration),
        });
      } catch {
        /* Some browsers expose the method but reject position updates. */
      }
    }
  }
  private setPlaybackState(state: MediaSessionPlaybackState) {
    if (!this.session) return;
    try {
      this.session.playbackState = state;
    } catch {
      /* Optional platform integration. */
    }
  }
  private setupMediaSession() {
    if (!('mediaSession' in navigator) || !navigator.mediaSession) return;
    this.session = navigator.mediaSession;
    const actions: [MediaSessionAction, MediaSessionActionHandler][] = [
      ['play', () => this.play('media-session')],
      ['pause', () => this.pause()],
      ['previoustrack', () => this.previous('media-session')],
      ['nexttrack', () => this.next('media-session')],
      [
        'seekto',
        (details) => {
          if (details.seekTime !== undefined) this.seek(details.seekTime);
        },
      ],
      [
        'seekbackward',
        (details) =>
          this.seek(this.audio.currentTime - (details.seekOffset ?? 10)),
      ],
      [
        'seekforward',
        (details) =>
          this.seek(this.audio.currentTime + (details.seekOffset ?? 10)),
      ],
      [
        'stop',
        () => {
          this.pause();
          this.seek(0);
        },
      ],
    ];
    const supported: string[] = [];
    for (const [action, handler] of actions) {
      try {
        this.session.setActionHandler(action, handler);
        supported.push(action);
      } catch {
        /* Feature detection per action: Safari can reject individual actions. */
      }
    }
    this.patch({ mediaSession: true, mediaActions: supported });
  }
  private updateMetadata() {
    const track = this.state.queue[this.state.index];
    if (!this.session || !track || typeof MediaMetadata === 'undefined') return;
    try {
      this.session.metadata = new MediaMetadata({
        title: track.title,
        artist: track.artist,
        album: track.album,
        artwork: [
          {
            src: new URL(track.artworkUrl, window.location.origin).href,
            sizes: '512x512',
            type: 'image/png',
          },
        ],
      });
    } catch {
      /* Playback remains available without metadata support. */
    }
  }
  exportDiagnostics() {
    return JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        userAgent: navigator.userAgent,
        secureContext: window.isSecureContext,
        standalone:
          window.matchMedia?.('(display-mode: standalone)').matches ?? false,
        timeOrigin: performance.timeOrigin,
        state: this.state,
        note: 'performance.now() timestamps. loadstart is a request event proxy; loadeddata is decoded data, not network TTFB. Device results must be recorded separately.',
      },
      null,
      2,
    );
  }
  /** For tests / explicit application teardown only, never on navigation. */
  destroy() {
    ++this.command;
    this.audio.pause();
    this.audioListeners.forEach((listener, event) =>
      this.audio.removeEventListener(event, listener),
    );
    document.removeEventListener('visibilitychange', this.visibilityChanged);
    for (const action of this.state.mediaActions) {
      try {
        this.session?.setActionHandler(action as MediaSessionAction, null);
      } catch {
        /* Optional. */
      }
    }
    this.listeners.clear();
  }
}
