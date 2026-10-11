# Verifiche offline dell'audit SimpMusic M6

Questa directory contiene verifiche di **provenienza e riproducibilità** del
[report M6](../../docs/simpmusic-backend-integration.md). Non contiene un servizio
Kotlin, un provider, un proxy o fixture che simulino la risoluzione YouTube.
Le fasi B/C sono ferme alle condizioni documentate nel report.

Il test usa Node 24, `node:test`, Git e i clone esterni; non installa dipendenze,
non contatta servizi e non esegue Gradle, player JS o estrattori.

```powershell
node --test experiments/simpmusic-audit/audit.test.mjs
```

Percorsi predefiniti, relativi alla cartella sorella `../musicbit-audits/`:

| Clone                          | Variabile per cambiare percorso | Commit                                     |
| ------------------------------ | ------------------------------- | ------------------------------------------ |
| `SimpMusic`                    | `M6_SIMPMUSIC_PATH`             | `0e08a12633a50f0758e820a35050ac4e9e066c8f` |
| `SimpMusic/core`               | `M6_CORE_PATH`                  | `b9f4ceac52e7c25cb059ea78141784dc164e0161` |
| `SimpMusic-PipePipeExtractor`  | `M6_PIPEPIPE_PATH`              | `f8982ca9e7757b196139d746b3069c74b79ded1a` |
| `SimpMusic-BravePipeExtractor` | `M6_BRAVEPIPE_PATH`             | `0fcaf19ecc56fe875ddceaee381217a59514f3cf` |
| `SimpMusic-quickjs-kt`         | `M6_QUICKJS_PATH`               | `a081755bcdb18ee6afa7ffee25b8fa976f06d31f` |

Per ricreare i clone, usare gli URL e gli SHA in `snapshot.json`, fare checkout
dei commit esatti e inizializzare il submodule core del superproject. Non usare
il branch corrente del core come sostituto del gitlink. QuickJS-KT è stato
letto al tag `v1.0.15`; i suoi submodule nativi non servono a queste verifiche.

Il test fallisce se un clone manca, è modificato o ha SHA diverso; controlla
gitlink, pin Gradle, licenze, hash SHA-256 del testo normalizzato LF e tutti i
riferimenti a righe del report. Non è nella CI ordinaria perché richiede queste
copie esterne. I sette test non dimostrano compilazione Linux, HTTP Range,
riproduzione, tempi di avvio o compatibilità iPhone.

Per regressione MusicBit restano `pnpm check` e `pnpm test:e2e`. Il report registra
anche l'adattamento esterno delle porte necessario sulla macchina dell'audit;
la configurazione originale non è stata modificata.
