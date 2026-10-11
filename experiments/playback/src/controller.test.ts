import { afterEach, expect, it, vi } from 'vitest';
import type { PlaybackSource } from '@musicbit/shared';
import { LabPlayer } from './controller';

const source: PlaybackSource = {
  provider: 'test',
  reference: { catalogProvider: 'soundhelix-demo', catalogId: 'soundhelix-1' },
  url: '/test.wav',
  mimeType: 'audio/wav',
  delivery: 'progressive',
  title: 'Original tone',
  artist: 'MusicBit',
  validUntil: null,
  authorization: {
    sourceUrl: 'https://example.com',
    permission: 'Original',
    attribution: 'MusicBit',
  },
};
let player: LabPlayer;
function setup() {
  const audio = document.createElement('audio');
  vi.spyOn(audio, 'load').mockImplementation(() => {});
  vi.spyOn(audio, 'pause').mockImplementation(() => {});
  vi.spyOn(audio, 'play').mockResolvedValue(undefined);
  vi.spyOn(audio, 'canPlayType').mockReturnValue('probably');
  player = new LabPlayer(audio);
  return audio;
}
afterEach(() => {
  player?.dispose();
  vi.useRealTimers();
});
it('preserves the native media error when play rejects before the error event', async () => {
  const audio = setup();
  Object.defineProperty(audio, 'error', {
    configurable: true,
    value: { code: 4 },
  });
  vi.mocked(audio.play).mockRejectedValueOnce(
    new DOMException('unsupported', 'NotSupportedError'),
  );
  player.play(source);
  await Promise.resolve();
  expect(player.error).toBe('MEDIA_4');
  expect(player.attempts.at(-1)?.error).toBe('MEDIA_4');
});
it('calls play synchronously and reuses one audio and prepared src without load', () => {
  const audio = setup();
  player.prepare(source);
  expect(audio.play).not.toHaveBeenCalled();
  audio.dispatchEvent(new Event('canplay'));
  const calls = vi.mocked(audio.load).mock.calls.length;
  player.play(source);
  expect(audio.play).toHaveBeenCalledTimes(1);
  expect(audio.load).toHaveBeenCalledTimes(calls);
  audio.dispatchEvent(new Event('playing'));
  expect(player.attempts.at(-1)).toMatchObject({
    kind: 'prepared',
    playingAt: expect.any(Number),
  });
});
it('staging next descriptor does not touch current media; transition uses the same audio', () => {
  const audio = setup();
  player.play(source);
  const calls = vi.mocked(audio.load).mock.calls.length;
  player.stage({
    ...source,
    url: '/next.wav',
    reference: { ...source.reference, catalogId: 'soundhelix-2' },
  });
  expect(audio.load).toHaveBeenCalledTimes(calls);
  expect(audio.getAttribute('src')).toBe('/test.wav');
  audio.dispatchEvent(new Event('ended'));
  expect(audio.getAttribute('src')).toBe('/next.wav');
  expect(audio.play).toHaveBeenCalledTimes(2);
  expect(player.attempts.at(-1)?.kind).toBe('ended');
});
it('ignores a superseded rejection and records native media timing', async () => {
  const audio = setup();
  let reject!: (error: Error) => void;
  vi.mocked(audio.play).mockReturnValueOnce(
    new Promise((_done, fail) => {
      reject = fail;
    }),
  );
  player.play(source);
  player.play({ ...source, url: '/next.wav' });
  reject(new Error('old request'));
  await Promise.resolve();
  expect(player.error).toBeNull();
  expect(player.attempts[0].cancelled).toBe(true);
  for (const event of ['loadstart', 'loadeddata', 'playing'])
    audio.dispatchEvent(new Event(event));
  expect(player.snapshot().clickToPlayingMs).toBeGreaterThanOrEqual(0);
  expect(player.snapshot().initialBufferEstimateMs).toBeGreaterThanOrEqual(0);
});
it('rejects stale sources and unsupported codecs before touching the audio', () => {
  const audio = setup();
  expect(
    player.play({
      ...source,
      validUntil: new Date(Date.now() - 1).toISOString(),
    }),
  ).toBe(false);
  expect(audio.play).not.toHaveBeenCalled();
  vi.mocked(audio.canPlayType).mockReturnValue('');
  expect(player.play(source)).toBe(false);
  expect(player.error).toBe('UNSUPPORTED_FORMAT');
});
it('cancels native preparation, times out and keeps export free of source URLs', async () => {
  const audio = setup();
  vi.useFakeTimers();
  player.prepare(source);
  player.cancelPreparation();
  expect(audio.hasAttribute('src')).toBe(false);
  expect(player.preparations[0].outcome).toBe('cancelled');
  player.play(source);
  await vi.advanceTimersByTimeAsync(15001);
  expect(player.error).toBe('AUDIO_TIMEOUT');
  expect(audio.hasAttribute('src')).toBe(false);
  expect(JSON.stringify(player.snapshot())).not.toContain('/test.wav');
});
it('does not let preparation interrupt playing audio', () => {
  const audio = setup();
  Object.defineProperty(audio, 'paused', { value: false });
  expect(player.prepare(source)).toBe(false);
  expect(audio.load).not.toHaveBeenCalled();
});
it('does not stop native progress when JS playing events were delayed', async () => {
  const audio = setup();
  vi.useFakeTimers();
  player.play(source);
  Object.defineProperties(audio, {
    paused: { value: false },
    readyState: { value: 3 },
    currentTime: { value: 10 },
  });
  await vi.advanceTimersByTimeAsync(15001);
  expect(player.error).toBeNull();
  expect(player.status).toBe('playing');
  expect(player.attempts.at(-1)?.playingAt).toBeUndefined();
});
