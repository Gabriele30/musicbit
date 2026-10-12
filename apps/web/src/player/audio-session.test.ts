import { afterEach, describe, expect, it, vi } from 'vitest';
import { PlaybackAudioSession } from './audio-session';

afterEach(() => vi.unstubAllGlobals());

describe('platform playback session', () => {
  it('requests playback only on listening intent and keeps it across hidden track transitions', () => {
    const native = Object.assign(new EventTarget(), {
      type: 'auto',
      state: 'inactive',
    });
    vi.stubGlobal('navigator', { audioSession: native });
    const log = vi.fn();
    const session = new PlaybackAudioSession(log);
    expect(native.type).toBe('auto');
    session.activate();
    expect(native.type).toBe('playback');
    native.state = 'active';
    native.dispatchEvent(new Event('statechange'));
    expect(log).toHaveBeenLastCalledWith('audio-session:active');
    session.activate();
    expect(session.snapshot()).toEqual({ type: 'playback', state: 'active' });
    expect(
      log.mock.calls.filter(([event]) => event === 'audio-session:playback'),
    ).toHaveLength(1);
    session.destroy();
    expect(native.type).toBe('auto');
    log.mockClear();
    native.dispatchEvent(new Event('statechange'));
    expect(log).not.toHaveBeenCalled();
  });

  it('records interruptions without automatically fighting calls or other audio apps', () => {
    const native = Object.assign(new EventTarget(), {
      type: 'auto',
      state: 'active',
    });
    vi.stubGlobal('navigator', { audioSession: native });
    const log = vi.fn();
    const session = new PlaybackAudioSession(log);
    session.activate();
    native.state = 'interrupted';
    native.dispatchEvent(new Event('statechange'));
    expect(session.snapshot()?.state).toBe('interrupted');
    expect(log).toHaveBeenLastCalledWith('audio-session:interrupted');
    expect(native.type).toBe('playback');
    session.release();
    expect(native.type).toBe('auto');
    session.activate();
    expect(native.type).toBe('playback');
    session.destroy();
  });

  it('works with no API, a denied getter, or a rejected playback category', () => {
    for (const navigatorValue of [
      {},
      {
        get audioSession(): never {
          throw new Error('unsupported');
        },
      },
      {
        audioSession: Object.defineProperties(new EventTarget(), {
          type: {
            get: () => 'auto',
            set: () => {
              throw new Error('unsupported');
            },
          },
          state: { value: 'inactive' },
        }),
      },
    ]) {
      vi.stubGlobal('navigator', navigatorValue);
      const session = new PlaybackAudioSession(vi.fn());
      expect(() => session.activate()).not.toThrow();
      expect(() => session.destroy()).not.toThrow();
    }
  });
});
