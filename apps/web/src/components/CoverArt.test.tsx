import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { CoverArt } from './CoverArt';
it('tries a sharper provider image, falls back to the original and recovers for another track', () => {
  const src = 'https://lh3.googleusercontent.com/album=w60-h60-l90-rj';
  const { container, rerender } = render(
    <CoverArt src={src} title="Album" eager />,
  );
  const image = container.querySelector('img')!;
  expect(image.src).toContain('w600-h600');
  expect(image).toHaveAttribute('fetchpriority', 'high');
  fireEvent.error(image);
  expect(image.src).toBe(src);
  fireEvent.error(image);
  expect(container.querySelector('img')).toBeNull();
  expect(container.querySelector('svg')).not.toBeNull();
  rerender(<CoverArt src="/artwork/new.svg" title="New" />);
  expect(container.querySelector('img')).toHaveAttribute(
    'src',
    '/artwork/new.svg',
  );
  expect(screen.queryByRole('img')).toBeNull();
});
