/** Keep the byte layout stable so every HTTP Range addresses the same file. */
export interface AudioBytePatch {
  offset: number;
  length: number;
}
interface Box {
  start: number;
  end: number;
  type: string;
}
function boxes(data: Buffer, start: number, end: number): Box[] {
  const result: Box[] = [];
  for (let at = start; at + 8 <= end; ) {
    const size = data.readUInt32BE(at);
    // Do not guess about extended-size, truncated or malformed boxes.
    if (size < 8 || at + size > end) return [];
    result.push({
      start: at,
      end: at + size,
      type: data.toString('ascii', at + 4, at + 8),
    });
    at += size;
  }
  return result;
}
const children = (data: Buffer, box: Box) =>
  boxes(data, box.start + 8, box.end);

/**
 * Normalize the single priming edit of fragmented, audio-only AAC-LC.
 * Apple recommends segment_duration=0 for this edit in fragmented audio:
 * https://developer.apple.com/documentation/http-live-streaming/preparing-audio-for-http-live-streaming
 * Keep media_time (encoder priming), samples, duration and every byte offset.
 * A bounded positive edit caused Windows WebKit to scan to EOS without playing.
 */
export function fragmentedAacPatches(data: Buffer): AudioBytePatch[] {
  const movie = boxes(data, 0, data.length).find((box) => box.type === 'moov');
  if (!movie) return [];
  const movieBoxes = children(data, movie);
  if (!movieBoxes.some((box) => box.type === 'mvex')) return [];
  const tracks = movieBoxes.filter((box) => box.type === 'trak');
  if (tracks.length !== 1) return [];
  const track = children(data, tracks[0]!);
  const media = track.find((box) => box.type === 'mdia');
  const edit = track.find((box) => box.type === 'edts');
  if (!media || !edit) return [];
  const mediaBoxes = children(data, media);
  const handler = mediaBoxes.find((box) => box.type === 'hdlr');
  const header = mediaBoxes.find((box) => box.type === 'mdhd');
  if (
    !handler ||
    handler.end - handler.start < 20 ||
    data.toString('ascii', handler.start + 16, handler.start + 20) !== 'soun' ||
    !header ||
    header.end - header.start < 32 ||
    data[header.start + 8] !== 0
  )
    return [];
  const timescale = data.readUInt32BE(header.start + 20);
  const mediaDuration = data.readUInt32BE(header.start + 24);
  const list = children(data, edit).find((box) => box.type === 'elst');
  // Only the proven v0, single-entry, normal-rate, short positive priming case.
  if (
    !timescale ||
    !list ||
    list.end - list.start !== 28 ||
    data.readUInt32BE(list.start + 8) !== 0 ||
    data.readUInt32BE(list.start + 12) !== 1 ||
    data.readUInt32BE(list.start + 24) !== 0x00010000
  )
    return [];
  const duration = data.readUInt32BE(list.start + 16);
  const priming = data.readInt32BE(list.start + 20);
  if (
    duration !== mediaDuration ||
    duration === 0 ||
    priming <= 0 ||
    priming > timescale / 10
  )
    return [];
  return [{ offset: list.start + 16, length: 4 }];
}

/** Apply zero-byte edits to complete, partial and suffix ranges identically. */
export function patchAudioChunk(
  chunk: Buffer,
  absoluteOffset: number,
  patches: AudioBytePatch[],
): Buffer {
  let output = chunk;
  for (const patch of patches) {
    const start = Math.max(patch.offset, absoluteOffset);
    const end = Math.min(
      patch.offset + patch.length,
      absoluteOffset + chunk.length,
    );
    if (start >= end) continue;
    if (output === chunk) output = Buffer.from(chunk);
    output.fill(0, start - absoluteOffset, end - absoluteOffset);
  }
  return output;
}
