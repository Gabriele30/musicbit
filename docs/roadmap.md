# Roadmap

MusicBit aims to make self-hosted music comfortable for daily use. This roadmap records direction, not release dates or parity with commercial streaming services.

## Available today

- Discovery feed, song/artist/album search and artist discography.
- Combined search results, category filters and removable recent searches.
- Favorites, saved albums, followed artists and listening history.
- Local playlists with editing, reordering, shuffle and undo for track removal.
- Persistent audio, editable queue, repeat and staged autoplay recommendations.
- Responsive desktop/mobile layouts and an installable PWA with an offline shell.
- Accounts, editable profiles, persistent server libraries and revision-based sync with explicit conflict recovery.
- Library JSON export/import, guest migration and personal recommendation controls.
- Supervised provider process and optional authenticated catalog/audio access with traffic limits.
- Immediate local search suggestions and incremental catalog categories.
- Track/artist radio, uniform shuffle and explicit cross-device queue/position resumption.
- Automatic personal mixes, editable artist Taste Profile and year-round Wrapped statistics.
- AI playlist previews with verified catalog matches, enabled by a server-side OpenAI API key.
- Deterministic unit and browser tests, plus optional live-provider probes.

## Next priorities

- Shareable URLs for artists, albums and playlists, preserving back navigation.
- Search pagination and improved matching beyond the initial result window.
- Physical iPhone testing for background transitions, lock-screen controls and audio interruptions.
- Stronger OS/container isolation for exposed providers and measured startup optimization.

## Later exploration

- Automatic conflict merging and finer recommendation quality/diversity controls.
- Interface localization and usability testing with new listeners.
- Lyrics, gapless playback and crossfade, subject to provider support and the audio architecture.

For the detailed design investigation, see [product design](product-design-roadmap.md). For current technical issues and evidence, see the [audit](product-audit.md) and [validation log](validation.md).
