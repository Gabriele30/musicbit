import { PLAYBACK_QUEUE_LIMIT, type Track } from '@musicbit/shared';
import { shuffled } from './random';
import { UpcomingAudio } from './upcoming-audio';
import { PlaybackAudioSession } from './audio-session';

export const PLAYBACK_REVISION = 'native-session-handoff-v2';

export type PlaybackStatus =
  | 'idle'
  | 'loading'
  | 'playing'
  | 'paused'
  | 'ended'
  | 'error';
export type Trigger = 'tap' | 'media-session' | 'ended';
export type RepeatMode = 'off' | 'all' | 'one';
export interface SavedSession {
  queue: Track[];
  index: number;
  position: number;
  repeat: RepeatMode;
  autoplay?: boolean;
}
export interface PlaybackAttempt {
  id: number;
  trackId: string;
  title: string;
  trigger: Trigger;
  kind: 'load' | 'resume' | 'prepared';
  clickAt: number;
  requestIssuedAt?: number;
  loadstartAt?: number;
  firstDataAt?: number;
  playingAt?: number;
  audibleAt?: number;
  cancelledAt?: number;
  waitingMs?: number;
  waitingAt?: number;
  error?: string;
}
export interface CatalogTiming {
  startedAt: number;
  headersAt?: number;
  bodyAt?: number;
  readyAt?: number;
  serverTiming?: string;
  error?: string;
}
export interface Preparation {
  trackId: string;
  startedAt: number;
  firstDataAt?: number;
  readyAt?: number;
  finishedAt?: number;
  outcome: 'loading' | 'ready' | 'cancelled' | 'timeout' | 'error' | 'used';
}
export interface BufferSnapshot {
  readyState: number;
  networkState: number;
  ranges: [number, number][];
  ahead: number;
}
export interface PlayerState {
  queue: Track[];
  index: number;
  status: PlaybackStatus;
  position: number;
  duration: number;
  error: string | null;
  attempts: PlaybackAttempt[];
  events: {
    event: string;
    at: number;
    visibility: string;
    position: number;
    trackId?: string;
    readyState: number;
    networkState: number;
    paused: boolean;
    ended: boolean;
    audioSession?: { type: string; state: string };
    persisted?: boolean;
  }[];
  catalog?: CatalogTiming;
  preparation?: Preparation;
  buffer: BufferSnapshot;
  lastProgressAt?: number;
  networkTimings: {
    url: string;
    start: number;
    end: number;
    responseStart?: number;
    connectMs?: number;
    requestToHeadersMs?: number;
  }[];
  mediaSession: boolean;
  mediaActions: string[];
  repeat: RepeatMode;
  autoplay: boolean;
  autoplayTracks: Track[];
  autoplayStatus: 'idle' | 'loading' | 'ready' | 'error';
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
    repeat: 'off',
    autoplay: true,
    autoplayTracks: [],
    autoplayStatus: 'idle',
    buffer: { readyState: 0, networkState: 0, ranges: [], ahead: 0 },
    networkTimings: [],
  };
  private listeners = new Set<() => void>();
  private audioListeners = new Map<string, EventListener>();
  private command = 0;
  private attemptId = 0;
  private activeAttempt: number | undefined;
  private source: string | undefined;
  private session: MediaSession | undefined;
  private playbackSession: PlaybackAudioSession;
  private deadline: ReturnType<typeof setTimeout> | undefined;
  private observer: PerformanceObserver | undefined;
  private resumePosition = 0;
  private pendingSeek: number | undefined;
  private durationRequest: AbortController | undefined;
  private resolvedDurations = new Map<string, number>();
  private upcomingAudio = new UpcomingAudio((event) =>
    this.log(`upcoming:${event}`),
  );

  private prepareUpcoming() {
    if (this.state.status !== 'playing' || this.audio.paused) return;
    const next =
      this.state.repeat === 'one'
        ? undefined
        : (this.state.queue[this.state.index + 1] ??
          (this.state.repeat === 'all'
            ? this.state.queue[0]
            : this.state.autoplay
              ? this.state.autoplayTracks[0]
              : undefined));
    this.upcomingAudio.prepare(
      next?.id === this.state.queue[this.state.index]?.id
        ? undefined
        : next?.audioUrl,
    );
  }

  private resolveDuration(track: Track) {
    this.durationRequest?.abort();
    if (!/^\/api\/audio\/[A-Za-z0-9_-]{11}$/.test(track.audioUrl)) return;
    const controller = new AbortController();
    this.durationRequest = controller;
    const timeout = setTimeout(() => controller.abort(), 50000);
    void fetch(`${track.audioUrl}/info`, {
      credentials: 'same-origin',
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) return;
        const data = (await response.json()) as { durationSeconds?: number };
        if (
          controller.signal.aborted ||
          !Number.isFinite(data.durationSeconds) ||
          !(data.durationSeconds! > 0)
        )
          return;
        if (this.resolvedDurations.size >= 1000) this.resolvedDurations.clear();
        this.resolvedDurations.set(track.id, data.durationSeconds!);
        if (this.state.queue[this.state.index]?.id === track.id)
          this.syncPosition();
      })
      .catch(() => {
        /* Catalog duration remains the offline fallback. */
      })
      .finally(() => clearTimeout(timeout));
  }

  constructor(
    readonly audio: HTMLAudioElement,
    private now = () => performance.now(),
    private timeoutMs = 15000,
  ) {
    this.playbackSession = new PlaybackAudioSession((event) => this.log(event));
    audio.preload = 'none';
    audio.setAttribute('playsinline', '');
    const on = (event: string, fn: () => void) => {
      const listener = () => {
        this.syncBuffer();
        this.log(event);
        fn();
      };
      this.audioListeners.set(event, listener);
      audio.addEventListener(event, listener);
    };
    on('loadstart', () => this.mark('loadstartAt'));
    on('loadeddata', () => {
      this.mark('firstDataAt');
      if (this.state.preparation?.outcome === 'loading')
        this.patch({
          preparation: { ...this.state.preparation, firstDataAt: this.now() },
        });
    });
    on('canplay', () => {
      if (this.state.preparation?.outcome === 'loading') {
        this.clearDeadline();
        this.patch({
          preparation: {
            ...this.state.preparation,
            readyAt: this.now(),
            outcome: 'ready',
          },
        });
      }
    });
    on('progress', () => this.patch({ lastProgressAt: this.now() }));
    on('suspend', () => {});
    on('emptied', () => {});
    on('abort', () => {});
    on('seeking', () => {});
    on('seeked', () => {});
    on('loadedmetadata', () => {
      this.syncPosition();
      if (this.pendingSeek !== undefined && this.state.duration > 0) {
        const position = this.pendingSeek;
        this.pendingSeek = undefined;
        this.seek(Math.min(position, Math.max(0, this.state.duration - 0.1)));
      }
    });
    on('durationchange', () => this.syncPosition());
    on('timeupdate', () => this.syncPosition());
    on('playing', () => {
      if (audio.paused) return;
      this.clearDeadline();
      this.endWaiting();
      this.mark('playingAt');
      this.patch({ status: 'playing', error: null });
      this.setPlaybackState('playing');
      this.prepareUpcoming();
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
      if (!audio.paused) {
        this.patch({ status: 'loading' });
        this.setPlaybackState('paused');
        this.updateAttempt((item) =>
          item.waitingAt === undefined
            ? { ...item, waitingAt: this.now() }
            : item,
        );
        this.armDeadline();
      }
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
      if (
        !audio.ended ||
        this.state.status === 'error' ||
        this.state.status === 'paused'
      )
        return;
      const attempt = this.state.attempts.find(
        (item) => item.id === this.activeAttempt,
      );
      if (!attempt) return;
      if (attempt.playingAt === undefined) {
        this.fail(
          'Il browser ha terminato lo stream prima di avviare l’audio. Tocca Riprova o scegli un altro brano.',
        );
        return;
      }
      this.handleTrackEnded();
    });
    document.addEventListener('visibilitychange', this.visibilityChanged);
    for (const event of ['pagehide', 'pageshow', 'online', 'offline'])
      window.addEventListener(event, this.lifecycleChanged);
    for (const event of ['freeze', 'resume'])
      document.addEventListener(event, this.lifecycleChanged);
    if (typeof PerformanceObserver !== 'undefined') {
      try {
        this.observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries() as PerformanceResourceTiming[]) {
            if (
              !this.state.queue.some(
                (track) =>
                  new URL(track.audioUrl, location.href).href === entry.name,
              )
            )
              continue;
            const exposed = entry.responseStart > 0;
            this.patch({
              networkTimings: [
                ...this.state.networkTimings,
                {
                  url: entry.name,
                  start: entry.startTime,
                  end: entry.responseEnd,
                  responseStart: exposed ? entry.responseStart : undefined,
                  connectMs: exposed
                    ? entry.connectEnd - entry.connectStart
                    : undefined,
                  requestToHeadersMs: exposed
                    ? entry.responseStart - entry.requestStart
                    : undefined,
                },
              ].slice(-20),
            });
          }
        });
        this.observer.observe({ type: 'resource', buffered: true });
      } catch {
        /* Timing is optional, and cross-origin details may be hidden. */
      }
    }
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
  private log(event: string, persisted?: boolean) {
    // timeupdate can be frequent. Keep diagnostics useful and bounded.
    if (event === 'timeupdate') return;
    this.patch({
      events: [
        ...this.state.events,
        {
          event,
          at: this.now(),
          visibility: document.visibilityState,
          position: this.audio.currentTime || 0,
          trackId: this.state.queue[this.state.index]?.id,
          readyState: this.audio.readyState ?? 0,
          networkState: this.audio.networkState ?? 0,
          paused: this.audio.paused,
          ended: this.audio.ended,
          audioSession: this.playbackSession.snapshot(),
          persisted,
        },
      ].slice(-100),
    });
  }
  private visibilityChanged = () =>
    this.log(`visibility:${document.visibilityState}`);
  private lifecycleChanged = (event: Event) =>
    this.log(
      event.type,
      'persisted' in event ? Boolean(event.persisted) : undefined,
    );
  private updateAttempt(update: (attempt: PlaybackAttempt) => PlaybackAttempt) {
    this.patch({
      attempts: this.state.attempts.map((item) =>
        item.id === this.activeAttempt ? update(item) : item,
      ),
    });
  }
  private syncBuffer() {
    const ranges: [number, number][] = [];
    for (let i = 0; i < (this.audio.buffered?.length ?? 0); i++)
      ranges.push([this.audio.buffered.start(i), this.audio.buffered.end(i)]);
    const position = this.audio.currentTime || 0;
    const range = ranges.find(
      ([start, end]) => start <= position && end >= position,
    );
    this.patch({
      buffer: {
        readyState: this.audio.readyState ?? 0,
        networkState: this.audio.networkState ?? 0,
        ranges,
        ahead: range ? range[1] - position : 0,
      },
    });
  }
  private clearDeadline() {
    clearTimeout(this.deadline);
    this.deadline = undefined;
  }
  private armDeadline() {
    if (this.deadline !== undefined) return;
    const token = this.command;
    const position = this.audio.currentTime;
    // The proxy may need up to 45s to resolve plus 15s for upstream headers.
    const timeoutMs = this.source?.startsWith('/api/audio/')
      ? Math.max(this.timeoutMs, 60000)
      : this.timeoutMs;
    this.deadline = setTimeout(() => {
      this.deadline = undefined;
      if (token !== this.command) return;
      // A suspended page can receive timers before delayed media events on resume.
      // Never stop progressing native audio merely because JS did not see playing.
      if (
        !this.audio.paused &&
        this.audio.readyState >= 3 &&
        this.audio.currentTime > position
      ) {
        this.syncPosition();
        this.endWaiting();
        this.patch({ status: 'playing' });
        this.setPlaybackState('playing');
        this.log('deadline:native-progress');
        return;
      }
      if (document.visibilityState === 'hidden') {
        this.log('deadline:deferred-hidden');
        this.armDeadline();
        return;
      }
      if (this.state.preparation?.outcome === 'loading')
        this.cancelPreparation('timeout');
      else
        this.fail(
          'Timeout audio: il caricamento non sta avanzando. Tocca Riprova.',
        );
    }, timeoutMs);
  }
  private endWaiting() {
    const at = this.now();
    this.updateAttempt((item) =>
      item.waitingAt === undefined
        ? item
        : {
            ...item,
            waitingMs: (item.waitingMs ?? 0) + at - item.waitingAt,
            waitingAt: undefined,
          },
    );
  }
  recordCatalog(catalog: CatalogTiming) {
    if (catalog.startedAt >= (this.state.catalog?.startedAt ?? 0))
      this.patch({ catalog });
  }
  /** A human observation including reaction time; playing alone cannot prove audible output. */
  markAudible() {
    if (this.state.status !== 'playing') return;
    this.updateAttempt((item) =>
      item.audibleAt === undefined ? { ...item, audibleAt: this.now() } : item,
    );
    this.log('manual:audible');
  }
  prepare() {
    const track = this.state.queue[this.state.index];
    if (
      !track ||
      !this.audio.paused ||
      this.state.status === 'loading' ||
      this.state.status === 'playing'
    )
      return;
    this.clearDeadline();
    ++this.command;
    this.activeAttempt = undefined;
    this.resumePosition = 0;
    this.pendingSeek = undefined;
    this.source = track.audioUrl;
    this.patch({
      error: null,
      status: 'idle',
      position: 0,
      duration: 0,
      preparation: {
        trackId: track.id,
        startedAt: this.now(),
        outcome: 'loading',
      },
    });
    // Opt-in: auto is only a browser hint and can download the entire file.
    this.audio.preload = 'auto';
    this.audio.src = track.audioUrl;
    this.audio.load();
    this.armDeadline();
    this.log('prepare');
  }
  cancelPreparation(outcome: 'cancelled' | 'timeout' = 'cancelled') {
    if (!['loading', 'ready'].includes(this.state.preparation?.outcome ?? ''))
      return;
    this.clearDeadline();
    ++this.command;
    this.releaseSource();
    this.patch({
      preparation: {
        ...this.state.preparation!,
        outcome,
        finishedAt: this.now(),
      },
    });
    this.log(`prepare:${outcome}`);
  }
  private releaseSource() {
    this.audio.pause();
    this.source = undefined;
    this.audio.preload = 'none';
    this.audio.removeAttribute('src');
    this.audio.load();
    this.upcomingAudio.clear();
    this.syncBuffer();
  }
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
    return this.enqueueMany([track]);
  }
  enqueueMany(tracks: Track[]) {
    if (
      !tracks.length ||
      this.state.queue.length + tracks.length > PLAYBACK_QUEUE_LIMIT
    )
      return false;
    this.patch({ queue: [...this.state.queue, ...tracks] });
    if (this.state.queue.length === tracks.length) this.updateMetadata();
    this.prepareUpcoming();
    return true;
  }
  playCollection(tracks: Track[], startIndex = 0) {
    if (!tracks.length) return;
    const index = Number.isInteger(startIndex)
      ? Math.max(0, Math.min(startIndex, tracks.length - 1))
      : 0;
    this.source = undefined;
    this.resumePosition = 0;
    this.pendingSeek = undefined;
    this.patch({ queue: [...tracks], index });
    this.select(index);
  }
  restoreSession(session: SavedSession) {
    if (this.source || this.state.queue.length || !session.queue.length) return;
    this.resumePosition = session.position;
    this.patch({
      index: session.index,
      position: session.position,
      repeat: session.repeat,
      autoplay: session.autoplay ?? true,
      queue: [...session.queue],
      status: 'paused',
      duration: session.queue[session.index]?.durationSeconds ?? 0,
    });
    this.updateMetadata();
  }
  /** Account changes stop the previous session while retaining the lifetime audio node. */
  resetSession() {
    this.clearDeadline();
    ++this.command;
    this.resumePosition = 0;
    this.pendingSeek = undefined;
    this.releaseSource();
    this.playbackSession.release();
    this.patch({
      queue: [],
      index: 0,
      position: 0,
      duration: 0,
      status: 'idle',
      repeat: 'off',
      autoplay: true,
      autoplayTracks: [],
      autoplayStatus: 'idle',
      preparation: undefined,
      catalog: undefined,
      attempts: [],
      events: [],
      networkTimings: [],
      error: null,
    });
    this.updateMetadata();
    this.setPlaybackState('none');
  }
  cycleRepeat() {
    const modes: RepeatMode[] = ['off', 'all', 'one'];
    this.patch({
      repeat: modes[(modes.indexOf(this.state.repeat) + 1) % modes.length]!,
    });
    this.prepareUpcoming();
  }
  toggleAutoplay() {
    this.patch({
      autoplay: !this.state.autoplay,
      autoplayTracks: [],
      autoplayStatus: 'idle',
    });
    this.prepareUpcoming();
  }
  setRecommendations(
    seedId: string,
    tracks: Track[],
    status: PlayerState['autoplayStatus'] = 'ready',
  ) {
    if (
      !this.state.autoplay ||
      this.state.queue[this.state.index]?.id !== seedId
    )
      return;
    const queued = new Set(
      this.state.queue.slice(-200).map((track) => track.id),
    );
    const unique = new Map(
      tracks
        .filter((track) => !queued.has(track.id))
        .map((track) => [track.id, track]),
    );
    this.patch({
      autoplayTracks: [...unique.values()],
      autoplayStatus: status,
    });
    this.prepareUpcoming();
    if (status === 'ready' && this.state.status === 'ended' && unique.size)
      this.advanceAutoplay('ended');
  }
  private advanceAutoplay(trigger: Trigger): boolean {
    const track =
      this.state.autoplay &&
      this.state.autoplayTracks.find(
        (item) =>
          !this.state.queue.slice(-200).some((queued) => queued.id === item.id),
      );
    if (!track) return false;
    const queue =
      this.state.queue.length >= 500
        ? this.state.queue.slice(-200)
        : this.state.queue;
    const index = queue.length;
    this.patch({
      queue: [...queue, track],
      index: index - 1,
      autoplayTracks: [],
    });
    this.select(index, trigger);
    return true;
  }
  shuffleUpcoming() {
    this.patch({ queue: shuffled(this.state.queue, this.state.index + 1) });
    this.prepareUpcoming();
  }
  startRadio(tracks: Track[]) {
    if (!tracks.length) return;
    if (!this.state.autoplay) this.toggleAutoplay();
    if (this.state.repeat !== 'off') this.patch({ repeat: 'off' });
    this.playCollection(tracks);
  }
  removeUpcoming(index: number) {
    if (index <= this.state.index || index >= this.state.queue.length) return;
    this.patch({ queue: this.state.queue.filter((_, i) => i !== index) });
    this.prepareUpcoming();
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
    this.prepareUpcoming();
  }

  select(index: number, trigger: Trigger = 'tap') {
    const clickAt = this.now();
    const track = this.state.queue[index];
    if (!track) return;
    this.clearDeadline();
    if (this.state.status === 'loading') {
      this.endWaiting();
      this.updateAttempt((item) =>
        item.playingAt === undefined
          ? { ...item, cancelledAt: this.now() }
          : item,
      );
    }
    const token = ++this.command;
    const restart = this.state.status === 'ended';
    if (this.state.queue[this.state.index]?.id !== track.id)
      this.patch({ autoplayTracks: [], autoplayStatus: 'idle' });
    const resumeAt = index === this.state.index ? this.resumePosition : 0;
    this.resumePosition = 0;
    const prepared =
      index === this.state.index &&
      this.source === track.audioUrl &&
      ['loading', 'ready'].includes(this.state.preparation?.outcome ?? '');
    const load =
      this.source !== track.audioUrl ||
      index !== this.state.index ||
      this.state.status === 'error';
    const attempt: PlaybackAttempt = {
      id: ++this.attemptId,
      trackId: track.id,
      title: track.title,
      trigger,
      kind: load
        ? this.upcomingAudio.take(track.audioUrl)
          ? 'prepared'
          : 'load'
        : prepared
          ? 'prepared'
          : 'resume',
      clickAt,
    };
    this.activeAttempt = attempt.id;
    if (
      this.state.preparation &&
      ['loading', 'ready'].includes(this.state.preparation.outcome)
    )
      this.patch({
        preparation: {
          ...this.state.preparation,
          outcome: prepared ? 'used' : 'cancelled',
          finishedAt: clickAt,
        },
      });
    this.log(`select:${trigger}:${track.id}`);
    this.patch({
      index,
      status: 'loading',
      error: null,
      position: load ? resumeAt : this.audio.currentTime,
      duration: load ? track.durationSeconds || 0 : this.state.duration,
      attempts: [...this.state.attempts, attempt].slice(-20),
    });
    this.playbackSession.activate();
    // Do not let the old lock-screen timeline extrapolate into an unstarted song.
    this.setPlaybackState('paused');
    this.clearPositionState();
    this.updateMetadata();
    this.audio.preload = 'auto';
    if (load) {
      this.pendingSeek = resumeAt > 0 ? resumeAt : undefined;
      this.source = track.audioUrl;
      const requestIssuedAt = this.now();
      this.patch({
        attempts: this.state.attempts.map((item) =>
          item.id === attempt.id ? { ...item, requestIssuedAt } : item,
        ),
      });
      // Keep native HTTP playback; a prefetched song is served from server RAM.
      this.upcomingAudio.clear();
      this.audio.src = track.audioUrl;
      // src assignment already starts native resource selection. An explicit
      // load() tears down the current pipeline again during the background handoff.
    } else if (this.audio.ended || restart) this.audio.currentTime = 0;
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
    if (this.state.status === 'loading') this.armDeadline();
    // play() above must stay synchronous in the gesture; metadata follows it.
    if (load) this.resolveDuration(track);
  }
  play(trigger: Trigger = 'tap') {
    this.select(this.state.index, trigger);
  }
  pause() {
    this.clearDeadline();
    this.endWaiting();
    this.updateAttempt((item) =>
      item.playingAt === undefined
        ? { ...item, cancelledAt: this.now() }
        : item,
    );
    ++this.command;
    this.audio.pause();
    this.patch({ status: 'paused' });
    this.setPlaybackState('paused');
  }
  next(trigger: Trigger = 'tap') {
    if (this.state.index < this.state.queue.length - 1)
      this.select(this.state.index + 1, trigger);
    else if (this.state.repeat === 'all') {
      this.audio.currentTime = 0;
      this.select(0, trigger);
    } else this.advanceAutoplay(trigger);
  }
  previous(trigger: Trigger = 'tap') {
    if (this.audio.currentTime > 3) this.seek(0);
    else if (this.state.index > 0) this.select(this.state.index - 1, trigger);
    else if (this.state.repeat === 'all')
      this.select(this.state.queue.length - 1, trigger);
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
    this.clearDeadline();
    this.endWaiting();
    ++this.command;
    this.releaseSource();
    if (this.state.preparation?.outcome === 'loading')
      this.patch({
        preparation: {
          ...this.state.preparation,
          outcome: 'error',
          finishedAt: this.now(),
        },
      });
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
  private isHandlingEnded = false;
  private handleTrackEnded() {
    if (this.isHandlingEnded) return;
    this.isHandlingEnded = true;
    try {
      this.clearDeadline();
      this.endWaiting();
      if (this.state.repeat === 'one') {
        this.audio.currentTime = 0;
        this.select(this.state.index, 'ended');
      } else if (this.state.index < this.state.queue.length - 1) {
        this.select(this.state.index + 1, 'ended');
      } else if (this.state.repeat === 'all') {
        this.audio.currentTime = 0;
        this.select(0, 'ended');
      } else if (!this.advanceAutoplay('ended')) {
        this.audio.pause();
        this.patch({ status: 'ended', position: this.state.duration });
        this.setPlaybackState('paused');
      }
    } finally {
      this.isHandlingEnded = false;
    }
  }

  private syncPosition() {
    const track = this.state.queue[this.state.index];
    const rawAudioDuration = Number.isFinite(this.audio.duration)
      ? this.audio.duration
      : 0;

    // Some proxied AAC streams report twice their actual duration. Restrict the
    // workaround to that signature; ordinary catalog estimates never cut audio.
    const known =
      (track && this.resolvedDurations.get(track.id)) ??
      track?.durationSeconds ??
      0;
    const doubled =
      !!track?.audioUrl.startsWith('/api/audio/') &&
      known >= 30 &&
      rawAudioDuration >= known * 1.8 &&
      rawAudioDuration <= known * 2.2;
    const duration = doubled
      ? known
      : rawAudioDuration > 0
        ? rawAudioDuration
        : known;

    const currentPosition = this.audio.currentTime || 0;
    this.patch({
      duration,
      position: doubled ? Math.min(currentPosition, duration) : currentPosition,
    });

    // Allow the complete catalog duration plus a grace period, never -0.5s.
    if (
      doubled &&
      currentPosition >= known + 1 &&
      this.state.status === 'playing' &&
      !this.audio.paused &&
      !this.audio.seeking
    ) {
      this.log('duration:doubled-tail');
      this.handleTrackEnded();
      return;
    }

    if (duration > 0 && typeof this.session?.setPositionState === 'function') {
      try {
        this.session.setPositionState({
          duration,
          playbackRate: this.audio.playbackRate,
          position: Math.min(currentPosition, duration),
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
  private clearPositionState() {
    try {
      this.session?.setPositionState?.();
    } catch {
      /* Position state is optional, independently of other session fields. */
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
    if (!this.session) return;
    if (!track) {
      try {
        this.session.metadata = null;
      } catch {
        /* Unsupported individual Media Session fields do not affect playback. */
      }
      return;
    }
    if (typeof MediaMetadata === 'undefined') return;
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
        playbackRevision: PLAYBACK_REVISION,
        audioSession: this.playbackSession.snapshot(),
        state: this.state,
        note: 'performance.now() timestamps. loadstart is a request event proxy; loadeddata is decoded data, not network TTFB. Device results must be recorded separately.',
      },
      null,
      2,
    );
  }
  /** For tests / explicit application teardown only, never on navigation. */
  destroy() {
    this.durationRequest?.abort();
    this.clearDeadline();
    this.observer?.disconnect();
    ++this.command;
    this.audio.pause();
    this.audioListeners.forEach((listener, event) =>
      this.audio.removeEventListener(event, listener),
    );
    this.audio.removeAttribute('src');
    this.audio.preload = 'none';
    this.audio.load();
    this.upcomingAudio.clear();
    this.playbackSession.destroy();
    document.removeEventListener('visibilitychange', this.visibilityChanged);
    for (const event of ['pagehide', 'pageshow', 'online', 'offline'])
      window.removeEventListener(event, this.lifecycleChanged);
    for (const event of ['freeze', 'resume'])
      document.removeEventListener(event, this.lifecycleChanged);
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
