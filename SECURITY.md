# Security policy

MusicBit is under active development. Security fixes target the current `main` branch.

## Report a vulnerability

Please use GitHub's private vulnerability reporting feature in the repository's **Security** tab when available. If it is unavailable, contact the maintainer through the contact details on their GitHub profile. Do not post exploit details, credentials or signed media URLs in a public issue.

Include the affected commit, reproduction steps, impact and a minimal example. There is currently no guaranteed response time or bug bounty program.

## Hosting boundaries

The default Docker deployment is bound to loopback. MusicBit does not include authentication, accounts or per-user isolation. Restrict access through a private network or an authenticated reverse proxy before making an instance reachable by others.

The playback adapter processes upstream player and integrity scripts in the API process. Further process isolation and resource controls are planned. Treat the provider integration as experimental; do not run it with access to unrelated sensitive services or credentials.

HTTPS is required for PWA installation and browser capabilities on remote devices. The supplied Caddy overlay adds TLS, but does not add authentication or rate limits per user.
