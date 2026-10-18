import { useLayoutEffect } from 'react';
import { accountRequest } from '../account';
import type { PlayerEngine } from './engine';

export function useContinuousPlayback(
  player: PlayerEngine,
  accountId?: string,
  bootstrap?: boolean,
) {
  useLayoutEffect(
    () => () => player.setContinuousPlayback(false),
    [player, accountId],
  );
  useLayoutEffect(() => {
    if (
      !accountId ||
      !player.audio.canPlayType('application/vnd.apple.mpegurl')
    ) {
      player.setContinuousPlayback(false);
      return;
    }
    // Auth is already resolved before the signed-in app can accept its first
    // tap. Configure native delivery before paint instead of racing another GET.
    if (typeof bootstrap === 'boolean') {
      player.setContinuousPlayback(bootstrap);
      return;
    }
    // Compatibility with an older API; current servers always bootstrap this bit.
    const controller = new AbortController();
    void accountRequest<{ enabled: boolean }>(
      '/api/me/continuous',
      undefined,
      'GET',
      controller.signal,
    )
      .then((result) => {
        if (!controller.signal.aborted)
          player.setContinuousPlayback(result.enabled);
      })
      .catch(() => {});
    return () => {
      controller.abort();
    };
  }, [player, accountId, bootstrap]);
}
