import forge from 'node-forge';
import { createServer as createHttpsServer } from 'node:https';
import { request, createServer as createHttpServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { isIP } from 'node:net';

// Local test CA only. Never adds trust to Windows/iOS, never commits keys.
const directory = new URL('../artifacts/https/', import.meta.url);
const hosts = [
  ...new Set([
    'localhost',
    '127.0.0.1',
    ...Object.values(networkInterfaces())
      .flat()
      .filter((a) => a && a.family === 'IPv4' && !a.internal)
      .map((a) => a.address),
    ...(process.env.HTTPS_HOSTS?.split(',').filter(Boolean) ?? []),
  ]),
];
const appTarget = new URL(
  process.env.HTTPS_UPSTREAM ?? 'http://127.0.0.1:4173',
);
if (
  appTarget.protocol !== 'http:' ||
  !['127.0.0.1', 'localhost', '[::1]'].includes(appTarget.hostname)
)
  throw new Error('HTTPS_UPSTREAM must be a loopback HTTP service.');
await mkdir(directory, { recursive: true });
function certificate(keys, name, ca = false) {
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = `01${forge.util.bytesToHex(forge.random.getBytesSync(15))}`;
  cert.validity.notBefore = new Date(Date.now() - 300000);
  cert.validity.notAfter = new Date(Date.now() + (ca ? 365 : 30) * 86400000);
  cert.setSubject([{ name: 'commonName', value: name }]);
  cert.setExtensions(
    ca
      ? [
          {
            name: 'basicConstraints',
            cA: true,
            critical: true,
            pathLenConstraint: 0,
          },
          {
            name: 'keyUsage',
            keyCertSign: true,
            cRLSign: true,
            critical: true,
          },
        ]
      : [
          { name: 'basicConstraints', cA: false, critical: true },
          {
            name: 'keyUsage',
            digitalSignature: true,
            keyEncipherment: true,
            critical: true,
          },
          { name: 'extKeyUsage', serverAuth: true },
          {
            name: 'subjectAltName',
            altNames: hosts.map((host) =>
              isIP(host) ? { type: 7, ip: host } : { type: 2, value: host },
            ),
          },
        ],
  );
  return cert;
}
const caPath = new URL('root-ca.pem', directory);
let ca;
let caKey;
if (existsSync(caPath)) {
  ca = forge.pki.certificateFromPem(await readFile(caPath, 'utf8'));
  caKey = forge.pki.privateKeyFromPem(
    await readFile(new URL('root-ca-key.pem', directory), 'utf8'),
  );
} else {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  ca = certificate(keys, 'MusicBit development CA', true);
  ca.setIssuer(ca.subject.attributes);
  ca.sign(keys.privateKey, forge.md.sha256.create());
  caKey = keys.privateKey;
  await writeFile(caPath, forge.pki.certificateToPem(ca), { mode: 0o600 });
  await writeFile(
    new URL('root-ca-key.pem', directory),
    forge.pki.privateKeyToPem(caKey),
    { mode: 0o600 },
  );
  const der = forge.asn1.toDer(forge.pki.certificateToAsn1(ca)).getBytes();
  await writeFile(
    new URL('musicbit-root-ca.cer', directory),
    Buffer.from(der, 'binary'),
  );
}
const keys = forge.pki.rsa.generateKeyPair(2048);
const cert = certificate(keys, 'MusicBit local HTTPS');
cert.setIssuer(ca.subject.attributes);
cert.sign(caKey, forge.md.sha256.create());
const key = forge.pki.privateKeyToPem(keys.privateKey);
const pem = forge.pki.certificateToPem(cert);
await writeFile(new URL('server.pem', directory), pem);
await writeFile(new URL('server-key.pem', directory), key, { mode: 0o600 });
if (process.argv.includes('--cert-only')) {
  console.log(
    'CA and certificate ready in artifacts/https. No trust installed.',
  );
  process.exit(0);
}
const port = Number(process.env.HTTPS_PORT ?? 4443);
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error('HTTPS_PORT: 1–65535');
const server = createHttpsServer({ key, cert: pem }, (req, res) => {
  // Explicit loopback targets only. No arbitrary upstream URL / media proxy.
  const experiment = req.url?.startsWith('/__hls/');
  const target = experiment ? 'http://127.0.0.1:4180' : appTarget;
  let url;
  try {
    url = new URL(
      experiment ? req.url.slice('/__hls'.length) : req.url,
      target,
    );
  } catch {
    /* Reject malformed absolute-form requests without crashing. */
  }
  if (!url || url.origin !== new URL(target).origin) {
    res.writeHead(400);
    res.end('Only local application paths are accepted.');
    return;
  }
  const upstream = request(
    url,
    {
      method: req.method,
      headers: {
        ...req.headers,
        host: url.host,
        // The API is loopback-only, so it can safely use this signal to issue
        // a Secure cookie for requests that arrived through this TLS proxy.
        'x-forwarded-proto': 'https',
      },
    },
    (response) => {
      res.writeHead(response.statusCode ?? 502, response.headers);
      response.pipe(res);
    },
  );
  upstream.setTimeout(15000, () =>
    upstream.destroy(new Error('Upstream timeout')),
  );
  upstream.on('error', () => {
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain' });
    res.end('Avvia pnpm start (e pnpm experiment:hls per /__hls/).');
  });
  res.on('close', () => upstream.destroy());
  req.pipe(upstream);
});
server.listen(port, '0.0.0.0', () => {
  console.log(
    'MusicBit HTTPS test server. Trust artifacts/https/musicbit-root-ca.cer on the test device first.',
  );
  for (const host of hosts)
    console.log(`https://${host}:${port}/?screen=diagnostics`);
  console.log('Ctrl+C stops HTTPS. CA keys stay ignored in artifacts/https.');
});
if (process.argv.includes('--share-ca')) {
  const publicCertificate = await readFile(
    new URL('musicbit-root-ca.cer', directory),
  );
  createHttpServer((req, res) => {
    if (req.url !== '/musicbit-root-ca.cer') {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, {
      'content-type': 'application/x-x509-ca-cert',
      'content-disposition': 'attachment; filename="musicbit-root-ca.cer"',
      'cache-control': 'no-store',
    });
    res.end(publicCertificate);
  }).listen(4444, '0.0.0.0', () =>
    console.log(
      'Public CA ONLY: http://<LAN-IP>:4444/musicbit-root-ca.cer. Stop after installation.',
    ),
  );
}
