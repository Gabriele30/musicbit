interface OfficialPlayer {
  cueVideoById(id: string): void;
  playVideo(): void;
  pauseVideo(): void;
  destroy(): void;
}
interface OfficialSDK {
  Player: new (
    element: HTMLElement,
    config: {
      width: string;
      height: string;
      videoId: string;
      playerVars: { origin: string; playsinline: number; controls: number };
      events: {
        onReady: () => void;
        onStateChange: (event: { data: number }) => void;
        onError: (event: { data: number }) => void;
      };
    },
  ) => OfficialPlayer;
}
declare global {
  interface Window {
    YT?: OfficialSDK;
    onYouTubeIframeAPIReady?: () => void;
  }
}

/** Visible official-player control. This is NOT a native PlaybackProvider success. */
export class OfficialControl {
  private player?: OfficialPlayer;
  private loading?: Promise<void>;
  private cued?: string;
  private pending?: { videoId: string; clickAt: number; kind: string };
  readonly events: {
    event: string;
    at: number;
    videoId?: string;
    code?: number;
    clickToStatePlayingMs?: number;
    visibility: string;
  }[] = [];
  constructor(
    private element: HTMLElement,
    private changed: () => void,
  ) {
    document.addEventListener('visibilitychange', this.visibility);
    window.addEventListener('pagehide', this.hide);
  }
  private log(event: string, code?: number, clickToStatePlayingMs?: number) {
    this.events.push({
      event,
      at: performance.now(),
      videoId: this.pending?.videoId ?? this.cued,
      code,
      clickToStatePlayingMs,
      visibility: document.visibilityState,
    });
    if (this.events.length > 100) this.events.shift();
    this.changed();
  }
  private visibility = () => {
    if (document.visibilityState === 'hidden') {
      this.hide();
    }
  };
  private hide = () => {
    this.player?.pauseVideo();
    this.log('paused-background-policy');
  };
  load(videoId: string): Promise<void> {
    this.cued ??= videoId;
    this.loading ??= new Promise<void>((resolve, reject) => {
      this.log('sdk-start');
      const timer = setTimeout(() => {
        this.log('sdk-timeout');
        reject(new Error('SDK_TIMEOUT'));
      }, 12000);
      const ready = () => {
        if (!window.YT) return;
        this.player = new window.YT.Player(this.element, {
          width: '100%',
          height: '240',
          videoId,
          playerVars: { origin: location.origin, playsinline: 1, controls: 1 },
          events: {
            onReady: () => {
              clearTimeout(timer);
              this.log('ready');
              resolve();
            },
            onStateChange: (event) => {
              const elapsed =
                event.data === 1 && this.pending
                  ? performance.now() - this.pending.clickAt
                  : undefined;
              this.log('state', event.data, elapsed);
              if (event.data === 1) this.pending = undefined;
            },
            onError: (event) => this.log('error', event.data),
          },
        });
      };
      if (window.YT) ready();
      else {
        window.onYouTubeIframeAPIReady = ready;
        const script = document.createElement('script');
        script.src = 'https://www.youtube.com/iframe_api';
        script.onerror = () => {
          clearTimeout(timer);
          this.log('sdk-error');
          reject(new Error('SDK_UNAVAILABLE'));
        };
        document.head.append(script);
      }
    });
    return this.loading;
  }
  cue(id: string) {
    this.cued = id;
    this.player?.cueVideoById(id);
    this.log('cue-metadata-only');
  }
  play(id: string) {
    if (!this.player) return;
    this.pending = {
      videoId: id,
      clickAt: performance.now(),
      kind: 'official',
    };
    this.player.playVideo();
    this.log('play-click');
  }
  pause() {
    this.player?.pauseVideo();
  }
  dispose() {
    document.removeEventListener('visibilitychange', this.visibility);
    window.removeEventListener('pagehide', this.hide);
    this.player?.destroy();
  }
}
