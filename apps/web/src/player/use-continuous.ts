import { useEffect } from 'react';
import { accountRequest } from '../account';
import type { PlayerEngine } from './engine';

export function useContinuousPlayback(
  player: PlayerEngine,
  accountId?: string,
) {
  useEffect(() => {
    if (
      !accountId ||
      !player.audio.canPlayType('application/vnd.apple.mpegurl')
    )
      return;
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
      player.setContinuousPlayback(false);
    };
  }, [player, accountId]);
}
