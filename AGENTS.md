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
- Do not cache audio or proxy media in M1. Offline support covers only the app shell.
- Timing labels must state their actual meaning; `loadstart` is an event proxy for
  the request, `loadeddata` means first decoded data, not network first byte.
- Never claim iOS locked-screen, background track changes or CarPlay passed without
  recorded device evidence in `docs/ios-test-report.md`.
- No login, database, recommendations, HLS or YouTube integration in M1.
- Do not contact GitHub, push or create a PR unless the user changes that instruction.
