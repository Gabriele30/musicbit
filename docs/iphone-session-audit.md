# Playback and radio audit — 25 October 2026

The investigation used the production API logs and the account's synchronized
playback/library state. These sources describe server requests and saved state;
they do not provide a live view of the physical iPhone or its speaker output.
Tests isolate listening and library writes to preserve the real taste profile.

## Failures observed

Four requests for valid HLS segments returned HTTP 429 during the listening
session. In one minute, Safari requested approximately 230 segments while
preloading the native program. The shared 240-request catalog allowance also
counted playlists and other API calls, interrupting an otherwise valid stream.

HLS delivery now has a separate, bounded allowance of 1,200 requests per minute.
It still requires authentication when hosted access is enabled and participates
in the existing concurrent-stream limits. Catalog and search retain their own
240-request allowance. The regression exhausts both allowances independently
and checks that anonymous media access remains blocked.

Two recordings also failed through the progressive proxy:

- **RAPTILIAN FREESTYLE — Salmo** (`UPOl7EIOnRM`): repeated fresh descriptors
  still returned 403. A controlled provider comparison returned 403 for the
  original direct AAC URL and 206 with 65,536 audio bytes after the player's
  `n` transformation. The resolver previously transformed signature ciphers but
  skipped direct URLs containing encrypted `n`. It now transforms both forms.
- **YOSHI (prod. Strage) (feat. Fabri Fibra) — MACHETE, Dani Faiv, tha Supreme**
  (`ZHKO8pxU4mE`): logs showed transport failures; two fresh checks subsequently
  returned 206 with audio. Proxy and disk prefetch now each retry one transport
  failure before headers with a fresh descriptor, respecting cancellation.
  Permanent failures remain bounded and visible.

Some error-level entries belonged to requests canceled during navigation. They
are not counted as evidence that the server crashed. The containers were healthy
with zero restarts, and disk capacity was sufficient.

## Radio diversity

The cached fallback excluded only the last three program tracks. A longer cache
could therefore cycle through a small high-ranked group. It now excludes the
complete retained program and recent window before considering repeats. If the
available pool is exhausted, it returns the oldest program entries rather than
immediately replaying the newest favorites.

Radio ranking adds bounded variation among similarly relevant candidates.
Ordinary Home/library ranking stays deterministic; blocked artists, dismissals,
duplicate identities and artist caps remain enforced. Secondary radio seeds
prefer listening records outside the queued/excluded set. Native preparation
also skips candidates already in a temporary failure backoff before taking its
six-candidate preparation window, so unavailable top results cannot hide usable
ones below them.

Regression coverage includes exhausting 24 cached tracks before repeating,
varying an equally relevant pool, moving past exhausted seeds, six unavailable
candidates before a usable seventh choice, native HLS continuity, bounded retry
and the actual encrypted-`n` descriptor shape.

## Validation

`pnpm check` passes lint, type checking, 380 tests in 56 files and production
builds. The complete browser suite and post-deployment recording checks are
recorded in the current validation report. Private logs, account snapshots,
media files and browser evidence stay under the ignored
`artifacts/current-session-audit/` directory.

Post-deployment checks returned 206 and 65,536 audio bytes in two fresh
resolutions of each failed recording. A real-account Playwright trial then
passed eight alternating selections of these tracks, seek/reselection and
0.75–1.5x playback-rate changes, retaining one audio element. Six requests for
radio from the same seed produced six different leading orders. The real
account library remained unchanged at revision 187.

The Windows native HLS decoder received a finite two-track playlist only after
both recordings were prepared; this controlled trial does not establish live
radio or physical iPhone lock-screen behavior. The complete local browser suite
passed 109 tests with seven unsupported native WebKit HLS cases skipped.
