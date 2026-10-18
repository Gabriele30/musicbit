import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { emptyLibrary, type Track } from '@musicbit/shared';
import type { LibraryModel } from '../library';
import { Home } from './Home';

it('starts infinite listening from the current track and lets new listeners choose their seed', async () => {
  const snapshot = emptyLibrary();
  const library = { ...snapshot, snapshot } as unknown as LibraryModel;
  const start = vi.fn();
  const search = vi.fn();
  const props = {
    active: false,
    library,
    suggestions: [],
    onOpen: vi.fn(),
    onPlay: vi.fn(),
    onSearch: search,
    onLibrary: vi.fn(),
    onPlaylist: vi.fn(),
    onStartRadio: start,
  };
  const { rerender } = render(<Home {...props} />);
  await userEvent.click(
    screen.getByRole('button', {
      name: 'Scegli un brano per l’ascolto infinito',
    }),
  );
  expect(search).toHaveBeenCalledOnce();
  expect(start).not.toHaveBeenCalled();
  const track: Track = {
    id: 'abcdefghijk',
    title: 'La tua canzone',
    artist: 'Artista',
    audioUrl: '/api/audio/abcdefghijk',
    artworkUrl: '',
    sourceUrl: '',
    permission: '',
    attribution: '',
    mimeType: 'audio/mp4',
  };
  rerender(<Home {...props} radioTrack={track} />);
  await userEvent.click(
    screen.getByRole('button', { name: 'Avvia ascolto infinito' }),
  );
  expect(start).toHaveBeenCalledExactlyOnceWith(track);
});
