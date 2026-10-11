import { describe, expect, it } from 'vitest';
import { fragmentedAacPatches, patchAudioChunk } from './mp4.js';
function box(type: string, ...parts: Buffer[]) {
  const payload = Buffer.concat(parts);
  const header = Buffer.alloc(8);
  header.writeUInt32BE(payload.length + 8);
  header.write(type, 4);
  return Buffer.concat([header, payload]);
}
function fixture(
  options: {
    fragmented?: boolean;
    handler?: string;
    priming?: number;
    count?: number;
    version?: number;
    rate?: number;
    duration?: number;
  } = {},
) {
  const header = Buffer.alloc(24);
  header.writeUInt32BE(44100, 12);
  header.writeUInt32BE(441000, 16);
  const handler = Buffer.alloc(12);
  handler.write(options.handler ?? 'soun', 8);
  const edit = Buffer.alloc(20);
  edit[0] = options.version ?? 0;
  edit.writeUInt32BE(options.count ?? 1, 4);
  edit.writeUInt32BE(options.duration ?? 441000, 8);
  edit.writeInt32BE(options.priming ?? 1600, 12);
  edit.writeUInt32BE(options.rate ?? 0x10000, 16);
  const track = box(
    'trak',
    box('edts', box('elst', edit)),
    box('mdia', box('mdhd', header), box('hdlr', handler)),
  );
  const data = box(
    'moov',
    ...(options.fragmented === false ? [] : [box('mvex')]),
    track,
  );
  return { data, offset: data.indexOf(Buffer.from('elst')) + 12 };
}
describe('fragmented AAC compatibility', () => {
  it('normalizes only the edit duration, preserving encoder priming and all offsets', () => {
    const { data, offset } = fixture();
    const patches = fragmentedAacPatches(data);
    expect(patches).toEqual([{ offset, length: 4 }]);
    const patched = patchAudioChunk(data, 0, patches);
    expect(patched.length).toBe(data.length);
    expect(patched.readUInt32BE(offset)).toBe(0);
    expect(patched.readInt32BE(offset + 4)).toBe(1600);
    expect(data.readUInt32BE(offset)).toBe(441000);
    expect(patched.subarray(offset + 4)).toEqual(data.subarray(offset + 4));
  });
  it('applies the same bytes to full, split and suffix ranges without copying untouched data', () => {
    const { data, offset } = fixture();
    const patches = fragmentedAacPatches(data);
    const full = patchAudioChunk(data, 0, patches);
    const split = Buffer.concat([
      patchAudioChunk(data.subarray(0, offset + 2), 0, patches),
      patchAudioChunk(data.subarray(offset + 2), offset + 2, patches),
    ]);
    expect(split).toEqual(full);
    expect(
      patchAudioChunk(
        data.subarray(offset + 1, offset + 7),
        offset + 1,
        patches,
      ),
    ).toEqual(full.subarray(offset + 1, offset + 7));
    const untouched = data.subarray(offset + 4);
    expect(patchAudioChunk(untouched, offset + 4, patches)).toBe(untouched);
  });
  it.each([
    { fragmented: false },
    { handler: 'vide' },
    { priming: -1 },
    { priming: 100000 },
    { count: 2 },
    { version: 1 },
    { rate: 0 },
    { duration: 0 },
    { duration: 123 },
  ])('leaves unsupported edits untouched: %j', (options) => {
    expect(fragmentedAacPatches(fixture(options).data)).toEqual([]);
  });
  it('rejects truncated, extended-size and malformed headers', () => {
    const { data } = fixture();
    for (let length = 0; length < data.length; length++)
      expect(fragmentedAacPatches(data.subarray(0, length))).toEqual([]);
    const invalid = Buffer.from(data);
    invalid.writeUInt32BE(1);
    expect(fragmentedAacPatches(invalid)).toEqual([]);
  });
});
