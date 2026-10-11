import { readFile } from 'node:fs/promises';

/** A local operator-supplied record, not a mechanism that grants platform permission. */
export interface YouTubePermission {
  videoId: string;
  title: string;
  artist: string;
  contentPermissionUrl: string;
  servicePermissionUrl: string;
  attribution: string;
  expiresAt: string;
}
export const videoIdPattern = /^[A-Za-z0-9_-]{11}$/;

export async function loadPermissions(
  path?: string,
): Promise<YouTubePermission[]> {
  if (!path) return [];
  try {
    return parsePermissions(JSON.parse(await readFile(path, 'utf8')));
  } catch {
    throw new Error('Cannot read valid M5 permission records');
  }
}

export function parsePermissions(value: unknown): YouTubePermission[] {
  const keys = [
    'videoId',
    'title',
    'artist',
    'contentPermissionUrl',
    'servicePermissionUrl',
    'attribution',
    'expiresAt',
  ];
  if (!Array.isArray(value) || value.length > 20)
    throw new Error('Invalid YouTube permission records');
  const ids = new Set<string>();
  return value.map((entry: unknown) => {
    if (!entry || typeof entry !== 'object')
      throw new Error('Invalid permission record');
    const record = entry as Record<string, unknown>;
    if (
      Object.keys(record).length !== keys.length ||
      keys.some(
        (key) =>
          typeof record[key] !== 'string' ||
          !record[key].trim() ||
          record[key].length > 2000,
      ) ||
      !videoIdPattern.test(String(record.videoId)) ||
      ids.has(String(record.videoId)) ||
      !Number.isFinite(Date.parse(String(record.expiresAt)))
    )
      throw new Error('Invalid permission record');
    for (const key of ['contentPermissionUrl', 'servicePermissionUrl']) {
      let url: URL;
      try {
        url = new URL(String(record[key]));
      } catch {
        throw new Error('Invalid permission reference');
      }
      if (
        url.protocol !== 'https:' ||
        url.username ||
        url.password ||
        url.search ||
        url.hash
      )
        throw new Error(
          'Permission references must be public HTTPS URLs without credentials/query',
        );
    }
    ids.add(String(record.videoId));
    return { ...record } as unknown as YouTubePermission;
  });
}
