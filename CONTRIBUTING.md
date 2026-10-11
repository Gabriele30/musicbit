# Contributing to MusicBit

Thanks for helping improve MusicBit. Small, focused changes are easier to review and maintain.

## Set up

Use Node.js 24 and pnpm 11.25.0. Follow the [README](README.md#get-started), then run:

```sh
pnpm check
pnpm exec playwright install chromium webkit
pnpm test:e2e
```

On Linux, install Playwright with `--with-deps`. Commit `pnpm-lock.yaml` when changing dependencies. Use `pnpm exec prettier --write <files>` to format changed files.

## Before making a change

Check existing issues. For a substantial feature, describe the problem, proposed behavior and tradeoffs in an issue first. Bug fixes should include the steps to reproduce and a regression test when the behavior warrants one.

The interface currently uses Italian copy. Keep new labels consistent and avoid introducing technical details into everyday listening flows. Screenshots at a narrow mobile viewport help reviewers assess UI changes.

## Playback rules

- Keep one `HTMLAudioElement` for the application lifetime. Navigation and React renders must not recreate it.
- Call `audio.play()` synchronously in the user gesture, before any `await`.
- Feature-detect Media Session and catch unsupported action handlers individually.
- Preserve native end-of-track handling. The proxy duration correction applies only to the documented doubled-duration case.
- Keep audio and signed provider URLs out of service-worker caches, persisted library data and logs.
- Run `pnpm check` and `pnpm test:e2e` for playback or PWA changes.

## Pull requests

Explain the user-visible problem, resulting behavior and validation. Mention limitations and manual checks honestly. Include before/after screenshots for meaningful visual changes. Keep unrelated formatting and dependency updates separate.

The deterministic test suite uses generated audio fixtures. Optional live-provider checks require network access and are documented in [development notes](docs/development-notes.md). Automated WebKit tests do not replace physical iPhone testing.

## Reporting problems

Include browser/OS versions, steps, expected behavior and what happened. For playback, state whether this happens in Safari, the installed PWA or another browser, and whether the screen was locked. Remove cookies, tokens, signed media URLs and personal library data from shared diagnostics.

Use the [security policy](SECURITY.md) for vulnerabilities. Be respectful, assume good intent and give actionable feedback.
