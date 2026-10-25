# Real-account listening audit — 25 October 2026

Follow-up: the dedicated-session reconnection subsequently restored recognized
Google authentication. Eighteen fresh resolutions and ten real PWA radio
transitions passed. See [provider-session-fix.md](provider-session-fix.md).
The restriction described below records the earlier failed session.

The production account was exercised with real catalog responses and real audio.
Listening stayed within MadMan, Gemitaiz, Toni Zeno, Salmo, Marracash and related
Italian rap. No Google credentials, signed media URLs or private account snapshots
are included in this document.

## Protecting the taste profile

Three complete songs were played normally on the actual account: **Blue Sky**,
**DISISA**, and **IL CIELO NELLA STANZA (feat. NSTASIA)**. Their native durations
total approximately 620.7 seconds. The application advanced between songs without
manual seeking. Samples checked clock progression, the active media source and
nonzero decoded audio signal.

The heavy skip/rate/shuffle tests used a separate authenticated browser. Catalog
and audio requests reached production; library, listening-event and playback-state
writes were intercepted and retained only in that browser's test host. Thus these
experiments did not teach the actual account to dislike the tested artists.

The account comparison after the normal session showed **three additional
completions and zero additional skips**. Favorites, playlists, followed artists and
explicit artist preferences were unchanged.

## Stress coverage

- Sixteen real tracks passed clock, source, error and decoded-signal checks.
- Playback speeds: 0.75, 1, 1.25, 1.5 and 2.
- Forty shuffle actions produced forty different orders, preserving queue contents
  and the current track.
- Eighty rapid Media Session actions exercised the application's registered
  previous/next handlers. The final source and audio signal were correct.
- Pause/resume, deliberate seeks, replaying a previous track from zero and a
  five-second offline interval with buffered audio passed.
- The same single audio element remained connected during the stress session.

These are browser tests with an iPhone-sized viewport. They do not establish
physical iOS lock-screen or CarPlay behavior.

## Reproduced defects and fixes

1. **Radio refill rejected an entire batch.** An old saved track with a local
   placeholder cover was converted into a network catalog item. The strict client
   rejected that item and discarded valid neighbors. Cached tracks now go through
   explicit catalog normalization; the client retains independently valid items.
2. **Cached radio exhausted its highest-ranked window.** Ranking before excluding
   queued songs could hide usable tracks beyond the first twelve results. Queue
   exclusions now happen before ranking, including semantic duplicate checks.
3. **Discovery could accept unrelated model output.** Catalog existence alone does
   not prove musical affinity. AI discovery now selects only from verified related
   artists of the account's positive listening seeds.
4. **Missing metadata became a taste seed.** The localized missing-artist label is
   excluded from the taste profile and personalized candidate ranking.
5. **Reload could strand an otherwise playable cached song.** A native HLS
   format/decode rejection stopped the player without trying its AAC source.
   Both media error codes 3/4 and `play()`'s `NotSupportedError` now trigger one
   progressive fallback, retaining the requested position and play intent even
   when the browser has already paused the rejected element. Subsequent AAC
   failure surfaces normally; there is no retry loop or extra audio element.

6. **A later HLS preparation error stopped a prepared current song.** A timeline
   error now stops the player only when the selected song has no prepared target.
   Otherwise playback continues and exposes the preparation warning. This also
   allows the native-format fallback to recover the current cached AAC normally.

Regression validation: `pnpm check` passed **364 tests in 56 files**, including
lint, types and production builds. `pnpm test:e2e` passed **109 tests** with seven
explicit HLS skips on Windows WebKit.

## External restriction remains reproducible

The earlier successful authenticated checks of **Davide** and **NEON** were not
durable. During this longer audit both fresh resolutions failed again; YouTube
reported `LOGIN_REQUIRED` and requested a bot-verification sign-in. The same
failure occurred with fresh provider processes and both session-generation modes.
The private session file was still configured. These observations do not prove
that the operator logged out or that the session expired.

Cached audio continued to play, but reliable access to every uncached track is
**not established**. This must remain an open issue rather than being reported as
fixed after a short successful request.

The first production replay after the radio fixes played **Dancing With The Devil
Pt.2** and **Panico (feat. Neffa)** successfully, then failed loading **1H** by
Geolier. Returning to cached Panico recovered real audio. Reloading that paused
session exposed the additional HLS rejection defect above. The report retains
these failures rather than counting incomplete scenarios as passes. The final
independent provider recheck after deployment again failed both Davide and NEON.

## Final production replay

The final player was deployed with rollback images retained; API and web both
reported healthy. Replaying the same queue with cached **Panico** followed by
unavailable **1H** now kept Panico playing. Decoded audio was nonzero and its
clock did not rewind. Pausing, reloading, and resuming preserved the selected
track and its approximately twelve-second position. The test verified the track
ID against the real HLS timeline, allowing either supported delivery format.

All seven checks in `resume-final.json` passed, including player layouts at
320×780, 390×844, 430×932 and 844×390 without horizontal overflow. Portrait and
landscape screenshots were also inspected. This replay confirms recovery of the
available current track; it does not claim the unavailable next track was played.

Local evidence is ignored by Git under `artifacts/deep-account-audit/`:
`human-session.json`, `stress-session.json`, `radio-resume.json` (the original
refill failure), `radio-release.json` (the subsequent unavailable-track case),
`resume-release.json` (the reproduced reload failure), `profile-integrity.json`,
`resume-final.json`, `check-native-fallback.log`, and `e2e-native-fallback.log`.
Private snapshots stay local. No GitHub operation was performed.
