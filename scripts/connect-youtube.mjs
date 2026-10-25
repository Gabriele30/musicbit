import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parseProviderSession } from '../apps/api/dist/audio/provider-session.js';

// No controlled browser or access to browser profiles: the operator selects
// an explicitly exported YouTube session file in their normal browser.
const args = process.argv.slice(2);
const target = args[args.indexOf('--ssh') + 1];
if (
  !args.includes('--ssh') ||
  !target ||
  !/^[a-zA-Z0-9][a-zA-Z0-9_.@-]+$/.test(target)
) {
  console.error('Uso: pnpm youtube:connect --ssh utente@server');
  process.exit(1);
}
function ssh(command, input = '') {
  return new Promise((done, fail) => {
    const child = spawn(
      'ssh',
      ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', target, command],
      { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
    );
    let output = '',
      error = '';
    child.stdout.on('data', (data) => {
      if (output.length < 16384) output += data;
    });
    child.stderr.on('data', (data) => {
      if (error.length < 16384) error += data;
    });
    child.on('error', () => fail(new Error('Accesso SSH non disponibile.')));
    const timeout = setTimeout(() => {
      child.kill();
      fail(new Error('Il server non ha completato il collegamento.'));
    }, 180000);
    child.on('close', (code) => {
      clearTimeout(timeout);
      if (code === 0) done(output);
      else
        fail(
          new Error(
            'Il server non ha completato il collegamento. Verifica configurazione e accesso SSH.',
          ),
        );
    });
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}
await ssh(
  'test -f "$HOME/musicbit/compose.youtube-session.yaml" && test -f "$HOME/musicbit-youtube-verify.mjs" && docker run --rm --network none --entrypoint test musicbit-api -f /app/apps/api/dist/audio/provider-session.js',
);
const candidates = [
  process.env.MUSICBIT_CONNECT_BROWSER,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean);
const executable = candidates.find(existsSync);
if (!executable)
  throw new Error(
    'Chrome o Edge non trovato. Imposta MUSICBIT_CONNECT_BROWSER.',
  );
const nonce = randomBytes(24).toString('hex');
let busy = false;
const extensionFolder = fileURLToPath(
  new URL('../tools/youtube-session-extension/', import.meta.url),
);
const safeFolder = extensionFolder
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('"', '&quot;');
const html = `<!doctype html><html lang="it"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Collega YouTube · MusicBit</title><style>body{margin:0;background:#050505;color:#f5f5f5;font:18px system-ui;padding:5vh 24px}main{max-width:720px;margin:auto}h1{font-size:36px}p,li{line-height:1.6;color:#ccc}li{margin:18px 0}code{word-break:break-all;font-size:14px}a,button{display:inline-block;background:#dafa91;color:#101010;border:0;border-radius:25px;padding:13px 20px;font:600 16px system-ui;text-decoration:none;cursor:pointer;margin:8px 8px 8px 0}button:disabled{opacity:.5}input{display:block;margin:15px 0;max-width:100%}#status{white-space:pre-wrap}</style><main><p>MusicBit · collegamento privato</p><h1>Collega una sessione dedicata</h1><p>La vecchia sessione non è più riconosciuta da Google. Usa una finestra in incognito dedicata a MusicBit, così il Chrome abituale non continua a modificarla. L’accesso a Google lo effettui personalmente.</p><ol><li>Nella scheda <strong>Estensioni</strong>, attiva <strong>Modalità sviluppatore</strong>, premi <strong>Carica estensione non pacchettizzata</strong> e scegli questa cartella. Se è già caricata premi <strong>Ricarica</strong>. In <strong>Dettagli</strong> abilita <strong>Consenti modalità incognito</strong>:<br><code id="folder">${safeFolder}</code><br><button id="copy">Copia cartella</button></li><li>Apri una nuova finestra in incognito con <strong>Ctrl+Maiusc+N</strong> e vai su <strong>youtube.com</strong>. Accedi a Google personalmente. Da quella finestra apri <strong>MusicBit · collega YouTube</strong> e premi <strong>Esporta per il mio server</strong>.<br>Dopo l’esportazione <strong>chiudi tutte le finestre in incognito senza fare logout da YouTube</strong>. Torna poi a questa pagina nel browser normale.</li><li>Scegli qui il file <strong>youtube.cookies</strong> appena esportato e collega il server <strong>${target}</strong>.</li></ol><input id="session" type="file" accept=".cookies,.txt" aria-label="File privato della sessione YouTube"><button id="connect">Collega al server</button><p id="status" role="status">Il file è una credenziale privata. Non inviarlo in chat; dopo l’importazione puoi eliminarlo e rimuovere l’estensione.</p></main><script>document.querySelector('#copy').onclick=()=>navigator.clipboard.writeText(document.querySelector('#folder').textContent);const b=document.querySelector('#connect'),s=document.querySelector('#status');b.onclick=async()=>{const f=document.querySelector('#session').files[0];if(!f||f.size>65536){s.textContent='Scegli il file youtube.cookies esportato, massimo 64 KiB.';return;}b.disabled=true;s.textContent='Collegamento e verifica audio in corso…';try{const r=await fetch('/connect',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:'${nonce}',session:await f.text()})});const d=await r.json();s.textContent=d.message;if(!d.ok)b.disabled=false;}catch{s.textContent='Collegamento interrotto. Riprova.';b.disabled=false;}};</script></html>`;
let origin;
const server = createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  if (req.headers.host !== new URL(origin).host) {
    res.writeHead(403).end();
    return;
  }
  if (req.method === 'GET' && req.url === '/') {
    res
      .writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      .end(html);
    return;
  }
  if (
    req.method !== 'POST' ||
    req.url !== '/connect' ||
    req.headers.origin !== origin
  ) {
    res.writeHead(403).end();
    return;
  }
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 132096) {
      res.writeHead(413).end();
      return;
    }
  }
  let allowed = false;
  let imported;
  try {
    const data = JSON.parse(body);
    allowed = data.token === nonce;
    imported = data.session;
  } catch {
    // Invalid local requests are rejected below.
  }
  if (!allowed || busy) {
    res.writeHead(403).end();
    return;
  }
  busy = true;
  try {
    if (typeof imported !== 'string') throw Error('Invalid session');
    const cookie = parseProviderSession(imported);
    await ssh(
      `set -eu
umask 077
mkdir -p "$HOME/.config/musicbit"
chmod 700 "$HOME/.config/musicbit"
session_tmp=$(mktemp "$HOME/.config/musicbit/youtube.cookies.XXXXXX")
trap 'rm -f "$session_tmp"' EXIT
cat > "$session_tmp"
chmod 600 "$session_tmp"
docker run --rm --network bridge --entrypoint node \
  -e YOUTUBE_COOKIE_FILE=/run/secrets/musicbit-youtube.cookies \
  -v "$session_tmp:/run/secrets/musicbit-youtube.cookies:ro" \
  -v "$HOME/musicbit-youtube-verify.mjs:/app/apps/api/musicbit-youtube-verify.mjs:ro" \
  -w /app/apps/api musicbit-api /app/apps/api/musicbit-youtube-verify.mjs
mv "$session_tmp" "$HOME/.config/musicbit/youtube.cookies"
cd "$HOME/musicbit"
set -- -f compose.yaml
if [ -f compose.local-ai.yaml ]; then set -- "$@" -f compose.local-ai.yaml; fi
MUSICBIT_YOUTUBE_SESSION_FILE="$HOME/.config/musicbit/youtube.cookies" docker compose "$@" -f compose.youtube-session.yaml up -d --no-build --no-deps --force-recreate --wait --wait-timeout 90 api >/dev/null
docker exec -i -w /app/apps/api musicbit-api-1 node --input-type=module < "$HOME/musicbit-youtube-verify.mjs"`,
      cookie,
    );
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(
      JSON.stringify({
        ok: true,
        message:
          'Sessione dedicata riconosciuta da Google. Davide e NEON sono stati verificati con audio reale prima e dopo il collegamento al server. Puoi chiudere questa finestra.',
      }),
    );
    console.log('YouTube collegato e prova audio superata sul server.');
  } catch {
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(
      JSON.stringify({
        ok: false,
        message:
          'Collegamento non confermato. Google deve riconoscere la sessione dedicata e fornire entrambi i brani. Riesporta dalla finestra in incognito, chiudila senza fare logout e riprova. Un file rifiutato prima del collegamento non sostituisce la sessione precedente.',
      }),
    );
    console.log('Collegamento non completato: nessuna conferma di sblocco.');
  } finally {
    busy = false;
  }
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
origin = `http://127.0.0.1:${server.address().port}`;
// Open the regular browser without debugging, automation, or a custom profile.
const native = spawn(executable, [origin, 'chrome://extensions'], {
  windowsHide: false,
  stdio: 'ignore',
});
native.unref();
const expiry = setTimeout(() => {
  server.close();
  console.log(
    'Pagina di collegamento scaduta. Riapri il connettore per riprovare.',
  );
}, 30 * 60000);
expiry.unref();
process.on('SIGINT', () => server.close());
console.log(
  'Collegamento aperto nel browser normale. Segui i passaggi per l’estensione locale e importa il file privato.',
);
console.log(`Pagina locale di collegamento: ${origin}/`);
