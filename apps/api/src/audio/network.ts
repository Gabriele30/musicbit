/** Keep third-party metadata calls bounded, including response-body consumption. */
export const fetchMetadata: typeof fetch = (input, init) => {
  const caller =
    init?.signal ?? (input instanceof Request ? input.signal : undefined);
  return fetch(input, {
    ...init,
    signal: AbortSignal.any([
      AbortSignal.timeout(10000),
      ...(caller ? [caller] : []),
    ]),
  });
};
