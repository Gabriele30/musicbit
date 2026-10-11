import type { CSSProperties } from 'react';

export type IconName =
  | 'user'
  | 'home'
  | 'search'
  | 'music'
  | 'play'
  | 'pause'
  | 'next'
  | 'previous'
  | 'queue'
  | 'pulse'
  | 'plus'
  | 'arrow'
  | 'download'
  | 'close'
  | 'up'
  | 'down'
  | 'repeat'
  | 'shuffle'
  | 'more'
  | 'settings'
  | 'refresh'
  | 'library'
  | 'heart';
const paths: Record<IconName, string> = {
  user: 'M20 21v-2a7 7 0 0 0-14 0v2 M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8',
  more: 'M5 12h.01 M12 12h.01 M19 12h.01',
  settings: 'M4 7h16 M4 17h16 M8 4v6 M16 14v6',
  refresh: 'M20 7V3l-3 3a8 8 0 1 0 3 9 M20 3h-5',
  library: 'M4 4v16 M9 4v16 M14 5l5-1 3 15-5 1Z',
  home: 'M3 10l9-7 9 7v11h-6v-7H9v7H3Z',
  heart:
    'M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z',
  search: 'M21 21l-5-5 M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
  music:
    'M9 18V5l12-2v13 M9 5l12-2 M9 18a3 3 0 1 1-3-3c1.66 0 3 1.34 3 3 M21 16a3 3 0 1 1-3-3c1.66 0 3 1.34 3 3',
  play: 'M8 4l13 8-13 8Z',
  pause: 'M8 5v14 M16 5v14',
  next: 'M5 5l10 7-10 7Z M19 5v14',
  previous: 'M19 5L9 12l10 7Z M5 5v14',
  queue: 'M4 6h16 M4 12h10 M4 18h8 M18 14l4 4-4 4',
  pulse: 'M2 12h4l3-8 5 16 3-8h5',
  plus: 'M12 5v14 M5 12h14',
  arrow: 'M5 12h14 M14 7l5 5-5 5',
  download: 'M12 3v12 M7 10l5 5 5-5 M4 16v5h16v-5',
  close: 'M6 6l12 12 M18 6L6 18',
  up: 'M6 14l6-6 6 6',
  down: 'M6 10l6 6 6-6',
  repeat:
    'M17 2l4 4-4 4 M3 11V8a2 2 0 0 1 2-2h16 M7 22l-4-4 4-4 M21 13v3a2 2 0 0 1-2 2H3',
  shuffle:
    'M3 5h3l12 14h3 M18 16l3 3-3 3 M3 19h3l4-5 M14 10l4-5h3 M18 2l3 3-3 3',
};
export function Icon({
  name,
  size = 22,
  style,
}: {
  name: IconName;
  size?: number;
  style?: CSSProperties;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={
        name === 'play' || name === 'next' || name === 'previous'
          ? 'currentColor'
          : 'none'
      }
      stroke="currentColor"
      strokeWidth={name === 'more' ? 4 : 1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={style}
    >
      <path d={paths[name]} />
    </svg>
  );
}
