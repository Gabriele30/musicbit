/** Uniform integers with rejection sampling: every Fisher–Yates permutation is possible. */
export function randomBelow(
  bound: number,
  draw = () => crypto.getRandomValues(new Uint32Array(1))[0]!,
) {
  if (!Number.isSafeInteger(bound) || bound < 1 || bound > 0x100000000)
    throw new RangeError('Invalid random bound');
  const limit = Math.floor(0x100000000 / bound) * bound;
  let value: number;
  do {
    value = draw();
  } while (value >= limit);
  return value % bound;
}
export function shuffled<T>(items: readonly T[], first = 0) {
  const result = [...items];
  for (let i = result.length - 1; i > first; i--) {
    const other = first + randomBelow(i - first + 1);
    [result[i], result[other]] = [result[other]!, result[i]!];
  }
  return result;
}
