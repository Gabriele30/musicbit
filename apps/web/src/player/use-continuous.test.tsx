import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { accountRequest } from '../account';
import type { PlayerEngine } from './engine';
import { useContinuousPlayback } from './use-continuous';

vi.mock('../account', () => ({ accountRequest: vi.fn() }));
const request = vi.mocked(accountRequest);
function player(native = true) {
  return {
    audio: { canPlayType: vi.fn(() => (native ? 'maybe' : '')) },
    setContinuousPlayback: vi.fn(),
  } as unknown as PlayerEngine;
}
afterEach(() => vi.resetAllMocks());

describe('continuous delivery bootstrap', () => {
  it('configures HLS before the signed-in page can accept its first tap', () => {
    const engine = player();
    const view = renderHook(() =>
      useContinuousPlayback(engine, 'listener', true),
    );
    expect(engine.setContinuousPlayback).toHaveBeenLastCalledWith(true);
    expect(request).not.toHaveBeenCalled();
    view.rerender();
    expect(engine.setContinuousPlayback).toHaveBeenCalledTimes(1);
    view.unmount();
    expect(engine.setContinuousPlayback).toHaveBeenLastCalledWith(false);
  });
  it.each([
    [undefined, true, true],
    ['listener', false, true],
    ['listener', true, false],
  ] as const)(
    'keeps progressive playback for guest, unsupported or disabled delivery (%s, %s, %s)',
    (account, native, enabled) => {
      const engine = player(native);
      renderHook(() => useContinuousPlayback(engine, account, enabled));
      expect(engine.setContinuousPlayback).toHaveBeenLastCalledWith(false);
      expect(request).not.toHaveBeenCalled();
    },
  );
  it('supports older APIs and ignores a delayed response after the account changes', async () => {
    let deliver!: (value: unknown) => void;
    request.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          deliver = resolve;
        }),
    );
    const engine = player();
    const view = renderHook(
      ({ account, bootstrap }: { account?: string; bootstrap?: boolean }) =>
        useContinuousPlayback(engine, account, bootstrap),
      { initialProps: { account: 'listener', bootstrap: undefined } },
    );
    expect(request).toHaveBeenCalledOnce();
    const signal = request.mock.calls[0]?.[3];
    view.rerender({ account: 'other', bootstrap: false });
    expect(signal?.aborted).toBe(true);
    await act(async () => {
      deliver({ enabled: true });
    });
    expect(engine.setContinuousPlayback).toHaveBeenLastCalledWith(false);
  });
});
