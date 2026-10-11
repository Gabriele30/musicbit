import { describe, expect, it } from 'vitest';
import { emptyLibrary } from '@musicbit/shared';
import { parseBackup } from './backup';
describe('recoverable library backups', () => {
  it('accepts exported and legacy libraries while rejecting malformed and oversized files', () => {
    const lib = emptyLibrary();
    expect(
      parseBackup(JSON.stringify({ format: 'musicbit-library', library: lib })),
    ).toEqual(lib);
    expect(parseBackup(JSON.stringify(lib))).toEqual(lib);
    expect(() => parseBackup('{bad')).toThrow('JSON');
    expect(() =>
      parseBackup(JSON.stringify({ ...lib, playlists: [{ id: 'x' }] })),
    ).toThrow('non valido');
    expect(() => parseBackup(' '.repeat(5000001))).toThrow('5 MB');
  });
});
