import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { InfiniteListening } from './InfiniteListening';

it('explains cached radio fallback while keeping its control available', () => {
  render(
    <InfiniteListening
      enabled
      repeating={false}
      notice="Il fornitore richiede una verifica. Continuiamo con la cache."
      onToggle={vi.fn()}
    />,
  );
  expect(
    screen.getByText(/Il fornitore richiede una verifica/),
  ).toBeInTheDocument();
  expect(
    screen.getByRole('switch', { name: 'Ascolto infinito' }),
  ).toBeChecked();
});

it('exposes the infinite mode state and explains when repeat prevents discovery', async () => {
  const toggle = vi.fn();
  const { rerender } = render(
    <InfiniteListening enabled={false} repeating={false} onToggle={toggle} />,
  );
  const control = screen.getByRole('switch', { name: 'Ascolto infinito' });
  expect(control).toHaveAttribute('aria-checked', 'false');
  await userEvent.click(control);
  expect(toggle).toHaveBeenCalledOnce();
  rerender(<InfiniteListening enabled repeating={false} onToggle={toggle} />);
  expect(control).toHaveAttribute('aria-checked', 'true');
  expect(
    screen.getByText(/si adatta ad ascolti, preferiti e skip/),
  ).toBeVisible();
  rerender(<InfiniteListening enabled repeating onToggle={toggle} />);
  expect(screen.getByText(/Disattiva Ripeti/)).toBeVisible();
});
