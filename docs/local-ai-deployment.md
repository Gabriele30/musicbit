# Free local AI and private deployment

MusicBit supports a local Ollama API with `AI_PROVIDER=ollama`. The default model is `qwen2.5:1.5b`; prompts and optional taste artists remain on your server. No paid API key is needed. CPU inference can take up to three minutes.

```sh
docker compose -f compose.yaml -f compose.local-ai.yaml up --build -d
docker compose -f compose.yaml -f compose.local-ai.yaml exec ollama ollama pull qwen2.5:1.5b
```

Set `WEB_PORT` to a free loopback port and use Tailscale Serve on an unused HTTPS port. Preserve existing Serve mappings. Access requires membership of the server's tailnet.

On slower CPUs, set `OLLAMA_PLAYLIST_MODEL=qwen2.5:0.5b` and pull that model instead. If a host VPN filters Docker traffic, allow the MusicBit Docker subnet in its local network allowlist. Do not disable the VPN firewall globally.

Account libraries use the persistent `musicbit_data` volume. Ollama models use `ollama_data`. Never commit the database, passwords, private keys or `.env`.

The audio player fetches `/api/audio/:id/info` after synchronous native Play to recover the provider's duration, including tracks without feed duration. The existing doubled-AAC workaround then advances at the full duration plus one second, avoiding the silent tail without an early cut. External sources continue using native duration.

During playback, one upcoming proxied song is prefetched into the server's memory cache. Only complete canonical responses are retained (maximum 16 MiB per song, 64 MiB in the cache, two concurrent cache writers, 15-minute TTL). Partial, oversized or failed responses keep normal proxy behavior. The same lifetime audio element continues using native HTTP URLs and Range requests, without Blob playback or WebAudio. Queue changes, account reset and teardown cancel obsolete prefetches. Audio is never persisted on disk or in the PWA cache.

The first visible playable search result also warms its duration/stream descriptor without downloading audio. Audio descriptors remain cached for 15 minutes, with signed URL expiry checked before use; the isolated provider stays warm for up to 30 idle minutes.
