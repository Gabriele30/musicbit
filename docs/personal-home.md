# Personal Home

Quick picks are ranked from the account's recent listening, favorites and completed/skipped signals. Blocked artists, dismissed tracks and tracks excluded from taste are omitted. The anonymous upstream Quick picks shelf is replaced rather than presented as personalized listening history.

Authenticated artist discovery uses the five highest-scoring artists in the editable Taste Profile. The configured playlist AI provider proposes new artist names; each name must match an artist search in the catalog before it becomes a navigable suggestion. Known and blocked artists are excluded. Artist portraits come from artist metadata, including hydration of references inferred from Home tracks.

`GET /api/me/discovery/artists` returns `artists`, `basedOn` and `source` (`ai`, `related`, or `empty`). Suggestions are cached separately by account, taste seeds and explicit artist preferences. Verified AI results last one hour; related results last ten minutes; empty results retry after one minute. Only one discovery inference runs at a time. Other requests can use related artists. AI failure falls back to catalog-related artists with a distinct UI label. An empty taste profile never sends an AI request.

The Classifica section links directly to the official daily Italy and Global Spotify Charts. Spotify currently requires login for full chart access: this is an external official chart, **not an imported ranking or MusicBit playback integration**. No generic recommendations or unverified playlist contents are labelled as Spotify chart positions. Sources: [Spotify Charts](https://charts.spotify.com/home), [chart definitions](https://support.spotify.com/it/artists/article/understanding-spotify-charts/).

Wrapped uses bounded grid columns and truncates long ranking labels. On mobile, twelve months appear in two rows of six, without horizontal page or chart overflow. Browser checks cover widths 320, 375, 390 and 430 px with a full year of data and long track/artist names.
