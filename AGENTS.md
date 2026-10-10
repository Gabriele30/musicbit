# MusicBit development

- Work in this monorepo. Node 24 and pnpm 11; keep pnpm-lock.yaml committed.
- `apps/web` is the mobile PWA; `apps/api` is Fastify; `packages/shared` owns contracts.
- Run `pnpm check` and `pnpm test:e2e` for changes to playback or PWA behavior.
- Keep one HTMLAudioElement for the entire application lifetime. Never tie audio
  lifetime to a page, React render, navigation, or a service worker.
- Call `audio.play()` synchronously inside the user gesture path, before any await.
- Feature-detect Media Session and catch unsupported individual action handlers.
- Use only explicitly authorized audio; preserve title, artist, source, permission
  and attribution. No unauthorized YouTube streaming or downloading.
- Do not cache/proxy remote music. Offline support covers only the app shell.
  M2 preparation is opt-in, through the same native audio element; disclose data use.
  Keep HLS experiments isolated in experiments/hls, using original authorized tones.
- Timing labels must state their actual meaning; `loadstart` is an event proxy for
  the request, `loadeddata` means first decoded data, not network first byte.
- Never claim iOS locked-screen, background track changes or CarPlay passed without
  recorded device evidence in `docs/ios-test-report.md`.
- No login, database, recommendations or HLS in the main player.
- M3 allows YouTube metadata only, isolated in YouTubeCatalogProvider. Never call
  getInfo/getBasicInfo/download/decipher, /player or media hosts. CatalogItem has
  no audioUrl and must never enter PlayerEngine. Keep authorized Track distinct.
- Catalog tests use deterministic mocks. Live service probes and p50/p95 benchmarks
  are explicit scripts, documented separately; never use them as CI requirements.
- Do not log search text, headers/cookies, raw YouTube errors or response bodies.
- Record before/after measurements and their limitations in docs/performance.md.
  Browser playing is not proof of audible physical output. Never hide preload cost.
- Do not contact GitHub, push or create a PR unless the user changes that instruction.
