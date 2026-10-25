import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const { create, music, general } = vi.hoisted(() => ({
  create: vi.fn(),
  music: vi.fn(),
  general: vi.fn(),
}));
vi.mock('youtubei.js', () => ({
  Innertube: { create },
  Platform: { shim: {} },
  Log: { setLevel: vi.fn(), Level: { NONE: 0 } },
}));
vi.mock('./potoken.js', () => ({
  PoTokenService: class {
    mintPoToken() {
      return Promise.resolve(undefined);
    }
  },
}));
import { ProviderAudioResolver } from './provider-resolver.js';
const roots: string[] = [];
it('transforms the n parameter even when AAC has a direct URL without a signature cipher', async () => {
  vi.stubEnv('YOUTUBE_COOKIE_FILE', '');
  const player = {};
  create.mockResolvedValue({
    music: { getInfo: music },
    getBasicInfo: general,
    session: { player },
  });
  const decipher = vi
    .fn()
    .mockResolvedValue('https://r1.googlevideo.com/aac?n=transformed');
  music.mockResolvedValue({
    streaming_data: {
      adaptive_formats: [
        {
          itag: 140,
          mime_type: 'audio/mp4',
          url: 'https://r1.googlevideo.com/aac?n=encrypted',
          decipher,
        },
      ],
    },
    basic_info: { duration: 189 },
  });
  const resolver = new ProviderAudioResolver();
  try {
    expect((await resolver.resolve('abcdefghijk')).url).toBe(
      'https://r1.googlevideo.com/aac?n=transformed',
    );
    expect(decipher).toHaveBeenCalledWith(player);
  } finally {
    resolver.close();
  }
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetAllMocks();
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
it('uses only the explicit session for audio and preserves AAC-LC delivery without returning credentials', async () => {
  const root = mkdtempSync(join(tmpdir(), 'musicbit-resolver-session-'));
  roots.push(root);
  const path = join(root, 'youtube.cookies');
  writeFileSync(path, 'SAPISID=test-session; SID=test-sid', { mode: 0o600 });
  vi.stubEnv('YOUTUBE_COOKIE_FILE', path);
  create.mockResolvedValue({
    music: { getInfo: music },
    getBasicInfo: general,
  });
  music.mockResolvedValue({
    streaming_data: {
      adaptive_formats: [
        {
          itag: 251,
          mime_type: 'audio/webm',
          url: 'https://r1.googlevideo.com/opus',
        },
        {
          itag: 140,
          mime_type: 'audio/mp4; codecs="mp4a.40.2"',
          url: 'https://r1.googlevideo.com/aac',
          content_length: 1234,
        },
      ],
    },
    basic_info: { duration: 188 },
  });
  const resolver = new ProviderAudioResolver();
  try {
    const stream = await resolver.resolve('abcdefghijk');
    expect(create.mock.calls[0]?.[0].cookie).toBe(
      'SAPISID=test-session; SID=test-sid',
    );
    expect(stream).toMatchObject({
      url: 'https://r1.googlevideo.com/aac',
      mimeType: 'audio/mp4',
      durationSeconds: 188,
    });
    expect(JSON.stringify(stream)).not.toContain('test-session');
    expect(general).not.toHaveBeenCalled();
  } finally {
    resolver.close();
  }
});
it('keeps a real LOGIN_REQUIRED response distinct from a format or network failure', async () => {
  vi.stubEnv('YOUTUBE_COOKIE_FILE', '');
  create.mockResolvedValue({
    music: { getInfo: music },
    getBasicInfo: general,
  });
  music.mockResolvedValue({
    playability_status: { status: 'LOGIN_REQUIRED' },
    basic_info: {},
  });
  const resolver = new ProviderAudioResolver();
  try {
    await expect(resolver.resolve('abcdefghijk')).rejects.toMatchObject({
      code: 'PROVIDER_RESTRICTED',
    });
  } finally {
    resolver.close();
  }
});
it.each(['LOGIN_REQUIRED', 'UNPLAYABLE'])(
  'tries the WEB player when Music returns %s without formats',
  async (status) => {
    vi.stubEnv('YOUTUBE_COOKIE_FILE', '');
    create.mockResolvedValue({
      music: { getInfo: music },
      getBasicInfo: general,
    });
    music.mockResolvedValue({ playability_status: { status }, basic_info: {} });
    general.mockResolvedValue({
      streaming_data: {
        adaptive_formats: [
          {
            itag: 140,
            mime_type: 'audio/mp4',
            url: 'https://r1.googlevideo.com/aac',
          },
        ],
      },
      basic_info: { duration: 188 },
    });
    const resolver = new ProviderAudioResolver();
    try {
      const stream = await resolver.resolve('abcdefghijk');
      expect(general).toHaveBeenCalledWith('abcdefghijk', { client: 'WEB' });
      expect(stream).toMatchObject({
        mimeType: 'audio/mp4',
        durationSeconds: 188,
      });
    } finally {
      resolver.close();
    }
  },
);
