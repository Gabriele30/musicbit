# MusicBit development

- Work in this monorepo. Node 24 and pnpm 11; keep pnpm-lock.yaml committed.
- `apps/web` is the mobile PWA; `apps/api` is Fastify; `packages/shared` owns contracts.
- Run `pnpm check` and `pnpm test:e2e` for changes to playback or PWA behavior.
- Keep one HTMLAudioElement for the entire application lifetime. Never tie audio
  lifetime to a page, React render, navigation, or a service worker.
- Call `audio.play()` synchronously inside the user gesture path, before any await.
- Feature-detect Media Session and catch unsupported individual action handlers.
- YouTube Music playback is enabled: stream resolution and audio proxy (with HTTP Range
  support) are implemented in the backend to provide ad-free playback in the PWA.
- Favor AAC-LC (m4a, itag 140) audio streams for full cross-browser and iOS Safari compatibility.
- Enable search, queue management, background playback, and lock-screen controls in the PWA.
- Do not contact GitHub, push or create a PR unless the user changes that instruction.
