import { useState } from 'react';
import { Icon } from './Icon';

function displaySource(src: string) {
  try {
    const url = new URL(src);
    if (
      url.protocol === 'https:' &&
      /(^|\.)googleusercontent\.com$/.test(url.hostname)
    )
      return src.replace(/=w\d+-h\d+/, '=w600-h600');
  } catch {
    /* Local artwork keeps its original path. */
  }
  return src;
}
function ArtworkImage({ src, eager }: { src: string; eager: boolean }) {
  const [source, setSource] = useState(() => displaySource(src));
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    <img
      src={source}
      alt=""
      loading={eager ? 'eager' : 'lazy'}
      fetchPriority={eager ? 'high' : 'auto'}
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => {
        if (source !== src) setSource(src);
        else setFailed(true);
      }}
    />
  );
}
export function CoverArt({
  src,
  title,
  artist = false,
  className = '',
  eager = false,
}: {
  src?: string;
  title: string;
  artist?: boolean;
  className?: string;
  eager?: boolean;
}) {
  return (
    <span
      className={`cover-art ${artist ? 'artist-cover' : ''} ${className}`}
      aria-hidden="true"
      data-cover-title={title}
    >
      <Icon name={artist ? 'user' : 'music'} size={32} />
      {src && <ArtworkImage key={src} src={src} eager={eager} />}
    </span>
  );
}
