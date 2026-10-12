import { useEffect } from 'react';

/** Resolve one visible candidate ahead of a tap; never touches native audio. */
export function useAudioWarmup(source: string | undefined, active: boolean) {
  useEffect(() => {
    if (!active || !source || !/^\/api\/audio\/[A-Za-z0-9_-]{11}$/.test(source))
      return;
    const controller = new AbortController();
    let deadline: ReturnType<typeof setTimeout> | undefined;
    const timer = setTimeout(() => {
      deadline = setTimeout(() => controller.abort(), 50000);
      void fetch(`${source}/info`, {
        signal: controller.signal,
        credentials: 'same-origin',
        cache: 'no-store',
      })
        .catch(() => {})
        .finally(() => clearTimeout(deadline));
    }, 250);
    return () => {
      clearTimeout(timer);
      clearTimeout(deadline);
      controller.abort();
    };
  }, [source, active]);
}
