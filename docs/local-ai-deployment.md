# Free local AI and private deployment

MusicBit supports a local Ollama API with `AI_PROVIDER=ollama`. The default model is `qwen2.5:1.5b`; prompts and optional taste artists remain on your server. No paid API key is needed. CPU inference can take up to three minutes.

```sh
docker compose -f compose.yaml -f compose.local-ai.yaml up --build -d
docker compose -f compose.yaml -f compose.local-ai.yaml exec ollama ollama pull qwen2.5:1.5b
```

Set `WEB_PORT` to a free loopback port and use Tailscale Serve on an unused HTTPS port. Preserve existing Serve mappings. Access requires membership of the server's tailnet.

Account libraries use the persistent `musicbit_data` volume. Ollama models use `ollama_data`. Never commit the database, passwords, private keys or `.env`.

The audio player fetches `/api/audio/:id/info` after synchronous native Play to recover the provider's duration, including tracks without feed duration. The existing doubled-AAC workaround then advances at the full duration plus one second, avoiding the silent tail without an early cut. External sources continue using native duration.
