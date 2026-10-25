# MusicBit: sessione YouTube autorizzata

Estensione locale da caricare manualmente in Chrome/Edge. Non è pubblicata su
uno store e non riceve aggiornamenti remoti. Il solo permesso richiesto è la
lettura dei cookie su YouTube tramite l'API del browser.

Nei dettagli dell'estensione abilitare **Consenti modalità incognito**. Aprire
una finestra in incognito dedicata, accedere personalmente a YouTube, poi aprire
l'estensione e premere **Esporta per il mio server**. Chiudere tutte le finestre
in incognito senza fare logout da YouTube, quindi tornare alla pagina MusicBit
nel browser normale. La versione 1.0.2 usa un contesto separato e rifiuta
l'esportazione dal browser normale per ridurre la rotazione della sessione.
Il file privato `youtube.cookies`
contiene soltanto i cookie di autenticazione YouTube selezionati dal filtro.
Non inviarlo in chat, GitHub o email: importarlo nella pagina locale aperta da
`pnpm youtube:connect --ssh utente@server`, quindi eliminare il file.

Non sono presenti script sulle pagine, accesso a Google o ad altri siti,
connessioni di rete, lettura di password, clipboard o automazione dell'accesso.
L'esportazione avviene soltanto premendo il pulsante. L'estensione può essere
rimossa subito dopo l'importazione.
