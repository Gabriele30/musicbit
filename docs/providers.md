# Providers, privacy and local data

## Catalog and playback

MusicBit uses an unofficial YouTube Music adapter through `youtubei.js`. The API normalizes metadata, resolves audio streams and proxies media to the browser with HTTP Range support. AAC-LC/m4a is preferred for browser compatibility.

Availability depends on the upstream service and network conditions. A catalog result does not guarantee that its audio will be playable. Provider changes, regional restrictions or requests for authentication can cause failures.

`YOUTUBE_CATALOG_ENABLED=false` disables metadata discovery. It does **not** disable the independent audio proxy. The SoundHelix demo catalog remains available under diagnostics or the explicit demo player route.

## Data flow

- Searches and catalog requests go to the MusicBit API and then to the upstream provider.
- Cover images are requested by the browser from provider image hosts, without a referrer.
- Catalog metadata and resolved stream descriptors use bounded, expiring memory caches on the API.
- Guest libraries remain local. Signed-in favorites, playlists, saved albums, followed artists, history and recommendation preferences also reside in the self-hosted account database. Browser caches, recent searches and playback sessions are separated per account.
- Recent searches are recorded when a query is submitted or a result is opened or played. They can be removed individually or cleared together.
- The service worker caches application files and bundled artwork. It does not store audio or API responses for offline playback.
- The included API and Nginx logging configuration omits query strings and raw upstream error payloads. Additional proxies or hosting software need their own configuration.

Account synchronization uses your MusicBit server, not a third-party cloud service. There are no analytics SDKs. Clearing browser storage removes guest data and local queues; signed-in libraries can be recovered from the server or a JSON backup. Guest migration requires explicit import. See [accounts and recovery](accounts.md).

## Content and attribution

MusicBit is independent of YouTube, Google and Spotify. Dependency licenses apply to their code; they do not license catalog content, recordings or artwork. Content and trademarks belong to their respective owners. Review the provider's terms and use content you have permission to access.

See [third-party notices](../THIRD_PARTY_NOTICES.md) for dependency and demo attribution, and [security](../SECURITY.md) for hosting boundaries.
