# Server audio cache

MusicBit keeps up to **5 GB (5,000,000,000 audio bytes) per authenticated account** in persistent storage. Docker stores it under `/data/audio-cache` in the existing data volume. Native installations use `audio-cache` beside the account database; `MUSICBIT_AUDIO_CACHE_PATH` overrides the location. Tests using an in-memory database disable disk caching.

The player sends a small authenticated queue hint: the current song, the next ten songs in playback order, and the two preceding songs. Repeat, shuffled queues and autoplay recommendations follow the actual queue. These are server downloads: the phone does not download ten extra songs. Separate device hints remain active for thirty minutes and are refreshed while the app is running. The first visible song is also warmed after its metadata resolves.

The browser also prepares the immediate successor during playback, using the existing bounded 16 MiB prefetch. This additional single-song transfer is intentional: having a file on the server does not prepare the phone's HTTP connection for a background source change. Account cache hints never disable this preparation. It does not create another audio element, start playback early, use Blob URLs or provide offline downloads.

Two downloads run at most across all accounts. Each has a two-minute deadline and a 64 MiB size limit. Older songs remain cached for fast replays; when the account reaches its quota, the least recently used songs outside active listening windows are removed. If active windows fill the quota, new downloads are skipped rather than repeatedly evicting and downloading current songs. Failed downloads have a one-minute retry delay. Temporary files count toward admission, and downloading stops when the filesystem has less than 1 GiB plus download headroom available.

Only complete files become playable cache entries. AAC compatibility corrections are applied before saving, preserving the fix for doubled durations and silent tails. Signed upstream URLs and authentication tokens are never written to cache metadata. Cached files survive container restarts and support full, suffix and partial HTTP Range requests and HEAD without another upstream resolution. Missing, truncated and unfinished entries are discarded when an account's cache is opened.

Background downloads request an explicit byte Range. A partial response is accepted only when its declared range covers the entire file, its length matches, and the body finishes at that exact length. This avoids publishing truncated slices and avoids the slow full-response transfer observed during server verification.

`GET /api/me/audio-cache` reports `enabled`, `bytes`, `quotaBytes`, `tracks` and `preparing` for the signed-in account. Queue hints use `POST` on the same endpoint with the normal account and cross-site request protections. Account directories are isolated. Clearing browser data does not clear server audio, and server caching does not provide offline playback on the phone.

The first request for an uncached song can still require provider resolution. Foreground streaming never waits for an entire cache download to finish; failure of a background job does not interrupt native playback. iPhone lock-screen continuity still needs physical-device confirmation after each playback release.
