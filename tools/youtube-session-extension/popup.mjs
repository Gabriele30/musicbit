import { exportSession } from './session.mjs';
document.querySelector('#export').addEventListener('click', async () => {
  const status = document.querySelector('#status');
  const button = document.querySelector('#export');
  button.disabled = true;
  status.textContent = 'Lettura della sessione YouTube…';
  try {
    if (!globalThis.chrome.extension.inIncognitoContext) {
      status.textContent =
        'Apri questa estensione dalla finestra in incognito dedicata a MusicBit. Nei dettagli dell’estensione abilita Consenti modalità incognito. La sessione del Chrome abituale può cambiare dopo l’esportazione.';
      return;
    }
    const cookies = await globalThis.chrome.cookies.getAll({
      url: 'https://www.youtube.com/',
    });
    const text = exportSession(cookies);
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'youtube.cookies';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    status.textContent =
      'File esportato. Chiudi tutte le finestre in incognito senza uscire dall’account YouTube. Poi importa youtube.cookies nella pagina locale MusicBit del browser normale. Non inviarlo in chat.';
  } catch (error) {
    status.textContent =
      error.message === 'Accedi prima a YouTube nel tuo browser normale.'
        ? 'Nessuna sessione leggibile. Se sei già connesso a YouTube, ricarica l’estensione e consenti l’accesso a youtube.com nei suoi dettagli.'
        : 'Esportazione non completata. Controlla l’accesso a YouTube e riprova.';
  } finally {
    button.disabled = false;
  }
});
