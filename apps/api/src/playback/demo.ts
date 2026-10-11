import type {
  PlaybackProvider,
  PlaybackReference,
  PlaybackResolution,
} from '@musicbit/shared';
import { DemoMusicProvider } from '../providers/demo.js';

/** Exact identity mapping only. No title matching, YouTube lookup or media fetch. */
export class AuthorizedDemoPlaybackProvider implements PlaybackProvider {
  readonly id = 'authorized-demo';
  constructor(private catalog = new DemoMusicProvider()) {}
  async resolve(
    reference: PlaybackReference,
    signal: AbortSignal,
  ): Promise<PlaybackResolution> {
    signal.throwIfAborted();
    if (reference.catalogProvider !== this.catalog.id)
      return { status: 'unavailable', code: 'NO_AUTHORIZED_SOURCE' };
    const track = await this.catalog.getTrack(reference.catalogId);
    signal.throwIfAborted();
    if (!track) return { status: 'unavailable', code: 'NOT_FOUND' };
    return {
      status: 'available',
      source: {
        provider: this.id,
        reference: { ...reference },
        url: track.audioUrl,
        mimeType: track.mimeType,
        delivery: 'progressive',
        validUntil: null,
        title: track.title,
        artist: track.artist,
        authorization: {
          sourceUrl: track.sourceUrl,
          permission: track.permission,
          attribution: track.attribution,
        },
      },
    };
  }
}
