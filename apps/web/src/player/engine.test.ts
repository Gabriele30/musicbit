import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Track } from '@musicbit/shared';
import { PlayerEngine } from './engine';

const tracks: Track[] = [1, 2, 3].map((id) => ({
  id: `track-${id}`,
  title: `Track ${id}`,
  artist: 'Artist',
  album: 'Demo',
  audioUrl: `https://example.com/${id}.mp3`,
  artworkUrl: `/artwork/${id}.png`,
  mimeType: 'audio/mpeg',
  sourceUrl: 'https://example.com',
  permission: 'Authorized',
  attribution: 'Artist',
}));
class FakeAudio extends EventTarget {
  src = '';
  preload = '';
  readyState = 0;
  networkState = 0;
  buffered = { length: 0, start: () => 0, end: () => 0 };
  currentTime = 0;
  duration = 120;
  paused = true;
  ended = false;
  playbackRate = 1;
  error: { code: number } | null = null;
  setAttribute = vi.fn();
  removeAttribute = vi.fn(() => {
    this.src = '';
  });
  load = vi.fn();
  play = vi.fn(() => {
    this.paused = false;
    return Promise.resolve();
  });
  pause = vi.fn(() => {
    this.paused = true;
    this.dispatchEvent(new Event('pause'));
  });
  emit(name: string) {
    this.dispatchEvent(new Event(name));
  }
}
const engines: PlayerEngine[] = [];
const descriptor = Object.getOwnPropertyDescriptor(navigator, 'mediaSession');
function setup() {
  const audio = new FakeAudio();
  let clock = 100;
  const player = new PlayerEngine(
    audio as unknown as HTMLAudioElement,
    () => clock,
  );
  engines.push(player);
  player.setCatalog(tracks);
  return {
    audio,
    player,
    tick: (ms: number) => {
      clock += ms;
    },
  };
}
afterEach(() => {
  engines.splice(0).forEach((player) => player.destroy());
  if (descriptor) Object.defineProperty(navigator, 'mediaSession', descriptor);
  else Reflect.deleteProperty(navigator, 'mediaSession');
  vi.useRealTimers();
});

describe('persistent player', () => {
  it('prepares without autoplay and consumes the same source without loading again', () => {
    const { audio, player, tick } = setup();
    player.prepare();
    expect(audio.preload).toBe('auto');
    expect(audio.play).not.toHaveBeenCalled();
    tick(200);
    audio.emit('loadeddata');
    audio.readyState = 3;
    audio.emit('canplay');
    player.play();
    expect(audio.load).toHaveBeenCalledOnce();
    expect(audio.play).toHaveBeenCalledOnce();
    expect(player.getSnapshot().attempts.at(-1)?.kind).toBe('prepared');
    expect(player.getSnapshot().preparation).toMatchObject({
      outcome: 'used',
      readyAt: 300,
    });
  });
  it('cancels preparation, aborts native loading and does not reuse cancelled data', () => {
    const { audio, player } = setup();
    player.prepare();
    player.cancelPreparation();
    expect(audio.removeAttribute).toHaveBeenCalledWith('src');
    expect(player.getSnapshot().preparation?.outcome).toBe('cancelled');
    player.play();
    expect(player.getSnapshot().attempts.at(-1)?.kind).toBe('load');
    expect(audio.src).toBe(tracks[0]!.audioUrl);
  });
  it('times out preparation and a stalled start, and clears obsolete deadlines on next', () => {
    vi.useFakeTimers();
    const { audio, player } = setup();
    player.prepare();
    vi.advanceTimersByTime(15000);
    expect(player.getSnapshot().preparation?.outcome).toBe('timeout');
    player.play();
    vi.advanceTimersByTime(14000);
    player.next();
    vi.advanceTimersByTime(1000);
    expect(player.getSnapshot().error).toBeNull();
    vi.advanceTimersByTime(14000);
    expect(player.getSnapshot().error).toContain('Timeout');
    expect(audio.src).toBe('');
    player.play();
    audio.emit('playing');
    vi.advanceTimersByTime(20000);
    expect(player.getSnapshot().status).toBe('playing');
  });
  it('records buffering ranges, waiting recovery and manual audible observation separately', () => {
    const { audio, player, tick } = setup();
    player.play();
    audio.buffered = { length: 1, start: () => 0, end: () => 8 };
    audio.readyState = 2;
    audio.currentTime = 2;
    audio.emit('waiting');
    tick(250);
    audio.emit('playing');
    tick(300);
    player.markAudible();
    expect(player.getSnapshot().buffer.ahead).toBe(6);
    expect(player.getSnapshot().attempts.at(-1)).toMatchObject({
      waitingMs: 250,
      playingAt: 350,
      audibleAt: 650,
    });
  });
  it('does not stop native audio progressing while JavaScript media events were delayed', () => {
    vi.useFakeTimers();
    const { audio, player } = setup();
    player.play();
    audio.currentTime = 10;
    audio.readyState = 4;
    vi.advanceTimersByTime(15000);
    expect(player.getSnapshot().error).toBeNull();
    expect(player.getSnapshot().status).toBe('playing');
    expect(player.getSnapshot().attempts.at(-1)?.playingAt).toBeUndefined();
    expect(player.getSnapshot().events.at(-1)?.event).toBe(
      'deadline:native-progress',
    );
  });
  it('defers a hidden-page deadline and enforces it again when visible', () => {
    vi.useFakeTimers();
    const { player } = setup();
    const visibility = vi
      .spyOn(document, 'visibilityState', 'get')
      .mockReturnValue('hidden');
    player.play();
    vi.advanceTimersByTime(15000);
    expect(player.getSnapshot().error).toBeNull();
    expect(player.getSnapshot().events.at(-1)?.event).toBe(
      'deadline:deferred-hidden',
    );
    visibility.mockReturnValue('visible');
    vi.advanceTimersByTime(15000);
    expect(player.getSnapshot().error).toContain('Timeout');
    visibility.mockRestore();
  });
  it('records lifecycle context without claiming background playback', () => {
    const { player, audio } = setup();
    audio.currentTime = 7;
    window.dispatchEvent(new Event('pagehide'));
    expect(player.getSnapshot().events.at(-1)).toMatchObject({
      event: 'pagehide',
      position: 7,
      trackId: 'track-1',
    });
  });
  it('restarts a distinct queue entry even when it repeats the same source', () => {
    const { audio, player } = setup();
    player.enqueue(tracks[0]!);
    player.play();
    audio.currentTime = 25;
    player.select(3);
    expect(audio.load).toHaveBeenCalledTimes(2);
    expect(player.getSnapshot().attempts.at(-1)?.kind).toBe('load');
    expect(player.getSnapshot().position).toBe(0);
  });
  it('does not preload and calls play synchronously on the same element across tracks', () => {
    const { audio, player } = setup();
    expect(audio.preload).toBe('none');
    expect(audio.load).not.toHaveBeenCalled();
    player.play();
    expect(audio.play).toHaveBeenCalledOnce();
    player.next();
    expect(player.audio).toBe(audio);
    expect(audio.src).toBe(tracks[1]!.audioUrl);
    player.previous();
    expect(audio.src).toBe(tracks[0]!.audioUrl);
  });
  it('records first events in order and keeps the first playing timestamp', () => {
    const { audio, player, tick } = setup();
    player.play();
    tick(4);
    audio.emit('loadstart');
    tick(16);
    audio.emit('loadeddata');
    tick(10);
    audio.emit('playing');
    tick(50);
    audio.emit('playing');
    expect(player.getSnapshot().attempts[0]).toMatchObject({
      clickAt: 100,
      requestIssuedAt: 100,
      loadstartAt: 104,
      firstDataAt: 120,
      playingAt: 130,
    });
  });
  it('pauses a pending load and resumes without a new source request', () => {
    const { audio, player } = setup();
    player.play();
    player.pause();
    expect(player.getSnapshot().status).toBe('paused');
    player.play();
    expect(audio.load).toHaveBeenCalledOnce();
    expect(player.getSnapshot().attempts.at(-1)).toMatchObject({
      kind: 'resume',
    });
    expect(
      player.getSnapshot().attempts.at(-1)?.requestIssuedAt,
    ).toBeUndefined();
  });
  it('auto advances at ended and stops at the end of the queue', () => {
    const { audio, player } = setup();
    player.play();
    audio.emit('ended');
    expect(player.getSnapshot().index).toBe(1);
    expect(player.getSnapshot().attempts.at(-1)?.trigger).toBe('ended');
    audio.emit('ended');
    audio.emit('ended');
    expect(player.getSnapshot().status).toBe('ended');
    expect(player.getSnapshot().index).toBe(2);
    expect(audio.play).toHaveBeenCalledTimes(3);
  });
  it('restarts the current track on previous after three seconds and clamps seeking', () => {
    const { audio, player } = setup();
    player.next();
    audio.currentTime = 10;
    audio.emit('loadedmetadata');
    player.previous();
    expect(player.getSnapshot().index).toBe(1);
    expect(audio.currentTime).toBe(0);
    player.seek(1000);
    expect(audio.currentTime).toBe(120);
    player.seek(-5);
    expect(audio.currentTime).toBe(0);
    player.seek(Number.NaN);
    expect(audio.currentTime).toBe(0);
  });
  it('edits only upcoming entries and allows duplicate enqueues', () => {
    const { player } = setup();
    player.removeUpcoming(0);
    expect(player.getSnapshot().queue).toHaveLength(3);
    player.moveUpcoming(2, -1);
    expect(player.getSnapshot().queue[1]?.id).toBe('track-3');
    player.removeUpcoming(1);
    player.enqueue(tracks[0]!);
    expect(player.getSnapshot().queue.map((track) => track.id)).toEqual([
      'track-1',
      'track-2',
      'track-1',
    ]);
  });
  it('shows autoplay rejection and allows an explicit retry', async () => {
    const { audio, player } = setup();
    audio.play.mockRejectedValueOnce(
      new DOMException('blocked', 'NotAllowedError'),
    );
    player.play();
    await Promise.resolve();
    expect(player.getSnapshot().error).toContain('tocco');
    expect(player.getSnapshot().status).toBe('error');
    player.play();
    audio.emit('playing');
    expect(player.getSnapshot().error).toBeNull();
    expect(audio.src).toBe(tracks[0]!.audioUrl);
    // load(), then cancellation via removeAttribute/load(), then retry load().
    expect(audio.load).toHaveBeenCalledTimes(3);
  });
  it('ignores a rejected play promise superseded by a rapid next or pause', async () => {
    const { audio, player } = setup();
    let reject!: (reason: Error) => void;
    audio.play.mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, fail) => {
          reject = fail;
        }),
    );
    player.play();
    player.next();
    reject(new Error('interrupted'));
    await Promise.resolve();
    expect(player.getSnapshot().error).toBeNull();
    expect(player.getSnapshot().index).toBe(1);
  });
  it('reports media network errors and buffering without losing the queue', () => {
    const { audio, player } = setup();
    player.play();
    audio.emit('playing');
    audio.emit('waiting');
    expect(player.getSnapshot().status).toBe('loading');
    audio.error = { code: 2 };
    audio.emit('error');
    expect(player.getSnapshot().error).toContain('rete');
    expect(player.getSnapshot().queue).toHaveLength(3);
  });
  it('registers supported Media Session controls and full metadata', () => {
    const handlers = new Map<string, MediaSessionActionHandler>();
    const session = {
      metadata: null,
      playbackState: 'none',
      setPositionState: vi.fn(),
      setActionHandler: vi.fn((action, handler) => {
        if (action === 'seekto') throw new Error('unsupported');
        handlers.set(action, handler);
      }),
    };
    Object.defineProperty(navigator, 'mediaSession', {
      configurable: true,
      value: session,
    });
    vi.stubGlobal(
      'MediaMetadata',
      class {
        constructor(data: object) {
          Object.assign(this, data);
        }
      },
    );
    const { audio, player } = setup();
    expect(player.getSnapshot().mediaActions).toContain('nexttrack');
    expect(player.getSnapshot().mediaActions).not.toContain('seekto');
    handlers.get('play')!({ action: 'play' });
    audio.emit('playing');
    expect(player.getSnapshot().attempts.at(-1)?.trigger).toBe('media-session');
    expect(session.metadata).toMatchObject({
      title: 'Track 1',
      artist: 'Artist',
      artwork: [
        {
          src: 'http://localhost:3000/artwork/1.png',
          sizes: '512x512',
          type: 'image/png',
        },
      ],
    });
    expect(session.playbackState).toBe('playing');
    handlers.get('nexttrack')!({ action: 'nexttrack' });
    expect(player.getSnapshot().index).toBe(1);
    handlers.get('pause')!({ action: 'pause' });
    expect(player.getSnapshot().status).toBe('paused');
  });
  it('works without Media Session and exports bounded diagnostics', () => {
    Object.defineProperty(navigator, 'mediaSession', {
      configurable: true,
      value: undefined,
    });
    const { audio, player } = setup();
    for (let i = 0; i < 30; i++) {
      player.play();
      audio.emit('loadeddata');
      audio.emit('playing');
      player.pause();
    }
    const data = JSON.parse(player.exportDiagnostics());
    expect(data.state.attempts).toHaveLength(20);
    expect(data.state.events.length).toBeLessThanOrEqual(100);
    expect(data.note).toContain('not network TTFB');
    expect(data.state.mediaSession).toBe(false);
  });
});
