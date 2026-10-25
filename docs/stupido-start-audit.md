# STUPIDO starts near its end — 25 October 2026

The reported action was tapping the song in Home, rather than resuming the
remote listening banner. The account history identified the recording as
**STUPIDO — Massimo Pericolo, Crookers**, YouTube ID `zpRJGjYGtE0`.

The server's cached AAC file decodes completely without FFmpeg errors, has a
duration of 187.431474 seconds and no remaining
fragmented-AAC edit requiring the existing compatibility patch. The regression
was therefore investigated in start-position handling, without deleting the
user's cache or changing listening history.

## Reproduced start-state defect

Two deterministic engine regressions reconstructed an early `seeked` or
`timeupdate` at metadata-only readiness, followed by restoration of a cached
native clock at 184 seconds. The old engine accepted the early event as proof
that the new selection had reached zero, cleared its pending start seek, and
allowed the later clock to begin at 184 seconds. Both tests failed before the
change, receiving 184 instead of zero.

The engine now retains the pending seek when these events arrive before
playable media data. The subsequent native playing event can still correct the
cached clock to zero. The change does not add periodic seeks, replace the audio
element or move `play()` out of the user gesture.

The HLS manifest and its browser-test fixture now declare version 6, matching
the start and discontinuity-sequence features introduced in that protocol
revision. The precise zero-offset start hint remains present on a new playlist.
[Apple protocol-version documentation](https://developer.apple.com/documentation/http-live-streaming/about-the-ext-x-version-tag)
describes those feature introductions. This declaration is not treated as proof
that every native client will obey a preferred starting point.

## Verification and limits

- Before the fix: two targeted engine failures, both at 184 seconds.
- After the fix: all 55 engine tests pass; the complete `pnpm check` passes
  370 tests in 56 files, lint, types and builds.
- `pnpm test:e2e`: 109 browser tests passed; seven native HLS tests skipped on
  Windows WebKit because its decoder lacks the required support.
- Direct Playwright trials used the real cached STUPIDO file, selecting it from
  Home when idle and after seeking to 180 and 60 seconds. Each selected start
  was near zero. The naturally occurring iPhone event sequence was not captured;
  the reproduced late-clock ordering is a regression model, not a claim of
  physical iPhone reproduction.
- Test library, listening and playback-state writes remained isolated from the
  account; actual catalog and audio requests reached production.

The final API and web deployments reported healthy. A repeat against the new
production bundle selected STUPIDO from Home in all three scenarios, with first
confirmed-playing samples at 0.16, 0.05 and 0.06 seconds. All three checks passed
with nonzero decoded audio, one audio element and no media errors. The fetched
HLS playlist declared version 6. `after.json` records the deployed bundle and
these results.

Ignored local evidence: `artifacts/stupido-start/before.json`,
`regression-before.log`, `regression-after.log`, `check.log`, `e2e.log`,
`after.json`, and `profile-integrity.json`.
