import { describe, expect, it } from 'vitest';
import { randomBelow, shuffled } from './random';
describe('uniform shuffle', () => {
  it('rejects modulo-bias tail values before selecting a uniform integer', () => {
    const values = [0xffffffff, 5];
    expect(randomBelow(3, () => values.shift()!)).toBe(2);
    expect(values).toHaveLength(0);
  });
  it('preserves every queue entry including duplicate tracks and the played prefix', () => {
    const input = ['played', 'current', 'a', 'b', 'b', 'c'],
      result = shuffled(input, 2);
    expect(result.slice(0, 2)).toEqual(['played', 'current']);
    expect(result.slice(2).sort()).toEqual(input.slice(2).sort());
    expect(input).toEqual(['played', 'current', 'a', 'b', 'b', 'c']);
  });
});
