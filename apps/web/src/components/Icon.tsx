import type { CSSProperties } from 'react';

export type IconName =
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
  | 'down';
const paths: Record<IconName, string> = {
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
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={style}
    >
      <path d={paths[name]} />
    </svg>
  );
}
