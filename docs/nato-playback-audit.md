# Native continuous playback recovery — 25 October 2026

The reported recording is **Nato Per Questo (Visual) — Club Dogo,
Marracash**, catalog ID `DKcVrwXP5c8`. The user saw approximately seven
minutes both in MusicBit and on the lock screen while the next song was silent;
foregrounding the PWA restored playback from zero.

## Findings and changes

The cached AAC-LC recording fully decodes without FFmpeg errors. Its actual
duration is 226.858957 seconds. It does not require the existing fragmented-MP4
compatibility patch. No cache deletion or listening-history reset was used.

A deterministic engine regression exposed a separate delivery defect: the
unseekable-live watchdog abandoned healthy native HLS after 2.5 seconds even
when playback was advancing normally. That permanently selected progressive
per-song delivery for the current application instance. The watchdog now
requires an unsettled start/resume/selection before recovering to progressive
AAC. Healthy HLS remains native across track boundaries. Explicit unsupported
seeks and genuine decoder failures retain their recovery paths.

MPEG-TS timestamp rounding also occasionally added one entire AAC frame per
segment to the application timeline. The parser now tolerates timestamp
quantization around an exact frame boundary. The actual cached recording's HLS
timeline changed from 227.973515 to 226.882177 seconds, within one AAC frame of
the source duration. This fixes accumulated drift; it does not establish that
rounding alone caused the reported seven-minute display.

The Home filter row is also bounded to its container and can scroll horizontally
on narrow phones, addressing the overflow seen in Linux WebKit validation.

Repeated real-browser reloads exposed another server failure: abandoned native
sessions occupied the two-session account limit for twenty minutes. Subsequent
plans returned 409 and their playlists returned 503. Continuous plans now carry
the same window identity used for cloud listening. A new stream replaces only
that authenticated window's previous stream, retaining another device's or
another account's audio. The field is optional for older clients; the existing
global and per-account limits remain enforced.

## Verification

- The healthy-HLS engine regression failed against the previous watchdog and
  passes with the fix. Two additional cases retain recovery for stalled starts
  and resumes at zero and sixty seconds.
- `pnpm check`: 374 tests in 56 files, lint, type checks and production builds pass.
- `pnpm test:e2e`: 109 passed; seven native HLS cases skipped on Windows WebKit
  where the required decoder is unavailable.
- The browser regression keeps a real native HLS source beyond the watchdog
  interval and checks that an unsupported explicit seek still recovers to AAC.
- The server deployment preserves the dedicated YouTube session and provides
  backup images for rollback; API and web containers report healthy.
- Session regressions cover repeated reload replacements, independent windows,
  another account using the same local identity, and the retained capacity limit.

## Real-recording browser trial

An isolated copy of the actual account library queued **STUPIDO — Massimo
Pericolo, Crookers** followed by **Nato Per Questo (Visual)**. Catalog and audio
requests reached production; listening, library and cloud playback writes were
intercepted locally. The actual account library remained identical at revision
166 during the trial.

The unmodified live-playlist attempts did not pass: Chromium's native decoder
requested trailing segments and later underflowed, or recovered to progressive
AAC. The failed attempts are retained as evidence, not counted as successes.
The successful recording trial delayed initial playlist delivery until both
actual tracks were prepared and the finite manifest was complete. It verifies
that controlled case, not production live-radio behavior on Windows.

At normal speed the native clock reached 180.021 seconds. JavaScript execution
was then disabled for twenty seconds across the natural boundary at 187.478.
After resumption the same HLS source had reached 201.263 seconds, with one audio
element, no media error, no seek and no reset to zero. Both the visible mini
player and Media Session identified Nato Per Questo. Media Session published
226.882 seconds as its duration and approximately 13.6 seconds as its position,
rather than publishing the full 414-second two-track timeline.

These are native decoder and clock observations, supported by complete source
file decoding. No physical speaker output or locked iPhone was measured.
Ignored evidence is under `artifacts/nato-playback/`, including the failed live
attempts, the successful finite transition, profile integrity and deployment
logs.

After the final deployment, three consecutive real PWA reloads and playlist
starts each received HTTP 200 for their new continuous plan. The second and
third starts retained the same window identity and the superseded session
returned 404 immediately. The actual account library was unchanged. Both final
containers reported healthy; the served web build is `index-Dh8YZCPT.js`.

Physical iPhone lock-screen and CarPlay scheduling cannot be established by
Windows viewport emulation or Chromium script suspension. These changes correct
reproduced engine and timeline defects without claiming that every iOS playback
failure has been reproduced or eliminated.
