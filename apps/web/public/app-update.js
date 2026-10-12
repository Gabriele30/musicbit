// This page is served under /api/, outside even older app-shell navigation rules.
// It activates the current worker without deleting cookies, storage or caches.
const button = document.getElementById('update');
const status = document.getElementById('status');

function waitForWorker(worker, complete) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => finish(new Error('timeout')), 30000);
    function finish(error) {
      clearTimeout(timeout);
      worker.removeEventListener('statechange', changed);
      if (error) reject(error);
      else resolve();
    }
    function changed() {
      if (complete.includes(worker.state)) finish();
      else if (worker.state === 'redundant') finish(new Error('redundant'));
    }
    worker.addEventListener('statechange', changed);
    changed();
  });
}

button.addEventListener('click', async () => {
  button.disabled = true;
  status.textContent = 'Scaricamento e applicazione dell’aggiornamento…';
  try {
    if ('serviceWorker' in navigator) {
      const registration = await navigator.serviceWorker.getRegistration('/');
      if (
        registration &&
        registration.scope === new URL('/', location.href).href
      ) {
        await registration.update();
        const installing = registration.installing;
        if (installing)
          await waitForWorker(installing, ['installed', 'activated']);
        const waiting = registration.waiting;
        if (waiting) {
          const activated = waitForWorker(waiting, ['activated']);
          waiting.postMessage({ type: 'SKIP_WAITING' });
          await activated;
        }
      }
    }
    location.replace('/');
  } catch {
    status.textContent =
      'Aggiornamento non completato. Controlla la connessione e riprova.';
    button.disabled = false;
  }
});
