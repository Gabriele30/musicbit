# Listening, personalization and AI playlists

## Search and radio

Search immediately suggests matching recent queries and saved tracks, albums and artists, with accent-insensitive local matches. Catalog requests start after a 150 ms debounce; categories appear as they finish. Suggestions support arrows, Enter and Escape. Uncached catalog requests still depend on network/provider latency.

The same native audio element survives navigation. **Avvia radio brano/artista** starts from a track or the artist's loaded popular tracks, then stages related songs ahead of transitions. Late recommendations can recover a naturally ended radio. The queue remains bounded; new recommendations exclude the most recent 200 queued tracks. Continuity still depends on catalog availability, network and platform background restrictions.

Shuffle uses Fisher–Yates with `crypto.getRandomValues` and rejection sampling. Every entry is retained, including intentional duplicates; upcoming shuffle preserves the current and played prefix. A uniform shuffle can legitimately retain an order or group an artist.

## Resume on another device

The server saves queue, index, position, repeat and autoplay separately from library revisions. An owning device publishes about every five seconds; stale revisions cannot replace newer sessions. **Riprendi qui** uses a snapshot downloaded before the tap, then restores and calls `audio.play()` synchronously. Opening the app never starts playback or replaces current audio. Playing a local selection explicitly claims the session. This is resumption, not remote speaker control or multiroom synchronization. During network loss the server position can lag behind the local cache.

## Automatic mixes and Taste Profile

Home derives **Il tuo Daily Mix**, **In loop** and **Fuori dal solito** from favorites, listening, completion/skip signals and available candidates. **Salva mix** creates an editable playlist snapshot; the derived mix continues updating independently.

Taste Profile separates inferred artist affinity from user corrections. Listeners can request more/less of an artist, exclude an artist from personal suggestions, remove an occasional listening entry from the taste calculation and restore dismissed tracks. Corrections synchronize and appear in library backups. Artist exclusions apply to personal suggestions, mixes and AI proposals using Taste Profile; they do not prevent deliberately playing an artist or a provider radio. Ranking is deterministic, not a trained recommendation model, and does not invent genre/mood metadata.

## MusicBit Wrapped throughout the year

Wrapped offers year/month filters, minutes, qualified plays, active days, top tracks/artists and monthly bars. Tracks can be replayed; selecting a bar filters its month. Periods use UTC.

The meter compares native progress with elapsed wall time. Pauses, stalled buffering and seeks do not create minutes. Background progress is split into chunks of at most 60 seconds; repeat-one passes count separately. A play qualifies after 30 seconds, or half a shorter track. Old history entries are not converted into invented listening time. These counters measure media progress, not verified audible sound or human attention.

Account statistics use SQLite daily aggregates and UUID receipts for idempotent retries. They preserve repeated listens independently of the 100-entry recent history. Account-scoped offline queues hold up to 1,000 chunks; the API accepts chunks from the past seven days. Guest statistics remain local, bounded to 10,000 day/track aggregates. Storage failures and exhausted buffers appear in the UI. Statistics start with this version.

Deleting statistics requires confirmation and records a server cutoff against delayed older chunks. Library JSON backups contain collections and taste settings, **not** Wrapped aggregates or cloud playback. Back up SQLite to preserve those records.

## AI playlists

Choose a local Ollama model or a server-side API provider. Both paths validate
model proposals against the catalog before offering playback or saving.

### Local AI with Ollama

No paid API key is required for the local option. Model inference runs on the
host's own hardware. With Docker:

```sh
docker compose -f compose.yaml -f compose.local-ai.yaml up --build -d
docker compose -f compose.yaml -f compose.local-ai.yaml exec ollama ollama pull qwen2.5:1.5b
```

The overlay sets `AI_PROVIDER=ollama` and connects the API to the internal Ollama
service. `OLLAMA_PLAYLIST_MODEL` selects a different installed model. Without
Docker, run Ollama separately and configure `AI_PROVIDER=ollama`,
`OLLAMA_BASE_URL=http://127.0.0.1:11434` and
`OLLAMA_PLAYLIST_MODEL=qwen2.5:1.5b` in the server environment.

Artist discovery limits AI selections to catalog-verified related artists from
the listener's positive taste seeds. The model can reorder that pool, rather
than introducing unrelated popular artists. Local model quality and speed depend
on the selected model and host.

### API provider

Set these values in the server's untracked `.env`, then restart the API or recreate its container:

```dotenv
OPENAI_API_KEY=your-server-side-key
OPENAI_PLAYLIST_MODEL=gpt-4o-mini
```

Never prefix the key with `VITE_` or commit it. The model is configurable; the host must have access to a model supporting Structured Outputs.

MusicBit uses the [OpenAI Responses API with Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses), `store: false`, a bounded output budget and a 55-second deadline. It sends the submitted description and requested count. **Usa anche il mio Taste Profile** is off by default; opting in adds up to ten positively ranked artist names. Passwords, sessions, audio and full history are excluded.

The model proposes titles and artists. MusicBit searches them in the catalog, requires title/artist matches and playable metadata, removes duplicates and reports unmatched songs. Listeners can remove tracks, play the preview, then explicitly save. Model output never becomes an arbitrary audio URL or executable instruction.

Generation requires an account. Limits are two concurrent generations globally, 30 seconds between requests per account and 12 requests per account per UTC day. Counters are in memory and reset with the API; use provider-side spending limits for a persistent billing cap. Browser cancellation cannot guarantee that provider processing or billing stops.

When neither a configured local provider nor an API key is available, the UI
shows that host configuration is needed. Tests use injected model results and
mocked previews, never billed API requests. Physical iPhone background behavior
and live AI generation need separate validation.
