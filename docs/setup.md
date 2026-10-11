# Setup and hosting

## Local development

Install Node.js 24.x and pnpm 11.25.0. From the repository root:

```sh
pnpm install --frozen-lockfile
cp .env.example .env
pnpm dev
```

On PowerShell, replace `cp` with `Copy-Item`. Copy the file only on the first run. The web interface defaults to `http://localhost:4175`, and API health is at `http://127.0.0.1:3001/health`.

| Setting                   | Default in `.env.example` | Purpose                                                    |
| ------------------------- | ------------------------- | ---------------------------------------------------------- |
| `WEB_DEV_PORT`            | `4175`                    | Vite development port                                      |
| `API_HOST`                | `127.0.0.1`               | API bind address                                           |
| `API_PORT`                | `3001`                    | API port                                                   |
| `API_PROXY_TARGET`        | `http://127.0.0.1:3001`   | Vite API proxy; keep in sync with API port                 |
| `YOUTUBE_CATALOG_ENABLED` | `true`                    | Enable the catalog adapter; independent of the audio proxy |
| `CATALOG_TTL_MS`          | `300000`                  | Metadata memory-cache lifetime                             |
| `CATALOG_TIMEOUT_MS`      | `10000`                   | Metadata request timeout                                   |
| `WEB_PORT`                | `8080`                    | Docker web port, bound to loopback                         |

Other variables in `.env.example` configure the separate experimental laboratories. They are not required for the main application. Do not commit `.env` or generated certificates.

## Production build locally

```sh
pnpm build
pnpm start
```

Vite preview serves the built PWA at `http://localhost:4173`. It is intended for local verification. The service worker caches the app shell only; music needs a network connection.

## Docker

```sh
docker compose up --build -d
docker compose ps
```

Visit `http://localhost:8080`. Nginx serves the frontend and proxies API requests to Fastify on the internal Compose network. The API has no published host port.

```sh
docker compose logs --tail=100
docker compose down
```

## Hosting and HTTPS

Choose a host you control and restrict access to your instance. MusicBit does not supply authentication or user isolation. Review [SECURITY.md](../SECURITY.md) before hosting.

For a domain pointing to the server, set `MUSICBIT_DOMAIN` and `ACME_EMAIL` in `.env`. The included overlay publishes ports 80 and 443 through Caddy:

```sh
docker compose -f compose.yaml -f compose.https.yaml config --quiet
docker compose -f compose.yaml -f compose.https.yaml up --build -d
```

This overlay provides TLS only. Add private-network access or authentication at the reverse proxy before exposing the service. Allow certificate issuance and HTTPS traffic through your network configuration.

On a phone, use an HTTPS origin with a certificate the device trusts. A desktop's `localhost` exception does not apply to an HTTP LAN address on the phone. The [iPhone HTTPS notes](ios-https.md) describe local device testing.

## Test ports

Playwright starts its own production-build host and laboratory servers. On systems with reserved port ranges, override `MUSICBIT_E2E_PORT`, `MUSICBIT_PLAYBACK_E2E_PORT` and `MUSICBIT_YOUTUBE_E2E_PORT` in the shell. For example, PowerShell:

```powershell
$env:MUSICBIT_E2E_PORT = '4704'
$env:MUSICBIT_PLAYBACK_E2E_PORT = '4706'
$env:MUSICBIT_YOUTUBE_E2E_PORT = '4708'
pnpm test:e2e
```
