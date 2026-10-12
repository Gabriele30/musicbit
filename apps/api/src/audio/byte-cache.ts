export const AUDIO_PREFETCH_LIMIT = 16 * 1024 * 1024;
interface Entry {
  bytes: Buffer;
  mimeType: string;
  expiresAt: number;
}

/** Short-lived canonical audio bytes. No disk storage, signed URLs or user data. */
export class AudioByteCache {
  private entries = new Map<string, Entry>();
  private size = 0;
  constructor(
    private limit = 64 * 1024 * 1024,
    private ttlMs = 15 * 60000,
  ) {}
  get(id: string): Entry | undefined {
    const entry = this.entries.get(id);
    if (!entry) return;
    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(id);
      this.size -= entry.bytes.length;
      return;
    }
    this.entries.delete(id);
    this.entries.set(id, entry);
    return entry;
  }
  put(id: string, bytes: Buffer, mimeType: string) {
    if (
      !bytes.length ||
      bytes.length > AUDIO_PREFETCH_LIMIT ||
      bytes.length > this.limit
    )
      return;
    const previous = this.entries.get(id);
    if (previous) this.size -= previous.bytes.length;
    this.entries.delete(id);
    this.entries.set(id, {
      bytes,
      mimeType,
      expiresAt: Date.now() + this.ttlMs,
    });
    this.size += bytes.length;
    while (this.size > this.limit) {
      const oldest = this.entries.keys().next().value!;
      this.size -= this.entries.get(oldest)!.bytes.length;
      this.entries.delete(oldest);
    }
  }
  clear() {
    this.entries.clear();
    this.size = 0;
  }
}
