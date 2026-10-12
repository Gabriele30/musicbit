import { useEffect, useRef, useState } from 'react';
import { registerSW } from 'virtual:pwa-register';

export function PwaNotice() {
  const [update, setUpdate] = useState(false);
  const [offline, setOffline] = useState(false);
  const [registrationError, setRegistrationError] = useState(false);
  const applyUpdate =
    useRef<(reloadPage?: boolean) => Promise<void>>(undefined);
  useEffect(() => {
    applyUpdate.current = registerSW({
      onNeedRefresh: () => setUpdate(true),
      onOfflineReady: () => setOffline(true),
      onRegisterError: () => setRegistrationError(true),
    });
  }, []);
  return (
    <div className="pwa-note">
      {update ? (
        <span>
          Aggiornamento disponibile. L’ascolto si interromperà per ricaricare.{' '}
          <button
            className="secondary-button"
            onClick={() => void applyUpdate.current?.(true)}
          >
            Aggiorna MusicBit
          </button>
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
