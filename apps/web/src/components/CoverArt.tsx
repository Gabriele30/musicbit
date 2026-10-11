import type { CSSProperties } from 'react';
import { Icon } from './Icon';

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
  const hue =
    [...title].reduce((sum, character) => sum + character.charCodeAt(0), 0) %
    360;
  return (
    <span
      className={`cover-art ${artist ? 'artist-cover' : ''} ${className}`}
      style={{ '--cover-hue': hue } as CSSProperties}
      aria-hidden="true"
    >
      <Icon name={artist ? 'music' : 'library'} size={32} />
      {src && (
        <img
          key={src}
          src={src}
          alt=""
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
          referrerPolicy="no-referrer"
          onError={(event) => {
            event.currentTarget.hidden = true;
          }}
        />
      )}
    </span>
  );
}
