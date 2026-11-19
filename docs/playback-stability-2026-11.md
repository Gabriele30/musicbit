# iPhone playback stability — 19 November 2026

This report separates demonstrated causes from hypotheses. Evidence comes
from production API logs (25–29 October), probes on the production server
with a dedicated test account (`claude_test`, empty library and cache), a
read-only copy of the listener's library used only for simulations, and the
automated suites. No listener data was modified.

## Demonstrated causes and fixes

### 1. First song slow or never starting

Production logs contain three continuous sessions (26, 27 and 29 October) in
which the first `index.m3u8` request never completed. The listener retried
after ~20 s and the next session played. Probes isolated the cause:

| Probe (uncached song, test account) | Before | After  |
| ----------------------------------- | ------ | ------ |
| First audio bytes, cold resolver    | 20.6 s | —      |
| Same song, warm resolver            | 0.6 s  | —      |
| First bytes right after API restart | —      | 1.35 s |
| First continuous manifest, uncached | —      | 4.0 s  |

The isolated provider process exited after 30 idle minutes, so the first tap
of a listening session paid the whole start-up (session, player script,
PoToken minter). Worse, **cancelling the only pending resolution killed the
process** (`ProviderProcess.resolve` → `close()`), so a rapid skip or a
superseded tap made the next song cold again. This links "new songs do not
start" with rapid skips from CarPlay.

Fix: cancellation forwards a cancel message and keeps the process; the API
warms the resolver at startup and whenever a signed-in app checks its
session; the idle lifetime is three hours and a self-recycled worker is
replaced warm. Regression tests cover both behaviors.

### 2. Permanent progressive fallback

Any native HLS start problem (an unseekable selection or a decoder
rejection) switched the app instance to per-song progressive sources for its
whole lifetime. Progressive playback needs JavaScript to assign the next
source at each song end. In an installed iOS web app this is a known, still
open WebKit defect ([261858](https://bugs.webkit.org/show_bug.cgi?id=261858):
the next track does not start while the app is in the background), which
matches the reported symptom: the lock screen advances while nothing is
heard, and the song starts from zero once the app is reopened. Logs from
26 October show progressive audio requests right after a stalled continuous
start.

Fix: the fallback still rescues the current selection, but an explicit
selection made ten minutes later returns to native continuous delivery.
Lock-screen and automatic transitions keep their transport.

This is a demonstrated mechanism for silent background transitions. It is
**not** proven to be the only one: see the open items.

### 3. Radio returning to the same songs

A simulation with the real catalog and the account library (30 refills, 90
songs per session) reproduced the complaint:

| Metric                                 | Before        | After   |
| -------------------------------------- | ------------- | ------- |
| Salmo share from a Salmo seed          | 44 / 90       | 20 / 90 |
| Same song under another upload id      | yes (CRUDELE) | none    |
| Longest run of one artist              | not bounded   | 1       |
| Max songs per artist in any 10         | not bounded   | 3       |
| Shared songs, first 12 of two sessions | about 8       | 2–4     |

Causes: secondary seeds were always the top three profile songs; the artist
cap applied only inside a three-song refill; exclusion compared ids. Radio
now seeds from the current song, a recent song of the session and a random
sample of the eight strongest profile seeds, balances artists over the last
ten songs, excludes songs by normalized identity, and removes candidates in
a failure backoff before ranking. Genre stayed within the listener's taste
(Salmo, Marracash, Gemitaiz, Toni Zeno, MadMan, Noyz Narcos, nayt).

### 4. Smaller fixes

- Client aborts were logged as `INTERNAL_ERROR`; they now return 499.
- The interface shows a loading ring and busy label instead of a pause icon
  that looked like playback, and says when audio stopped after an error.
- Fixed bars are opaque: in iPhone-sized WebKit, scrolling text was visible
  through the mini player and the navigation bar.

## Durations

All 375 cached files of the listener were probed with FFprobe: container,
stream and catalog durations agree; none is doubled. The "about seven
minutes" observation for _Nato per questo_ (226.9 s) equals two songs of the
continuous program (Nato + Stupido = 414 s) or a doubled file; neither the
file nor the current timeline mapping reproduces it. The existing
doubled-duration guard is kept.

## Device instrumentation

The core question — which transition survives a locked iPhone on the
listener's iOS version — cannot be answered on Windows. Two tools were added:

- **Remote diagnostics**: signed-in clients upload media-element facts
  (event, clock, readyState, visibility, catalog id) to a bounded per-account
  store (`/api/me/diagnostics`, 4 MB, rotated). No URLs, titles or
  credentials. The first deployment omitted the account request header and
  every upload was rejected; this was found by a browser check and fixed.
- **Locked-screen laboratory** (Settings → Diagnostica): three 20-second clips
  of the listener's own cached songs, five strategies (single HLS program,
  MSE buffer, pre-end swap, ended swap, loop wrap). It records whether the
  clock advanced into later clips while the page was hidden, plus what the
  listener heard.

## Open items (not demonstrated)

- Physical iPhone lock-screen and CarPlay behavior after these changes.
- Whether native continuous HLS itself ever stalls on a locked iPhone; the
  lab and the diagnostics are meant to answer it.
- The 4 s first manifest for uncached songs could be reduced by segmenting
  while downloading.

## Verification

- `pnpm check`: 392 tests in 58 files, lint, types, builds.
- `pnpm test:e2e`: 109 passed, 7 native HLS cases skipped on Windows WebKit.
- Deployed release `stability1-20261119` (web `index--YLqxRmo.js`), API and
  web healthy; rollback images `musicbit-{api,web}:before-stability1-20261119`.
