import { useEffect, useState } from 'react';
import { registerSW } from 'virtual:pwa-register';

export function PwaNotice() {
  const [update, setUpdate] = useState(false);
  const [offline, setOffline] = useState(false);
  const [registrationError, setRegistrationError] = useState(false);
  useEffect(() => {
    registerSW({
      onNeedRefresh: () => setUpdate(true),
      onOfflineReady: () => setOffline(true),
      onRegisterError: () => setRegistrationError(true),
    });
  }, []);
  return (
    <div className="pwa-note">
      {update ? (
        <span>
          Aggiornamento disponibile. Chiudi e riapri l’app al termine
          dell’ascolto.
        </span>
      ) : registrationError ? (
        <span>Service worker non disponibile. Verifica HTTPS e ricarica.</span>
      ) : offline ? (
        <span>
          Interfaccia pronta offline · l’audio richiede una connessione.
        </span>
      ) : (
        <span>
          Su iPhone: Safari → Condividi → Aggiungi alla schermata Home.
        </span>
      )}
    </div>
  );
}
