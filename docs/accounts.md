# Accounts, profiles and library recovery

Open the profile button in the top bar to sign in or create an account. Each account has a display name, a color and a separate server library. Guest listening remains available unless the host requires authentication.

## Persistent data

The API uses Node 24's built-in SQLite module. The production entry point stores the database in `data/musicbit.sqlite`, independent of the working directory. Set `MUSICBIT_DB_PATH` to override it. Docker uses `/data/musicbit.sqlite` on the `musicbit_data` volume; restarting or rebuilding containers preserves it. Removing the volume removes accounts and server libraries.

Passwords use salted scrypt hashes. Sessions are random opaque tokens, stored hashed in the database, valid for 30 days, with at most 20 sessions per account. Cookies are HttpOnly and SameSite=Strict; HTTPS writes also set Secure. A password change revokes all existing sessions and creates a new session for the current device. No account credentials are bundled in the app or seeded automatically.

Registration accepts usernames of 3–32 letters, numbers or underscores and passwords of 8–128 characters. Usernames are case insensitive. Set `AUTH_REGISTRATION=false` to close registration. Login and password operations have bounded attempts and concurrency.

For administrator-provisioned accounts, build the API and send an array of `{ "username": "...", "password": "..." }` objects through stdin to `pnpm accounts:create`. This explicit provisioning command can accept an administrator-chosen short initial password. It does not reset an existing account. Do not put credentials in tracked files or command history on shared machines. In Docker, pipe the same input to `docker compose exec -T api node scripts/create-accounts.mjs`.

## Synchronization and conflicts

Favorites, playlists, albums, followed artists, listening history and recommendation preferences are synchronized. Each write includes a revision. A stale write receives 409 and cannot overwrite the server library. The profile lets the listener export both versions and explicitly choose the local or server version. There is no automatic merge of concurrent edits.

The app checks for updates every 15 seconds while visible, and when it regains focus or connectivity. Pending edits remain in an account-specific browser cache. A conflict remains a conflict after reload. A request also identifies the expected account: changing the login in another tab cannot write the old account's data into the new one.

Guest data are not automatically uploaded. Use **Importa libreria ospite** in the profile to preview and explicitly import them. The guest copy remains separate. Playback queues and positions are cached per account on each browser and saved to the account for explicit **Riprendi qui** on another device; recent searches stay browser-local. Switching accounts stops the previous session while retaining the same lifetime audio element. Opening or restoring a session never starts playback automatically. See [listening features](listening-features.md).

## Backup

**Esporta backup** downloads a JSON library backup, without credentials or audio. **Importa backup** validates the file and shows collection counts before replacing the current library. Confirmation downloads the previous version first. Keep that downloaded copy; browser download restrictions can prevent automatic export.

Backups and writes have a roughly 5 MB limit in addition to collection limits. Oversized or malformed imports leave the library unchanged. Library backups do not back up account passwords or the account database. Protect server/database backups separately and use SQLite's backup facilities or stop the API before copying the database and its WAL files.

## Personal discovery

The **Scelti per te** shelf ranks provider radio/feed candidates using favorites, followed artists, recent listening, completion and skip signals. It removes duplicate titles for the same artist, excludes recently heard or dismissed tracks and limits repetition of one artist. The profile controls familiar/balanced/discovery preference. **Meno come questo** dismisses an individual track; preferences can be reset. This is a deterministic first version, not a trained recommendation model.

## Hosted instances

Set `MUSICBIT_REQUIRE_ACCOUNT=true` to require a session for catalog and audio, and `AUTH_COOKIE_SECURE=true` behind HTTPS. The HTTPS Compose overlay enables both and closes registration. Provision accounts before sharing access. API traffic is bounded to 240 catalog/audio requests per minute per account (or anonymous client address), eight active audio streams per client, and 64 globally. Reverse-proxy bandwidth policy remains an operator choice.

Audio resolution runs in a separate supervised Node process with a minimal environment, a 256 MB V8 heap limit, request deadlines and recycling. Filesystem writes, child processes, native addons and SQLite are disabled there; only code/dependency reads are allowed. The child receives video IDs, not sessions or profiles. Node permissions provide defense in depth, not a complete hostile-code sandbox: use OS/container isolation and a patched runtime for exposed deployments. See [security](../SECURITY.md).

Physical iPhone background playback, long sessions and performance targets still require device measurements. Accounts and desktop browser tests do not establish those results.
