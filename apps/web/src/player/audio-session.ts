interface BrowserAudioSession extends EventTarget {
  type: string;
  readonly state: string;
}

/** Optional platform audio category; independent of lock-screen Media Session. */
export class PlaybackAudioSession {
  private session?: BrowserAudioSession;
  private previousType?: string;

  constructor(private log: (event: string) => void) {
    try {
      this.session = (
        navigator as Navigator & { audioSession?: BrowserAudioSession }
      ).audioSession;
      this.session?.addEventListener('statechange', this.changed);
    } catch {
      // Partial implementations must never prevent native HTML audio playback.
    }
  }

  private changed = () => {
    this.log(`audio-session:${this.snapshot()?.state ?? 'unavailable'}`);
  };

  activate() {
    try {
      if (!this.session || this.session.type === 'playback') return;
      this.previousType ??= this.session.type;
      this.session.type = 'playback';
      this.log('audio-session:playback');
    } catch {
      this.log('audio-session:unsupported');
    }
  }

  snapshot() {
    try {
      if (this.session)
        return { type: this.session.type, state: this.session.state };
    } catch {
      // Diagnostic reads are optional too.
    }
    return undefined;
  }

  release() {
    try {
      if (this.session?.type === 'playback' && this.previousType !== undefined)
        this.session.type = this.previousType;
    } catch {
      // Teardown cannot fail because an experimental property is read-only.
    }
    this.previousType = undefined;
  }

  destroy() {
    try {
      this.session?.removeEventListener('statechange', this.changed);
    } catch {
      // A partially exposed API may also reject listener removal.
    }
    this.release();
  }
}
