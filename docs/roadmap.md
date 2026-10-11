# Roadmap

MusicBit aims to make self-hosted music comfortable for daily use. This roadmap records direction, not release dates or parity with commercial streaming services.

## Available today

- Discovery feed, song/artist/album search and artist discography.
- Combined search results, category filters and removable recent searches.
- Favorites, saved albums, followed artists and listening history.
- Local playlists with editing, reordering, shuffle and undo for track removal.
- Persistent audio, editable queue, repeat and staged autoplay recommendations.
- Responsive desktop/mobile layouts and an installable PWA with an offline shell.
- Deterministic unit and browser tests, plus optional live-provider probes.

## Next priorities

- Library export/import and recovery from browser storage loss.
- Shareable URLs for artists, albums and playlists, preserving back navigation.
- Search pagination and improved matching beyond the initial result window.
- Physical iPhone testing for background transitions, lock-screen controls and audio interruptions.
- Provider execution isolation and clearer operational controls for hosted instances.

## Later exploration

- Optional accounts and cross-device library synchronization with conflict handling.
- Recommendations informed by an explicit personal listening profile.
- Interface localization and usability testing with new listeners.
- Lyrics, gapless playback and crossfade, subject to provider support and the audio architecture.

For the detailed design investigation, see [product design](product-design-roadmap.md). For current technical issues and evidence, see the [audit](product-audit.md) and [validation log](validation.md).
