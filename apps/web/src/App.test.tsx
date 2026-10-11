import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { Track } from '@musicbit/shared';
import { App } from './App';
import { PlayerEngine } from './player/engine';

vi.mock('./components/PwaNotice', () => ({
  PwaNotice: () => <span>PWA</span>,
}));
const tracks: Track[] = [1, 2, 3].map((id) => ({
  id: `track-${id}`,
  title: `Demo ${id}`,
  artist: 'Author',
  album: 'Demo',
  audioUrl: `https://example.com/${id}.mp3`,
  artworkUrl: '/cover.png',
  mimeType: 'audio/mpeg',
  sourceUrl: 'https://example.com',
  permission: 'Authorized',
  attribution: 'Author',
}));
function setup() {
  history.replaceState(null, '', '/?screen=player&demo=1');
  const audio = document.createElement('audio');
  vi.spyOn(audio, 'play').mockResolvedValue();
  vi.spyOn(audio, 'pause').mockImplementation(() => {});
  vi.spyOn(audio, 'load').mockImplementation(() => {});
  const player = new PlayerEngine(audio);
  render(<App player={player} />);
  return { player, audio };
}
describe('application', () => {
  it('keeps the same audio instance while navigating and editing the queue', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ provider: 'demo', tracks }),
      }),
    );
    const { player, audio } = setup();
    const user = userEvent.setup();
    await screen.findByRole('button', { name: 'Riproduci Demo 1' });
    await user.click(screen.getByRole('button', { name: 'Play', exact: true }));
    await user.click(screen.getByRole('button', { name: 'Impostazioni' }));
    await user.click(
      screen.getByRole('button', { name: 'Diagnostica', exact: true }),
    );
    expect(
      screen.getByRole('heading', { name: 'Diagnostica' }),
    ).toBeInTheDocument();
    expect(player.audio).toBe(audio);
    expect(audio.play).toHaveBeenCalledOnce();
    await user.click(
      screen.getByRole('button', { name: 'Apri player: Demo 1' }),
    );
    await user.click(screen.getByRole('button', { name: 'Coda', exact: true }));
    await user.click(
      screen.getByRole('button', { name: 'Rimuovi posizione 2' }),
    );
    expect(player.getSnapshot().queue).toHaveLength(2);
    player.destroy();
  });
  it('retries catalog failures and renders the recovered tracks', async () => {
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ provider: 'demo', tracks }),
      });
    vi.stubGlobal('fetch', (url: string) =>
      url === '/api/auth/session'
        ? Promise.resolve({
            ok: true,
            json: async () => ({ user: null, registrationEnabled: true }),
          })
        : fetcher(url),
    );
    const { player } = setup();
    await screen.findByRole('alert');
    await userEvent.click(
      screen.getByRole('button', { name: 'Riprova catalogo' }),
    );
    await screen.findByRole('button', { name: 'Riproduci Demo 3' });
    await waitFor(() =>
      expect(screen.queryByRole('alert')).not.toBeInTheDocument(),
    );
    player.destroy();
  });
  it('rejects malformed API data with an actionable error', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue({ ok: true, json: async () => ({ tracks: 'bad' }) }),
    );
    const { player } = setup();
    expect(await screen.findByRole('alert')).toHaveTextContent('API');
    player.destroy();
  });
});
