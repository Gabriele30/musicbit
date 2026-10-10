# Ambiente HTTPS per iPhone

Il server locale M2 è già stato provato dal PC all’IP LAN 192.168.1.69 sulla porta
4443: CA/SAN, API, manifest, SW e schermata mobile. **Raggiungibilità e fiducia
sull’iPhone non verificate.** Nessuna CA è stata installata automaticamente.

## HTTPS LAN con CA locale

1. PC e iPhone sulla stessa Wi-Fi non isolata. Evitare rete guest/VPN che impedisca
   il collegamento al PC. Chiudere vecchi server sulle medesime porte prima di riavviarli.
2. Dalla radice: `pnpm install --frozen-lockfile`, `pnpm build`, `pnpm start`.
3. Secondo terminale: `pnpm test:https --share-ca`. Scegliere l’IP LAN stampato,
   tipicamente `https://192.168.1.69:4443/?screen=diagnostics` su questo PC.
4. Se Windows chiede l’accesso alla rete per Node, consentire sulla rete privata
   usata dal test. Verificare che firewall/AP permettano TCP 4443 e, solo durante
   trasferimento CA, 4444. Non modificare le regole delle reti pubbliche per questo test.
5. Sul telefono, Safari: `http://<IP-LAN>:4444/musicbit-root-ca.cer`; consentire
   download del profilo. In alternativa trasferire **solo**
   `artifacts/https/musicbit-root-ca.cer` tramite un proprio canale di file.
6. Impostazioni → Generali → VPN e gestione dispositivo (o “Profilo scaricato”)
   → MusicBit development CA → Installa. Poi Generali → Info → Impostazioni
   attendibilità certificati → abilitare fiducia completa per questa CA.
   [Apple: fiducia dei certificati installati manualmente](https://support.apple.com/en-us/102390).
7. Aprire HTTPS sul telefono senza avvisi. Verificare `/health`, `/api/tracks`,
   poi `/?screen=diagnostics`: Contesto sicuro “Sì”. Se l’IP cambia, riavviare lo
   script per rigenerare il certificato con i SAN correnti. La CA viene riusata.
8. Fermare e riavviare `pnpm test:https` **senza** `--share-ca` dopo l’installazione:
   chiude il download HTTP del certificato. Il servizio HTTPS resta necessario.

Chiavi e certificati sono in `artifacts/https/`, ignorati da Git. Non trasferire
`root-ca-key.pem` o `server-key.pem`. CA valida 365 giorni, leaf 30 giorni,
rigenerata all’avvio; chiavi RSA 2048/SHA-256. Lo script non modifica il trust store.
Questa CA serve solo al laboratorio personale: al termine rimuovere il profilo
MusicBit dall’iPhone. Ctrl+C ferma il server. Non è un deploy pubblico.

`HTTPS_PORT`, `HTTPS_UPSTREAM` (default http://127.0.0.1:4173) e `HTTPS_HOSTS`
(nomi aggiuntivi separati da virgola) si impostano nella **shell**, non nel `.env`.
Il proxy HTTPS inoltra l’app locale; `/__hls/` inoltra il laboratorio loopback 4180.
Non inoltra URL musicali remoti.

Dal PC, con server attivi:

```powershell
$env:MUSICBIT_HTTPS_URL = 'https://192.168.1.69:4443'
pnpm smoke:https
```

Lo smoke Node valida davvero la CA e il nome/IP. Chromium usa un pin SPKI del
solo certificato di test per quel processo, per verificare pagina/SW; questo non
installa la CA nel sistema e non dimostra il trust o la raggiungibilità dell’iPhone.

## Alternativa privata Tailscale

Tailscale era già attivo sul PC, ma Serve ha risposto “not enabled on your tailnet”.
Nessuna configurazione esistente è stata sovrascritta e non è stato aperto Funnel.
L’amministratore deve prima abilitare HTTPS/Serve dalla pagina proposta da
`tailscale serve --bg http://127.0.0.1:4173`. Su Windows il comando è disponibile
anche come `& 'C:\Program Files\Tailscale\tailscale.exe' ...`.

Dopo l’abilitazione:

1. Collegare iPhone e PC alla stessa tailnet; rispettare le ACL di accesso.
2. Leggere `tailscale status --json` e prendere Self.DNSName senza punto finale.
   Mettere questo hostname esatto in `WEB_ALLOWED_HOST` nel `.env`; riavviare preview.
3. `tailscale serve status --json`: controllare che non ci sia un servizio 443
   diverso da preservare. Quindi `tailscale serve --bg http://127.0.0.1:4173`.
4. Aprire l’URL HTTPS `.ts.net` stampato sul telefono. Certificato gestito da
   Tailscale; nessuna CA locale da installare. Verificare API e diagnostica.
5. Per disattivare solo questo mapping: `tailscale serve --https=443 off`.
   Non usare `serve reset` se sono stati aggiunti altri servizi.

[Documentazione Tailscale Serve](https://tailscale.com/docs/features/tailscale-serve).
Questa opzione resta **non attivata** nella verifica M2. Per HLS usare il proxy
HTTPS locale sopra: Vite preview non inoltra il percorso sperimentale a 4180.

## Installazione e sessione PWA

In Safari sul telefono aprire l’origine HTTPS verificata, Condividi → Aggiungi
alla schermata Home → lasciare “Apri come app web” attivo, se presente → Aggiungi.
Aprire dall’icona Home; in Diagnostica il contesto deve risultare Standalone.
Ripetere ogni prova anche nella scheda Safari: sono sessioni diverse.
[Guida iPhone Apple](https://support.apple.com/guide/iphone/iphea86e5236/ios).

Aprire `/?screen=diagnostics` per misurare con controlli a portata di mano.
Esportare JSON prima e dopo i test, senza reload nel mezzo. Il report fisico è
ancora tutto da compilare: [checklist](ios-checklist.md), [registro](ios-test-report.md).
Per Debian/dominio pubblico restano valide le istruzioni Caddy/Compose del README;
build e runtime Docker non sono stati verificati in M2.
