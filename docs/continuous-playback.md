# Native continuous playback

On authenticated browsers with native HLS support, MusicBit uses one HLS source for a listening queue. The server remuxes the canonical cached AAC into two-second MPEG-TS segments with FFmpeg audio stream copy. No audio encoding, WebAudio, Blob URLs, extra audio elements or silent keepalive tracks are used. Song boundaries are HLS discontinuities inside the same source: native playback continues without JavaScript assigning another URL or calling Play at each boundary.

FFmpeg is included in the API Docker image and required on native API installations. `GET /api/me/continuous` reports availability. Set `MUSICBIT_CONTINUOUS_ENABLED=false` to disable it. Unsupported browsers and guest sessions keep progressive playback. Enabling HLS does not automatically replace an already playing progressive source; start a new playback after availability has loaded.

Session creation still calls `audio.play()` synchronously in the user's gesture, before submitting its queue. The first native manifest request briefly waits for that authenticated plan. The server prepares the current song and two ahead, then advances preparation from native segment requests. With autoplay enabled, the server obtains recommendations itself and includes their metadata in the session timeline. A suspended page is not responsible for requesting the next radio songs.

The app maps the HLS presentation timeline back to each song's position and duration. Skip and seek reuse the source when the target is prepared. Queue reordering starts a replacement session in the queue-edit command, preserving the current position and paused state. Explicit Play is required after a page reload. Sessions are capped at the remaining capacity of the 500-track player queue; reaching that cap requires a new listening session. Repeat controls still depend on page execution and have no physical locked-screen validation in this delivery mode.

There are at most four sessions total and two per account, one concurrent remux process, a thirty-second remux deadline, and a 512 MiB shared temporary working budget. This temporary segment working area is separate from the persistent 5 GB-per-account source cache. Older working segments can be regenerated from cached audio. Inactive sessions expire after twenty minutes; shutdown removes working files. Session URLs require the owning account cookie and never reveal signed upstream URLs.

Explicit song selections restart the selected track. The pause/Play path preserves its position. During native HLS source selection, the initial seek remains pending through metadata loading and is reapplied on `canplay` and `playing`: WebKit must not restore an older cached position after the initial metadata event. Stale clocks are ignored until the requested track has been selected natively.

A settled native `seeked` event also completes a manual selection within an already-playing HLS source, which need not emit another `playing` event. Changing the upcoming queue preserves the current track position.

Diagnostics show `native-continuous-hls-v7`, the selected transport and source URL. The meaningful iPhone check is **Transport: HLS continuo nativo** followed by several native boundaries with the screen physically locked. A passing desktop test or successful FFmpeg decode does not establish audible background playback on iOS or CarPlay.
