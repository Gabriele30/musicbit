import { afterEach, expect, it, vi } from 'vitest';
import { OfficialControl } from './official';

afterEach(() => {
  delete window.YT;
  delete window.onYouTubeIframeAPIReady;
  vi.useRealTimers();
});
it('keeps the official iframe control separate, records state timing and pauses on background', async () => {
  const pauseVideo = vi.fn(),
    cueVideoById = vi.fn(),
    playVideo = vi.fn(),
    destroy = vi.fn();
  let state: (e: { data: number }) => void = () => {};
  window.YT = {
    Player: class {
      pauseVideo = pauseVideo;
      cueVideoById = cueVideoById;
      playVideo = playVideo;
      destroy = destroy;
      constructor(
        _element: HTMLElement,
        config: ConstructorParameters<NonNullable<Window['YT']>['Player']>[1],
      ) {
        expect(config.playerVars.controls).toBe(1);
        expect(config.height).toBe('240');
        expect(config.videoId).toBe('m5fixture01');
        state = config.events.onStateChange;
        queueMicrotask(config.events.onReady);
      }
    },
  };
  const control = new OfficialControl(document.createElement('div'), vi.fn());
  await control.load('m5fixture01');
  control.cue('m5fixture01');
  control.play('m5fixture01');
  state({ data: 1 });
  expect(control.events.at(-1)).toMatchObject({
    event: 'state',
    code: 1,
    videoId: 'm5fixture01',
  });
  expect(control.events.at(-1)?.clickToStatePlayingMs).toBeGreaterThanOrEqual(
    0,
  );
  expect(playVideo).toHaveBeenCalledOnce();
  window.dispatchEvent(new Event('pagehide'));
  expect(pauseVideo).toHaveBeenCalledOnce();
  expect(control.events.at(-1)?.event).toBe('paused-background-policy');
  control.dispose();
  expect(destroy).toHaveBeenCalledOnce();
});
