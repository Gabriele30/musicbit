import { describe, expect, it } from 'vitest';
import type { ListeningEvent, Track } from '@musicbit/shared';
import { PlayerEngine } from './engine';
import { ListeningMeter } from './listening';
const track: Track = {
  id: 'abcdefghijk',
  title: 'Song',
  artist: 'Artist',
  album: 'Album',
  audioUrl: '/api/audio/abcdefghijk',
  artworkUrl: '/cover.png',
  mimeType: 'audio/mp4',
  sourceUrl: 'https://music.youtube.com/watch?v=abcdefghijk',
  permission: 'Playback',
  attribution: 'Artist',
  durationSeconds: 120,
};
describe('real listening measurement', () => {
  it('counts repeat-one passes separately while keeping ordinary pause/resume in the same listen', () => {
    const events: ListeningEvent[] = [],
      base = new PlayerEngine(document.createElement('audio')).getSnapshot();
    let now = 0;
    const meter = new ListeningMeter(
      (e) => events.push(e),
      () => now,
    );
    const state = {
      ...base,
      queue: [track],
      index: 0,
      position: 0,
      duration: 120,
      status: 'playing' as const,
    };
    meter.sample(state);
    now = 30000;
    meter.sample({ ...state, position: 30 });
    now = 120000;
    meter.sample({ ...state, position: 120 });
    meter.sample({
      ...state,
      status: 'loading',
      attempts: [
        {
          id: 2,
          trackId: track.id,
          title: track.title,
          trigger: 'ended',
          kind: 'resume',
          clickAt: now,
        },
      ],
    });
    meter.sample({
      ...state,
      attempts: [
        {
          id: 2,
          trackId: track.id,
          title: track.title,
          trigger: 'ended',
          kind: 'resume',
          clickAt: now,
        },
      ],
    });
    now += 30000;
    meter.sample({
      ...state,
      position: 30,
      attempts: [
        {
          id: 2,
          trackId: track.id,
          title: track.title,
          trigger: 'ended',
          kind: 'resume',
          clickAt: 120000,
        },
      ],
    });
    meter.flush();
    expect(events.reduce((n, e) => n + e.starts, 0)).toBe(2);
    expect(events.reduce((n, e) => n + e.seconds, 0)).toBe(150);
  });
  it('counts native progress, ignores seeks, and resumes without double-counting a qualified listen', () => {
    const events: ListeningEvent[] = [],
      base = new PlayerEngine(document.createElement('audio')).getSnapshot();
    let now = 0;
    const meter = new ListeningMeter(
      (e) => events.push(e),
      () => now,
    );
    const sample = (
      position: number,
      status: 'playing' | 'paused' = 'playing',
      elapsed = 1000,
      seeking = false,
    ) => {
      now += elapsed;
      meter.sample(
        { ...base, queue: [track], index: 0, position, duration: 120, status },
        seeking,
      );
    };
    sample(0);
    sample(15, 'playing', 15000);
    sample(30, 'playing', 15000);
    sample(100, 'playing', 1000, true);
    sample(101);
    sample(101, 'paused');
    sample(101, 'paused', 60000);
    sample(101);
    sample(111, 'playing', 10000);
    meter.flush();
    expect(events.reduce((n, e) => n + e.seconds, 0)).toBe(41);
    expect(events.reduce((n, e) => n + e.starts, 0)).toBe(1);
  });
  it('counts delayed background progress in bounded chunks without inventing skipped minutes', () => {
    const events: ListeningEvent[] = [],
      base = new PlayerEngine(document.createElement('audio')).getSnapshot();
    let now = 0;
    const meter = new ListeningMeter(
        (e) => events.push(e),
        () => now,
      ),
      state = {
        ...base,
        queue: [track],
        index: 0,
        position: 0,
        duration: 300,
        status: 'playing' as const,
      };
    meter.sample(state);
    now = 120000;
    meter.sample({ ...state, position: 120 });
    meter.flush();
    expect(events.reduce((n, e) => n + e.seconds, 0)).toBe(120);
    expect(events.every((e) => e.seconds <= 60)).toBe(true);
    now += 1000;
    meter.sample({ ...state, position: 240 });
    meter.flush();
    expect(events.reduce((n, e) => n + e.seconds, 0)).toBe(120);
  });
});
