# Security policy

MusicBit is under active development. Security fixes target the current `main` branch.

## Report a vulnerability

Please use GitHub's private vulnerability reporting feature in the repository's **Security** tab when available. If it is unavailable, contact the maintainer through the contact details on their GitHub profile. Do not post exploit details, credentials or signed media URLs in a public issue.

Include the affected commit, reproduction steps, impact and a minimal example. There is currently no guaranteed response time or bug bounty program.

## Hosting boundaries

The default Docker deployment is bound to loopback. Accounts use salted password hashes, opaque HttpOnly sessions and separate server libraries. The HTTPS overlay requires authentication for catalog/audio, disables registration and uses Secure cookies. Account provisioning is explicit; no default credentials are shipped. See [accounts](docs/accounts.md).

The playback adapter evaluates upstream player/integrity scripts in a supervised child process, with a minimal environment, bounded concurrency, deadlines, a V8 heap cap and restricted filesystem access. SQLite, native addons, new child processes and filesystem writes are disabled there. These restrictions are tested but are not a complete hostile-code security boundary. Use OS/container isolation and a patched Node runtime; avoid access to unrelated sensitive services.

HTTPS is required for PWA installation and browser capabilities on remote devices. The supplied Caddy overlay also enables account requirements and closes registration. Catalog/audio request and connection limits apply, including warm streams. Configure additional bandwidth and network policy for your deployment.
