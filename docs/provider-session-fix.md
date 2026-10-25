# Provider session correction — 25 October 2026

The repeated uncached-track failure was investigated without reading browser
profiles or printing session values. The configured server session produced:

- zero accounts from the WEB account list;
- `LOGGED_IN: false` on YouTube's ordinary homepage;
- `LOGIN_REQUIRED` from both Music and WEB players for Davide, with zero formats;
- the same outcome when reusing the homepage's returned client context.

These results establish that the imported session was not recognized at the time
of the check. They do not establish whether rotation, revocation or another Google
session restriction invalidated it. Browser authentication cannot be recreated
from an already invalid credential by retrying an audio request.

The previous connector exported from a normal browser that remained in use.
[YouTube.js authentication guidance](https://ytjs.dev/guide/authentication)
recommends exporting from an incognito session and closing it afterward to avoid
cookie rotation. The corrected flow follows that guidance:

1. Extension 1.0.2 uses split incognito mode and rejects normal-window exports.
2. The operator signs in personally in a dedicated incognito window, exports only
   YouTube authentication cookies and closes the window without signing out.
3. Before replacing the active session, a temporary container verifies the
   candidate account list and actual audio bytes for Davide and NEON.
4. Only a passing candidate is activated; the live isolated provider is checked
   again after activation. Account identities and credential values stay out of
   logs. Failed candidate validation does not replace the previous session.

A real-extension Chromium test used different fictitious cookies in its normal
and private stores. It confirmed that normal export is rejected, the private
export reads the private store rather than normal cookies, foreign cookies are
excluded, and a signed-out private window gets an explanatory error. This test
made no Google sign-in and used no real credentials.

An independent resolver defect was fixed too: a Music response with no audio
formats did not throw, so the previous exception-only WEB fallback never ran.
The resolver now tries the WEB player for empty or restricted Music responses,
while preserving a genuine authentication restriction when neither has audio.
Regression tests cover both restricted and unplayable Music responses.

The operator completed the dedicated private sign-in. Candidate and active-server
verification both recognized authentication and received real AAC audio for
Davide and NEON. An independent process afterward repeated both successfully.

## Extended verification after reconnection

- A fresh isolated resolver, without `AudioDiskCache`, resolved eighteen tracks
  by Gemitaiz, MadMan, Toni Zeno, Salmo, Marracash and their collaborators. The
  final matrix received HTTP 206 and 4,096 nonzero audio bytes at both the start
  and middle of every stream. This exercises upstream resolution even when an
  application audio file already exists on disk.
- The first matrix passed seventeen of eighteen. TRE SOGNI produced a transport
  `TypeError` in that probe and its immediate retry, without `LOGIN_REQUIRED`.
  Independent media requests subsequently returned valid audio, and the final
  eighteen-track matrix passed including TRE SOGNI. These failures are retained
  in the local evidence rather than counted as passes. Their precise transport
  cause was not established; the final probe follows media redirects as the PWA
  does and validates the final media hostname.
- The previously unavailable Geolier track **1H** also returned real range bytes
  in a separate new-process check.
- The production PWA played **Davide (feat. Coez)** and ten consecutive radio
  transitions. Every transition passed decoded-audio, native track identity,
  clock and single-element checks. Artists remained within Italian rap and its
  collaborations. UI navigation and audio/catalog requests were real; listening,
  library and playback-state test writes were held in the test browser only.
- The actual account's library remained byte-for-byte unchanged, at revision 150.

The deeper inspection also found a second resolver defect: invalidating a
rejected stream only cleared the API descriptor cache, leaving the same URL in
the worker cache. The supervisor now forwards a validated per-video eviction
over ordered IPC before resolving again. It does not restart the worker or cancel
other songs. Regression tests cover both cache layers and concurrent requests.

Validation after these changes: `pnpm check` passed **368 tests in 56 files**.
The final full browser run passed **109 tests** with seven explicit Windows
WebKit HLS skips, recorded in `e2e-refresh.log`.

After the final API deployment and process restart, another independent provider
check still reported authenticated and returned HTTP 206 AAC for Davide (206 s)
and NEON (207 s). API and web reported healthy. The existing PWA account session
survived the restart; after reload, ALL IN (Demo) resumed from 22.36 s against
22.34 s saved. Its subsequent eight-second sample had real decoded signal, no
rewinds and one audio element. `post-release-pwa.json` records that pass. The
earlier `post-release-pwa-early.json` sampled the loading phase before the native
HLS-to-AAC recovery completed; it is retained separately.

The previous authentication block was cleared in these real checks. Code alone
cannot recreate an invalid Google session, and a successful session is still
subject to Google's subsequent expiry or revocation.

Ignored local evidence: `artifacts/provider-session-fix/` and
`artifacts/provider-recovery/native-extension-tests/result.json`.
Detailed results: `fresh-streams-initial.json`, `fresh-streams-retry.json`,
`fresh-streams-final.json`, `radio-pwa.json`, and `profile-integrity.json` under
the session-fix evidence directory. No credential or signed URL is included.
