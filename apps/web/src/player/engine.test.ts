import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Track } from '@musicbit/shared';
import { PlayerEngine } from './engine';
import { connectSessionPersistence, SESSION_KEY } from './session';

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
  currentSrc = '';
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
    this.ended = false;
    return Promise.resolve();
  });
  pause = vi.fn(() => {
    this.paused = true;
    this.dispatchEvent(new Event('pause'));
  });
  emit(name: string) {
    if (name === 'ended') this.ended = true;
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
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('persistent player', () => {
  it.each([0, 60])(
    'still recovers a native start/resume stuck away from %s seconds',
    async (position) => {
      vi.useFakeTimers();
      const { player, audio } = setup();
      player.resetSession();
      const track = {
        ...tracks[0]!,
        id: 'abcdefghijk',
        audioUrl: '/api/audio/abcdefghijk',
        durationSeconds: 120,
      };
      vi.stubGlobal(
        'fetch',
        vi.fn(
          async (url: string) =>
            new Response(
              JSON.stringify(
                url.endsWith('/info')
                  ? { durationSeconds: 120 }
                  : {
                      tracks: [
                        { index: 0, id: track.id, start: 0, duration: 120 },
                      ],
                      complete: false,
                    },
              ),
            ),
        ),
      );
      let clock = 119;
      Object.defineProperty(audio, 'currentTime', {
        get: () => clock,
        set: (value: number) => {
          if (audio.src === track.audioUrl) clock = value;
        },
        configurable: true,
      });
      Object.defineProperty(audio, 'seekable', {
        value: { length: 0 },
        configurable: true,
      });
      audio.duration = Infinity;
      audio.readyState = 4;
      player.restoreSession({
        queue: [track],
        index: 0,
        position,
        repeat: 'off',
      });
      player.setContinuousPlayback(true);
      player.play();
      await vi.advanceTimersByTimeAsync(0);
      audio.emit('loadedmetadata');
      audio.emit('playing');
      expect(player.getDelivery()).toBe('hls');
      await vi.advanceTimersByTimeAsync(2500);
      expect(audio.src).toBe(track.audioUrl);
      audio.duration = 120;
      audio.emit('loadedmetadata');
      audio.emit('playing');
      expect(clock).toBe(position);
      audio.emit('seeked');
      expect(player.getSnapshot().status).toBe('playing');
    },
  );
  it.each(['seeked', 'timeupdate'])(
    'does not acknowledge STUPIDO at metadata-only readiness on an early %s event',
    async (event) => {
      const { player, audio } = setup();
      const track = {
        ...tracks[0]!,
        id: 'zpRJGjYGtE0',
        title: 'STUPIDO',
        audioUrl: '/api/audio/zpRJGjYGtE0',
        durationSeconds: 188,
      };
      vi.stubGlobal(
        'fetch',
        vi.fn(
          async (url: string) =>
            new Response(
              JSON.stringify(
                url.endsWith('/info')
                  ? { durationSeconds: 188 }
                  : {
                      tracks: [
                        {
                          index: 0,
                          id: track.id,
                          start: 0,
                          duration: 187.431474,
                        },
                      ],
                      complete: false,
                    },
              ),
            ),
        ),
      );
      player.setContinuousPlayback(true);
      player.playCollection([track]);
      await new Promise((resolve) => setTimeout(resolve, 0));
      audio.readyState = 1;
      audio.emit('loadedmetadata');
      audio.currentTime = event === 'timeupdate' ? 0.2 : 0;
      audio.emit(event);
      // Safari can restore its old native song clock after metadata/seek events,
      // before the selected media has playable data. The start seek must survive.
      audio.currentTime = 184;
      audio.readyState = 4;
      audio.emit('playing');
      expect(audio.currentTime).toBe(0);
      audio.emit('seeked');
      audio.emit('playing');
      expect(player.getSnapshot()).toMatchObject({
        index: 0,
        position: 0,
        status: 'playing',
      });
    },
  );
  it('keeps prepared native audio usable when preparing a later queued song fails', async () => {
    const { player, audio } = setup();
    const queue = tracks.slice(0, 2).map((track, index) => ({
      ...track,
      id: String(index).padStart(11, '0'),
      audioUrl: `/api/audio/${String(index).padStart(11, '0')}`,
    }));
    const message = 'Il fornitore richiede una verifica di accesso dal server.';
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async (url: string) =>
          new Response(
            JSON.stringify(
              url.endsWith('/info')
                ? { durationSeconds: 120 }
                : {
                    tracks: [
                      { index: 0, id: queue[0]!.id, start: 0, duration: 120 },
                    ],
                    complete: false,
                    error: message,
                  },
            ),
          ),
      ),
    );
    player.setContinuousPlayback(true);
    player.playCollection(queue);
    await vi.waitFor(() =>
      expect(player.getSnapshot().radioNotice).toBe(message),
    );
    expect(player.getSnapshot().status).not.toBe('error');
    expect(audio.paused).toBe(false);
    audio.emit('loadedmetadata');
    audio.emit('playing');
    audio.currentTime = 10;
    audio.emit('timeupdate');
    expect(player.getSnapshot().status).toBe('playing');
    expect(player.getSnapshot().position).toBe(10);
    expect(player.getDelivery()).toBe('hls');
  });
  it.each([3, 4])(
    'recovers a rejected native HLS source (code %s) at the requested resume position',
    (code) => {
      const { player, audio } = setup();
      vi.stubGlobal(
        'fetch',
        vi.fn(
          async () =>
            new Response(JSON.stringify({ tracks: [], complete: false })),
        ),
      );
      const track = {
        ...tracks[0]!,
        id: 'abcdefghijk',
        audioUrl: '/api/audio/abcdefghijk',
      };
      player.resetSession();
      player.setContinuousPlayback(true);
      player.restoreSession({
        queue: [track],
        index: 0,
        position: 12,
        repeat: 'off',
        autoplay: false,
      });
      player.play();
      expect(audio.src).toContain('/api/continuous/');
      audio.paused = true;
      audio.error = { code };
      audio.emit('error');
      expect(player.audio).toBe(audio);
      expect(audio.src).toBe(track.audioUrl);
      expect(audio.paused).toBe(false);
      expect(player.getDelivery()).toBe('progressive');
      audio.error = null;
      audio.emit('loadedmetadata');
      audio.emit('playing');
      expect(audio.currentTime).toBe(12);
      // A failed AAC must surface normally, rather than starting an endless retry.
      audio.error = { code };
      audio.emit('error');
      expect(player.getSnapshot().status).toBe('error');
    },
  );
  it('recovers a native HLS NotSupportedError before the media error event arrives', async () => {
    const { player, audio } = setup();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ tracks: [], complete: false })),
      ),
    );
    audio.play.mockRejectedValueOnce(
      new DOMException('Unsupported HLS', 'NotSupportedError'),
    );
    player.setContinuousPlayback(true);
    player.playCollection([
      { ...tracks[0]!, id: 'abcdefghijk', audioUrl: '/api/audio/abcdefghijk' },
    ]);
    await vi.waitFor(() => expect(audio.src).toBe('/api/audio/abcdefghijk'));
    expect(player.getDelivery()).toBe('progressive');
    expect(audio.play).toHaveBeenCalledTimes(2);
    expect(player.getSnapshot().status).not.toBe('error');
  });
  it('looks up the provider failure for a native HLS source too', async () => {
    const { player, audio } = setup();
    const fetcher = vi.fn(
      async (url: string) =>
        new Response(
          JSON.stringify(
            url.endsWith('/info')
              ? { code: 'PROVIDER_RESTRICTED' }
              : { complete: false, tracks: [] },
          ),
          { status: url.endsWith('/info') ? 503 : 200 },
        ),
    );
    vi.stubGlobal('fetch', fetcher);
    player.setContinuousPlayback(true);
    player.playCollection([
      { ...tracks[0]!, id: 'abcdefghijk', audioUrl: '/api/audio/abcdefghijk' },
    ]);
    expect(audio.src).toContain('/api/continuous/');
    await vi.waitFor(() =>
      expect(
        fetcher.mock.calls.some(
          ([url]) => url === '/api/audio/abcdefghijk/info',
        ),
      ).toBe(true),
    );
    audio.error = { code: 2 };
    audio.emit('error');
    await vi.waitFor(() =>
      expect(player.getSnapshot().error).toContain(
        'verifica di accesso dal server',
      ),
    );
  });
  it('keeps the progressive radio notice through native progress and clears it when radio is disabled', () => {
    const { player, audio } = setup();
    player.playCollection(tracks);
    player.setRecommendations(
      tracks[0]!.id,
      [],
      'ready',
      'Ascolti già in cache',
    );
    audio.currentTime = 3;
    audio.emit('timeupdate');
    expect(player.getSnapshot().radioNotice).toBe('Ascolti già in cache');
    player.toggleAutoplay();
    expect(player.getSnapshot().radioNotice).toBeUndefined();
  });
  it('explains a provider restriction even when the native error arrives first, without leaking it to the next track', async () => {
    const { player, audio } = setup();
    const queue = tracks.map((track, index) => ({
      ...track,
      id: String(index).padStart(11, '0'),
      audioUrl: `/api/audio/${String(index).padStart(11, '0')}`,
    }));
    let finish!: (response: Response) => void;
    const pending = new Promise<Response>((resolve) => {
      finish = resolve;
    });
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        url === `${queue[0]!.audioUrl}/info`
          ? pending
          : Promise.resolve(
              new Response(JSON.stringify({ durationSeconds: 120 })),
            ),
      ),
    );
    player.playCollection(queue);
    audio.error = { code: 2 };
    audio.emit('error');
    finish(
      new Response(JSON.stringify({ code: 'PROVIDER_RESTRICTED' }), {
        status: 503,
      }),
    );
    await vi.waitFor(() =>
      expect(player.getSnapshot().error).toContain(
        'Questo brano non è in cache',
      ),
    );
    expect(player.getSnapshot().attempts[0]?.error).toContain(
      'verifica di accesso',
    );
    audio.error = null;
    player.next();
    audio.error = { code: 2 };
    audio.emit('error');
    expect(player.getSnapshot().error).not.toContain('verifica di accesso');
  });
  it('does not interrupt progressing audio when the optional metadata lookup is restricted', async () => {
    const { player, audio } = setup();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ code: 'PROVIDER_RESTRICTED' }), {
            status: 503,
          }),
      ),
    );
    player.playCollection([
      { ...tracks[0]!, id: 'abcdefghijk', audioUrl: '/api/audio/abcdefghijk' },
    ]);
    audio.emit('playing');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(player.getSnapshot().status).toBe('playing');
    expect(player.getSnapshot().error).toBeNull();
    expect(audio.paused).toBe(false);
    audio.error = { code: 2 };
    audio.emit('error');
    expect(player.getSnapshot().error).toContain('verifica di accesso');
  });
  it('keeps healthy native live playback until an unsupported explicit seek needs AAC recovery', async () => {
    vi.useFakeTimers();
    const { player, audio } = setup();
    const queue = tracks.map((track, index) => ({
      ...track,
      id: String(index).padStart(11, '0'),
      audioUrl: `/api/audio/${String(index).padStart(11, '0')}`,
    }));
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              complete: false,
              tracks: queue.map((track, index) => ({
                index,
                id: track.id,
                start: index * 120,
                duration: 120,
              })),
            }),
            { headers: { 'Content-Type': 'application/json' } },
          ),
      ),
    );
    Object.defineProperty(audio, 'seekable', {
      value: { length: 0 },
      configurable: true,
    });
    audio.duration = Infinity;
    audio.readyState = 4;
    player.setContinuousPlayback(true);
    player.playCollection(queue);
    await vi.advanceTimersByTimeAsync(0);
    audio.emit('loadedmetadata');
    audio.emit('playing');
    audio.currentTime = 2;
    audio.emit('timeupdate');
    await vi.advanceTimersByTimeAsync(2500);
    expect(player.audio).toBe(audio);
    expect(player.getDelivery()).toBe('hls');
    expect(audio.src).toContain('/api/continuous/');
    audio.currentTime = 128;
    audio.emit('timeupdate');
    expect(player.getSnapshot()).toMatchObject({
      index: 1,
      position: 8,
      status: 'playing',
    });
    player.seek(20);
    expect(audio.src).toBe(queue[1]!.audioUrl);
    expect(player.getDelivery()).toBe('progressive');
    audio.duration = 120;
    audio.emit('loadedmetadata');
    audio.emit('playing');
    expect(audio.currentTime).toBe(20);
    player.setContinuousPlayback(true);
    player.next();
    expect(audio.src).toBe(queue[2]!.audioUrl);
    expect(player.getSnapshot().status).not.toBe('error');
  });
  it('changes native speed without reloading audio and resets it between accounts', () => {
    const { player, audio } = setup();
    player.setPlaybackRate(1.5);
    expect(audio.playbackRate).toBe(1.5);
    expect(player.getSnapshot().playbackRate).toBe(1.5);
    const loads = audio.load.mock.calls.length;
    for (const rate of [NaN, Infinity, -1, 0, 3]) player.setPlaybackRate(rate);
    expect(audio.playbackRate).toBe(1.5);
    expect(audio.load).toHaveBeenCalledTimes(loads);
    player.resetSession();
    expect(audio.playbackRate).toBe(1);
  });
  it('shows a provider restriction before waiting indefinitely for native metadata', async () => {
    const { player, audio } = setup();
    const queue = [
      { ...tracks[0]!, id: 'abcdefghijk', audioUrl: '/api/audio/abcdefghijk' },
    ];
    const message = 'Il fornitore richiede una verifica di accesso dal server.';
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ tracks: [], complete: false, error: message }),
          ),
      ),
    );
    player.setContinuousPlayback(true);
    player.playCollection(queue);
    await vi.waitFor(() => expect(player.getSnapshot().status).toBe('error'));
    expect(player.getSnapshot().error).toBe(message);
    expect(audio.pause).toHaveBeenCalled();
  });
  it('keeps one native HLS source across track boundaries, maps local positions and preserves pause/resume and skips', async () => {
    const { player, audio } = setup();
    const queue = tracks.map((track, index) => ({
      ...track,
      id: String(index).padStart(11, '0'),
      audioUrl: `/api/audio/${String(index).padStart(11, '0')}`,
    }));
    const timeline = {
      complete: true,
      tracks: queue.map((track, index) => ({
        index,
        id: track.id,
        start: index * 5,
        duration: 5,
      })),
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_source: string, options: RequestInit) => {
        if (options.method === 'POST') expect(audio.play).toHaveBeenCalled();
        return new Response(JSON.stringify(timeline), {
          headers: { 'Content-Type': 'application/json' },
        });
      }),
    );
    player.setContinuousPlayback(true);
    player.playCollection(queue);
    const source = audio.src;
    expect(source).toMatch(/^\/api\/continuous\/[a-f0-9-]{36}\/index.m3u8$/);
    expect(audio.play).toHaveBeenCalledOnce();
    audio.emit('loadedmetadata');
    audio.emit('playing');
    await vi.waitFor(() => expect(player.getSnapshot().duration).toBe(5));
    audio.emit('playing');
    audio.currentTime = 5.25;
    audio.emit('timeupdate');
    expect(player.getSnapshot()).toMatchObject({
      index: 1,
      position: 0.25,
      duration: 5,
    });
    expect(audio.src).toBe(source);
    expect(audio.play).toHaveBeenCalledOnce();
    expect(audio.load).not.toHaveBeenCalled();
    player.cycleRepeat();
    player.cycleRepeat();
    audio.currentTime = 4.9;
    audio.emit('timeupdate');
    expect(player.getSnapshot().index).toBe(1);
    expect(audio.currentTime).toBe(4.9);
    player.cycleRepeat();
    audio.currentTime = 5.25;
    audio.emit('timeupdate');
    player.pause();
    player.play();
    expect(audio.currentTime).toBe(5.25);
    audio.emit('playing');
    player.next('media-session');
    expect(audio.currentTime).toBe(10);
    expect(audio.src).toBe(source);
    audio.currentTime = 10.25;
    audio.emit('playing');
    audio.emit('timeupdate');
    player.previous('media-session');
    expect(audio.currentTime).toBe(5);
    expect(audio.src).toBe(source);
    audio.emit('playing');
    player.seek(2);
    expect(audio.currentTime).toBe(7);
    expect(player.getSnapshot().position).toBe(2);
    expect(player.getDelivery()).toBe('hls');
    // Returning to a previously heard track starts at its beginning; only
    // the explicit pause/play path keeps the current position.
    player.select(0);
    expect(audio.currentTime).toBe(0);
    audio.emit('playing');
    audio.currentTime = 2;
    audio.emit('timeupdate');
    player.select(1);
    audio.readyState = 4;
    audio.emit('seeked');
    expect(player.getSnapshot().status).toBe('playing');
    player.select(0);
    expect(audio.currentTime).toBe(0);
    audio.emit('playing');
    audio.currentTime = 2;
    audio.emit('timeupdate');
    player.select(0);
    expect(audio.currentTime).toBe(0);
    audio.emit('playing');
    audio.currentTime = 2;
    audio.emit('timeupdate');
    player.moveUpcoming(1, 1);
    expect(player.getSnapshot().position).toBe(2);
    audio.emit('loadedmetadata');
    expect(audio.currentTime).toBe(2);
  });
  it('ignores the previous HLS clock until a manual selection has finished seeking', async () => {
    const { player, audio } = setup();
    const queue = tracks.map((track, index) => ({
      ...track,
      id: String(index).padStart(11, '0'),
      audioUrl: `/api/audio/${String(index).padStart(11, '0')}`,
    }));
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              complete: true,
              tracks: queue.map((track, index) => ({
                index,
                id: track.id,
                start: index * 120,
                duration: 120,
              })),
            }),
          ),
      ),
    );
    player.setContinuousPlayback(true);
    player.playCollection(queue);
    audio.emit('loadedmetadata');
    audio.emit('playing');
    await vi.waitFor(() => expect(player.getSnapshot().duration).toBe(120));
    await vi.waitFor(() => {
      player.seek(119);
      expect(player.getSnapshot().position).toBe(119);
    });
    audio.emit('playing');
    let clock = 119;
    let requested = 119;
    Object.defineProperty(audio, 'currentTime', {
      configurable: true,
      get: () => clock,
      set: (value: number) => {
        requested = value;
      },
    });
    player.select(1);
    expect(requested).toBe(120);
    audio.emit('timeupdate');
    audio.emit('ended');
    expect(player.getSnapshot()).toMatchObject({ index: 1, position: 0 });
    clock = 120;
    audio.emit('timeupdate');
    expect(player.getSnapshot()).toMatchObject({ index: 1, position: 0 });
    // A different collection gets a new source, even if WebKit retains the old clock.
    clock = 359;
    player.playCollection([queue[1]!]);
    audio.emit('durationchange');
    expect(player.getSnapshot()).toMatchObject({ index: 0, position: 0 });
    audio.emit('loadedmetadata');
    expect(requested).toBe(0);
    // WebKit can restore its cached song position after loadedmetadata.
    clock = 60;
    requested = 60;
    audio.emit('canplay');
    expect(requested).toBe(60);
    requested = 60;
    audio.emit('playing');
    expect(requested).toBe(0);
    audio.emit('timeupdate');
    expect(player.getSnapshot()).toMatchObject({ index: 0, position: 0 });
    clock = 0;
    audio.emit('playing');
    expect(player.getSnapshot()).toMatchObject({ index: 0, position: 0 });
    requested = 99;
    clock = 2;
    audio.emit('waiting');
    audio.emit('canplay');
    audio.emit('playing');
    expect(requested).toBe(99);
  });
  it('never replays an acknowledged start seek when HLS timeline metadata arrives late', async () => {
    const { player, audio } = setup();
    const queue = tracks.map((track, index) => ({
      ...track,
      id: String(index).padStart(11, '0'),
      audioUrl: `/api/audio/${String(index).padStart(11, '0')}`,
    }));
    let deliver!: (response: Response) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn((_: string, options: RequestInit) =>
        options.method === 'POST'
          ? new Promise<Response>((resolve) => {
              deliver = resolve;
            })
          : Promise.resolve(new Response('{}')),
      ),
    );
    player.setContinuousPlayback(true);
    player.playCollection(queue);
    audio.emit('loadedmetadata');
    audio.emit('playing');
    audio.currentTime = 2.5;
    audio.emit('timeupdate');
    audio.emit('waiting');
    audio.emit('canplay');
    audio.emit('playing');
    expect(audio.currentTime).toBe(2.5);
    deliver(
      new Response(
        JSON.stringify({
          complete: true,
          tracks: queue.map((track, index) => ({
            index,
            id: track.id,
            start: index * 120,
            duration: 120,
          })),
        }),
      ),
    );
    await vi.waitFor(() => expect(player.getSnapshot().position).toBe(2.5));
    audio.emit('waiting');
    audio.emit('canplay');
    audio.emit('playing');
    expect(audio.currentTime).toBe(2.5);
    expect(player.getSnapshot().index).toBe(0);
  });
  it('resets cached progressive positions on A to B to A and only resumes after pause', () => {
    const { player, audio } = setup();
    audio.readyState = 4;
    player.select(0);
    audio.emit('loadedmetadata');
    audio.emit('playing');
    audio.currentTime = 60;
    audio.emit('timeupdate');
    player.select(1);
    audio.emit('loadedmetadata');
    audio.currentTime = 60;
    audio.emit('playing');
    expect(audio.currentTime).toBe(0);
    audio.emit('seeked');
    audio.currentTime = 10;
    audio.emit('timeupdate');
    player.select(0);
    audio.emit('loadedmetadata');
    audio.currentTime = 60;
    audio.emit('playing');
    expect(audio.currentTime).toBe(0);
    audio.emit('seeked');
    audio.currentTime = 15;
    audio.emit('timeupdate');
    player.pause();
    player.play();
    audio.emit('playing');
    expect(audio.currentTime).toBe(15);
  });
  it('cancels pending CarPlay skips synchronously and ignores stale source events and rejections', async () => {
    const handlers = new Map<string, MediaSessionActionHandler>();
    const session = {
      metadata: null,
      playbackState: 'none',
      setPositionState: vi.fn(),
      setActionHandler: vi.fn((action, handler) =>
        handlers.set(action, handler),
      ),
    };
    Object.defineProperty(navigator, 'mediaSession', {
      configurable: true,
      value: session,
    });
    const { player, audio } = setup();
    const rejections: ((reason: unknown) => void)[] = [];
    audio.play.mockImplementation(() => {
      audio.paused = false;
      return new Promise<void>((_resolve, reject) => rejections.push(reject));
    });
    player.play();
    audio.currentSrc = tracks[0]!.audioUrl;
    handlers.get('nexttrack')!({ action: 'nexttrack' });
    handlers.get('nexttrack')!({ action: 'nexttrack' });
    expect(player.getSnapshot().index).toBe(2);
    expect(audio.src).toBe(tracks[2]!.audioUrl);
    expect(audio.play).toHaveBeenCalledTimes(3);
    expect(audio.pause).toHaveBeenCalledTimes(2);
    expect(audio.load).not.toHaveBeenCalled();
    audio.emit('playing');
    audio.error = { code: 2 };
    audio.emit('error');
    expect(player.getSnapshot().status).toBe('loading');
    expect(player.getSnapshot().error).toBeNull();
    rejections[0]!(new DOMException('Superseded', 'AbortError'));
    rejections[1]!(new DOMException('Superseded', 'AbortError'));
    await Promise.resolve();
    expect(player.getSnapshot().error).toBeNull();
    audio.error = null;
    audio.currentSrc = tracks[2]!.audioUrl;
    audio.currentTime = 0;
    audio.emit('playing');
    audio.emit('pause');
    audio.emit('error');
    expect(player.getSnapshot().status).toBe('playing');
    expect(session.playbackState).toBe('paused');
    audio.currentTime = 0.25;
    audio.emit('timeupdate');
    expect(session.playbackState).toBe('playing');
  });
  it('allows a cold proxied stream to start beyond the old 15-second client deadline', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ durationSeconds: 188 })),
        ),
    );
    const { player, audio } = setup();
    player.playCollection([
      { ...tracks[0]!, audioUrl: '/api/audio/olqW16cSEVs' },
    ]);
    await vi.advanceTimersByTimeAsync(20000);
    expect(player.getSnapshot().status).toBe('loading');
    expect(player.getSnapshot().error).toBeNull();
    audio.emit('playing');
    await vi.advanceTimersByTimeAsync(60000);
    expect(player.getSnapshot().status).toBe('playing');
  });
  it('starts an unheard prefetched successor synchronously while hidden using the same native HTTP pipeline', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.endsWith('/info')
          ? new Response(JSON.stringify({ durationSeconds: 120 }))
          : new Response(new Uint8Array([1, 2, 3]), {
              status: 206,
              headers: {
                'Content-Type': 'audio/mp4',
                'X-MusicBit-Audio-Cache': 'warming',
                'Content-Length': '3',
                'Content-Range': 'bytes 0-2/3',
              },
            }),
      ),
    );
    const { player, audio } = setup();
    player.playCollection([
      tracks[0]!,
      { ...tracks[1]!, audioUrl: '/api/audio/aaaaaaaaaaa' },
    ]);
    audio.emit('playing');
    await vi.waitFor(() =>
      expect(
        player.getSnapshot().events.some((e) => e.event === 'upcoming:ready'),
      ).toBe(true),
    );
    expect(audio.src).toBe(tracks[0]!.audioUrl);
    const visibility = vi
      .spyOn(document, 'visibilityState', 'get')
      .mockReturnValue('hidden');
    try {
      audio.emit('ended');
      expect(audio.src).toBe('/api/audio/aaaaaaaaaaa');
      expect(audio.play).toHaveBeenCalledTimes(2);
      expect(player.getSnapshot().index).toBe(1);
      expect(player.getSnapshot().attempts.at(-1)?.kind).toBe('prepared');
    } finally {
      visibility.mockRestore();
    }
  });
  it('recovers a missing feed duration after synchronous play and skips the doubled silent tail', async () => {
    let resolve!: (value: Response) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((done) => {
            resolve = done;
          }),
      ),
    );
    const { audio, player } = setup();
    player.playCollection([
      { ...tracks[0]!, audioUrl: '/api/audio/olqW16cSEVs' },
      tracks[1]!,
    ]);
    expect(audio.play).toHaveBeenCalledOnce();
    audio.duration = 376;
    audio.emit('playing');
    resolve(new Response(JSON.stringify({ durationSeconds: 188 })));
    await vi.waitFor(() => expect(player.getSnapshot().duration).toBe(188));
    audio.currentTime = 187.9;
    audio.emit('timeupdate');
    expect(player.getSnapshot().index).toBe(0);
    audio.currentTime = 189;
    audio.emit('timeupdate');
    expect(player.getSnapshot().index).toBe(1);
  });
  it('persists playlists larger than 500 tracks and rejects queue overflow without interrupting audio', () => {
    const { player, audio } = setup();
    const queue = Array.from({ length: 1000 }, (_, i) => ({
      ...tracks[0]!,
      id: `saved-${i}`,
    }));
    const disconnect = connectSessionPersistence(player);
    player.playCollection(queue, 611);
    audio.emit('playing');
    expect(player.enqueue(tracks[1]!)).toBe(false);
    expect(player.getSnapshot().status).toBe('playing');
    disconnect();
    const restoredAudio = new FakeAudio(),
      restored = new PlayerEngine(restoredAudio as unknown as HTMLAudioElement);
    engines.push(restored);
    const stop = connectSessionPersistence(restored);
    expect(restored.getSnapshot()).toMatchObject({
      index: 611,
      status: 'paused',
    });
    expect(restored.getSnapshot().queue).toHaveLength(1000);
    expect(restoredAudio.play).not.toHaveBeenCalled();
    stop();
  });
  it('starts radio synchronously and recovers when recommendations arrive after the track ended', () => {
    const { player, audio } = setup();
    player.toggleAutoplay();
    player.cycleRepeat();
    player.startRadio([tracks[0]!]);
    expect(audio.play).toHaveBeenCalledTimes(1);
    expect(player.getSnapshot()).toMatchObject({
      autoplay: true,
      repeat: 'off',
    });
    audio.emit('playing');
    audio.currentTime = 120;
    audio.emit('ended');
    expect(player.getSnapshot().status).toBe('ended');
    player.setRecommendations(tracks[0]!.id, [tracks[1]!]);
    expect(player.getSnapshot().queue[player.getSnapshot().index]?.id).toBe(
      tracks[1]!.id,
    );
    expect(audio.play).toHaveBeenCalledTimes(2);
  });
  it('keeps long-running radio queues within the persistence limit without losing the new current track', () => {
    const { player, audio } = setup();
    const queue = Array.from({ length: 500 }, (_, i) => ({
      ...tracks[0]!,
      id: `radio-${i}`,
      audioUrl: `https://example.com/radio-${i}.mp3`,
    }));
    player.playCollection(queue, 499);
    audio.emit('playing');
    player.setRecommendations(queue[499]!.id, [tracks[1]!]);
    audio.currentTime = 120;
    audio.emit('ended');
    expect(player.getSnapshot().queue).toHaveLength(201);
    expect(player.getSnapshot().queue[player.getSnapshot().index]?.id).toBe(
      tracks[1]!.id,
    );
  });
  it('isolates account sessions while keeping the same audio and restoring without autoplay', () => {
    const { audio, player } = setup();
    player.playCollection(tracks, 1);
    audio.currentTime = 42;
    audio.emit('timeupdate');
    const disconnect = connectSessionPersistence(
      player,
      localStorage,
      'account-a',
    );
    disconnect();
    player.resetSession();
    expect(player.audio).toBe(audio);
    expect(player.getSnapshot().queue).toEqual([]);
    expect(audio.paused).toBe(true);
    const b = connectSessionPersistence(player, localStorage, 'account-b');
    expect(player.getSnapshot().queue).toEqual([]);
    b();
    connectSessionPersistence(player, localStorage, 'account-a')();
    expect(player.getSnapshot().queue).toEqual(tracks);
    expect(player.getSnapshot().status).toBe('paused');
    expect(audio.play).toHaveBeenCalledOnce();
  });
  it('starts a collection at the selected track while preserving previous tracks and the user gesture', () => {
    const { audio, player } = setup();
    player.playCollection(tracks, 1);
    expect(audio.play).toHaveBeenCalledOnce();
    expect(audio.src).toBe(tracks[1]!.audioUrl);
    expect(player.getSnapshot().queue).toEqual(tracks);
    expect(player.getSnapshot().index).toBe(1);
    player.previous();
    expect(audio.src).toBe(tracks[0]!.audioUrl);
  });
  it('corrects doubled proxy durations without cutting the end, then stops the silent tail', () => {
    const { audio, player } = setup();
    player.playCollection([
      {
        ...tracks[0]!,
        audioUrl: '/api/audio/abcdefghijk',
        durationSeconds: 180,
      },
    ]);
    audio.duration = 360;
    audio.emit('playing');
    audio.currentTime = 179.9;
    audio.emit('timeupdate');
    expect(player.getSnapshot()).toMatchObject({
      status: 'playing',
      duration: 180,
    });
    expect(audio.play).toHaveBeenCalledOnce();
    audio.currentTime = 181;
    audio.emit('timeupdate');
    expect(player.getSnapshot()).toMatchObject({
      status: 'ended',
      position: 180,
    });
    expect(audio.paused).toBe(true);
    player.play();
    expect(audio.currentTime).toBe(0);
  });
  it('advances beyond a doubled silent tail to the next queued song', () => {
    const { audio, player } = setup();
    player.playCollection([
      {
        ...tracks[0]!,
        audioUrl: '/api/audio/abcdefghijk',
        durationSeconds: 180,
      },
      tracks[1]!,
    ]);
    audio.duration = 360;
    audio.emit('playing');
    audio.currentTime = 181;
    audio.emit('timeupdate');
    expect(player.getSnapshot().index).toBe(1);
    expect(audio.play).toHaveBeenCalledTimes(2);
  });
  it('uses staged recommendations after explicit queue entries, respecting the autoplay switch', () => {
    const { audio, player } = setup();
    player.playCollection(tracks.slice(0, 2));
    player.setRecommendations(tracks[0]!.id, [tracks[2]!]);
    audio.emit('playing');
    audio.emit('ended');
    expect(player.getSnapshot().index).toBe(1);
    player.setRecommendations(tracks[0]!.id, [tracks[2]!]);
    expect(player.getSnapshot().autoplayTracks).toEqual([]);
    player.setRecommendations(tracks[1]!.id, [
      tracks[0]!,
      tracks[2]!,
      tracks[2]!,
    ]);
    expect(player.getSnapshot().autoplayTracks).toEqual([tracks[2]]);
    audio.emit('playing');
    audio.emit('ended');
    expect(player.getSnapshot().queue.at(-1)?.id).toBe(tracks[2]!.id);
    expect(player.getSnapshot().index).toBe(2);
    player.setRecommendations(tracks[2]!.id, [
      { ...tracks[0]!, id: 'new-song' },
    ]);
    player.toggleAutoplay();
    audio.emit('playing');
    audio.emit('ended');
    expect(player.getSnapshot().status).toBe('ended');
    expect(audio.play).toHaveBeenCalledTimes(3);
  });
  it('plays the complete native duration even when catalog metadata is shorter', () => {
    const { audio, player } = setup();
    player.enqueue({ ...tracks[0]!, durationSeconds: 60 });
    player.select(3);
    audio.emit('playing');
    audio.currentTime = 119.75;
    audio.emit('timeupdate');
    expect(player.getSnapshot()).toMatchObject({
      index: 3,
      status: 'playing',
      duration: 120,
    });
    expect(audio.play).toHaveBeenCalledOnce();
    audio.emit('ended');
    expect(player.getSnapshot().status).toBe('ended');
  });
  it('repeats a brano, allows manual next, and wraps the entire queue', () => {
    const { audio, player } = setup();
    player.cycleRepeat();
    player.select(2);
    audio.emit('playing');
    audio.emit('ended');
    expect(player.getSnapshot().index).toBe(0);
    player.cycleRepeat();
    audio.currentTime = 120;
    audio.emit('playing');
    audio.emit('ended');
    expect(player.getSnapshot().index).toBe(0);
    expect(audio.currentTime).toBe(0);
    player.next();
    expect(player.getSnapshot().index).toBe(1);
    player.cycleRepeat();
    player.select(2);
    audio.emit('playing');
    audio.emit('ended');
    expect(player.getSnapshot().status).toBe('ended');
  });
  it('shuffles only upcoming tracks without interrupting the selected source', () => {
    const { audio, player } = setup();
    player.enqueue(tracks[0]!);
    player.select(1);
    const random = vi
      .spyOn(crypto, 'getRandomValues')
      .mockReturnValue(new Uint32Array([0]));
    player.shuffleUpcoming();
    random.mockRestore();
    expect(player.getSnapshot().queue.map((track) => track.id)).toEqual([
      'track-1',
      'track-2',
      'track-1',
      'track-3',
    ]);
    expect(audio.src).toBe(tracks[1]!.audioUrl);
    expect(audio.load).not.toHaveBeenCalled();
  });
  it('restores duplicate queue entries, repeat and position without autoplay or preload', () => {
    localStorage.setItem(
      SESSION_KEY,
      JSON.stringify({
        version: 1,
        queue: [tracks[0], tracks[0]],
        index: 1,
        position: 37,
        repeat: 'all',
      }),
    );
    const audio = new FakeAudio();
    const player = new PlayerEngine(audio as unknown as HTMLAudioElement);
    engines.push(player);
    const disconnect = connectSessionPersistence(player);
    expect(player.getSnapshot()).toMatchObject({
      index: 1,
      position: 37,
      repeat: 'all',
      status: 'paused',
    });
    expect(audio.load).not.toHaveBeenCalled();
    expect(audio.play).not.toHaveBeenCalled();
    player.setCatalog(tracks);
    expect(player.getSnapshot().queue).toHaveLength(2);
    player.play();
    expect(audio.play).toHaveBeenCalledOnce();
    audio.emit('loadedmetadata');
    expect(audio.currentTime).toBe(37);
    player.pause();
    expect(JSON.parse(localStorage.getItem(SESSION_KEY)!).position).toBe(37);
    disconnect();
  });
  it('ignores corrupt sessions and keeps playback usable when storage is blocked', () => {
    localStorage.setItem(SESSION_KEY, '{broken');
    const { audio, player } = setup();
    const disconnect = connectSessionPersistence(player);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    player.play();
    expect(audio.play).toHaveBeenCalledOnce();
    disconnect();
  });
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
    const { audio, player, tick } = setup();
    player.play();
    audio.currentTime = 10;
    audio.readyState = 4;
    tick(15000);
    vi.advanceTimersByTime(15000);
    expect(player.getSnapshot().error).toBeNull();
    expect(player.getSnapshot().status).toBe('playing');
    expect(player.getSnapshot().attempts.at(-1)?.playingAt).toBeUndefined();
    expect(player.getSnapshot().events.at(-1)?.event).toBe(
      'deadline:native-progress',
    );
    // Actual native clock progress also proves playback began when the
    // playing event itself was delayed; ended must still advance the queue.
    audio.emit('ended');
    expect(player.getSnapshot().index).toBe(1);
    expect(player.getSnapshot().error).toBeNull();
  });
  it('keeps recovery armed when the native decoder rejects the initial seek', () => {
    vi.useFakeTimers();
    const { audio, player } = setup();
    Object.defineProperty(audio, 'currentTime', {
      configurable: true,
      get: () => 60,
      set: vi.fn(),
    });
    player.play();
    audio.readyState = 4;
    audio.emit('loadedmetadata');
    audio.emit('playing');
    audio.emit('playing');
    expect(player.getSnapshot().status).toBe('loading');
    vi.advanceTimersByTime(15000);
    expect(player.getSnapshot().status).toBe('error');
    expect(player.getSnapshot().error).toContain('Timeout audio');
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
    expect(audio.load).not.toHaveBeenCalled();
    expect(player.getSnapshot().attempts.at(-1)?.kind).toBe('load');
    expect(player.getSnapshot().position).toBe(0);
  });
  it('does not preload before intent and calls play synchronously without reloading the lifetime element', () => {
    const { audio, player } = setup();
    expect(audio.preload).toBe('none');
    expect(audio.load).not.toHaveBeenCalled();
    player.play();
    expect(audio.play).toHaveBeenCalledOnce();
    expect(audio.preload).toBe('auto');
    player.next();
    expect(player.audio).toBe(audio);
    expect(audio.src).toBe(tracks[1]!.audioUrl);
    player.previous();
    expect(audio.src).toBe(tracks[0]!.audioUrl);
    expect(audio.load).not.toHaveBeenCalled();
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
    expect(audio.load).not.toHaveBeenCalled();
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
    audio.emit('playing');
    audio.emit('ended');
    expect(player.getSnapshot().index).toBe(1);
    expect(player.getSnapshot().attempts.at(-1)?.trigger).toBe('ended');
    audio.emit('playing');
    audio.emit('ended');
    audio.emit('playing');
    audio.emit('ended');
    expect(player.getSnapshot().status).toBe('ended');
    expect(player.getSnapshot().index).toBe(2);
    expect(audio.play).toHaveBeenCalledTimes(3);
  });
  it('does not skip the whole queue when a decoder jumps to EOS without playing', () => {
    const { audio, player } = setup();
    player.play();
    audio.currentTime = 120;
    audio.emit('ended');
    expect(player.getSnapshot()).toMatchObject({ index: 0, status: 'error' });
    expect(player.getSnapshot().error).toContain('prima di avviare');
    expect(audio.play).toHaveBeenCalledOnce();
  });
  it('restarts the current track on previous after three seconds and clamps seeking', () => {
    const { audio, player } = setup();
    player.next();
    audio.emit('loadedmetadata');
    audio.emit('playing');
    audio.currentTime = 10;
    audio.emit('timeupdate');
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
    // Only explicit cancellation tears down the native resource with load().
    expect(audio.load).toHaveBeenCalledOnce();
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
    expect(session.playbackState).toBe('paused');
    audio.currentTime = 0.25;
    audio.emit('timeupdate');
    expect(session.playbackState).toBe('playing');
    audio.currentTime = 119;
    audio.emit('timeupdate');
    handlers.get('nexttrack')!({ action: 'nexttrack' });
    expect(player.getSnapshot().index).toBe(1);
    expect(session.playbackState).toBe('paused');
    expect(session.setPositionState).toHaveBeenLastCalledWith();
    audio.emit('loadedmetadata');
    audio.emit('durationchange');
    audio.emit('timeupdate');
    expect(session.playbackState).toBe('paused');
    expect(session.setPositionState).toHaveBeenLastCalledWith();
    audio.currentTime = 0;
    audio.emit('playing');
    expect(session.playbackState).toBe('paused');
    expect(session.setPositionState).toHaveBeenLastCalledWith();
    audio.currentTime = 0.25;
    audio.emit('timeupdate');
    expect(session.playbackState).toBe('playing');
    audio.emit('waiting');
    expect(session.playbackState).toBe('paused');
    handlers.get('pause')!({ action: 'pause' });
    expect(player.getSnapshot().status).toBe('paused');
    player.cycleRepeat();
    player.cycleRepeat();
    player.play();
    audio.emit('playing');
    audio.currentTime = 120;
    audio.emit('ended');
    expect(audio.currentTime).toBe(0);
    audio.emit('playing');
    expect(session.playbackState).toBe('paused');
    audio.currentTime = 0.25;
    audio.emit('timeupdate');
    expect(session.playbackState).toBe('playing');
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
