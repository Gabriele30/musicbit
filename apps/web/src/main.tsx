import { createRoot } from 'react-dom/client';
import { App } from './App';
import { PlayerEngine } from './player/engine';
import './styles.css';

// Construct once, outside React. This DOM node survives every screen change.
const audio = document.createElement('audio');
audio.id = 'musicbit-audio';
audio.hidden = true;
document.body.append(audio);
const player = new PlayerEngine(audio);
createRoot(document.getElementById('root')!).render(<App player={player} />);

if (import.meta.hot)
  import.meta.hot.dispose(() => {
    player.destroy();
    audio.remove();
  });
