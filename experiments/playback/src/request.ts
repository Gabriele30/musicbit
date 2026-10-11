/** Safari-compatible deadline; no dependency on AbortSignal.any/timeout. */
export async function requestJson<T>(
  url: string,
  outer: AbortSignal,
  init: RequestInit = {},
  timeoutMs = 12_000,
): Promise<{ ok: boolean; data: T }> {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  if (outer.aborted) cancel();
  else outer.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(cancel, timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const data = (await response.json()) as T;
    if (controller.signal.aborted) throw new Error('CANCELLED_OR_TIMEOUT');
    return { ok: response.ok, data };
  } finally {
    clearTimeout(timer);
    outer.removeEventListener('abort', cancel);
  }
}
