import { mkdir, writeFile } from 'node:fs/promises';
import { buildApp } from '../apps/api/dist/app.js';

// Real service: explicit script, never part of deterministic CI. No media calls.
const runs = Number(process.env.CATALOG_BENCHMARK_RUNS || 5);
if (!Number.isInteger(runs) || runs < 1 || runs > 10)
  throw new Error('CATALOG_BENCHMARK_RUNS: 1–10');
const samples = [];
const probes = [];
const startedAt = new Date().toISOString();
for (const type of ['track', 'artist', 'album']) {
  for (let run = 0; run < runs; run++) {
    // New provider/session/cache per cold sample; process, OS and remote caches persist.
    const app = buildApp();
    try {
      const address = await app.listen({ host: '127.0.0.1', port: 0 });
      let first;
      for (const phase of ['cold', 'warm']) {
        const start = performance.now();
        const response = await fetch(
          `${address}/api/search?${new URLSearchParams({ q: 'Johann Sebastian Bach', type, limit: '5' })}`,
          { signal: AbortSignal.timeout(15_000) },
        );
        const data = await response.json();
        samples.push({
          type,
          run: run + 1,
          phase,
          status: response.status,
          totalMs: performance.now() - start,
          serverMs: data.timing?.elapsedMs ?? null,
          cache: data.timing?.cache ?? null,
          count: data.items?.length ?? 0,
          errorCode: data.code ?? null,
        });
        if (phase === 'cold') first = data.items?.[0];
      }
      if (run === 0 && first) {
        const response = await fetch(
          `${address}/api/catalog/youtube/${type}/${first.id}`,
          { signal: AbortSignal.timeout(15_000) },
        );
        const data = await response.json();
        probes.push({
          type,
          status: response.status,
          normalized:
            data.item?.playback?.available === false &&
            !('audioUrl' in data.item),
          albumTracks: data.item?.tracks?.length ?? null,
          serverMs: data.timing?.elapsedMs ?? null,
          errorCode: data.code ?? null,
        });
      }
    } finally {
      await app.close();
    }
  }
}
function summary(rows, key) {
  const values = rows
    .filter((row) => row.status === 200)
    .map((row) => row[key])
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  const percentile = (p) =>
    values[Math.max(0, Math.ceil(values.length * p) - 1)] ?? null;
  return {
    successes: values.length,
    failures: rows.length - values.length,
    p50Ms: percentile(0.5),
    p95Ms: percentile(0.95),
  };
}
const statistics = ['track', 'artist', 'album'].flatMap((type) =>
  ['cold', 'warm'].map((phase) => {
    const rows = samples.filter(
      (row) => row.type === type && row.phase === phase,
    );
    return {
      type,
      phase,
      http: summary(rows, 'totalMs'),
      server: summary(rows, 'serverMs'),
    };
  }),
);
const report = {
  startedAt,
  completedAt: new Date().toISOString(),
  node: process.version,
  library: 'youtubei.js@18.1.0',
  runsPerType: runs,
  definition:
    'Cold: new in-memory metadata cache and local Innertube session. Warm: immediate repeat in the same API instance. Loopback HTTP, sequential requests; DNS/TLS/OS/remote caches uncontrolled. p50/p95 nearest rank, small sample; excludes 350ms UI debounce, WAN client and artwork loading. Errors excluded from latency percentiles and counted separately. No audio obtained or played.',
  statistics,
  probes,
  samples,
};
await mkdir('docs/performance', { recursive: true });
const path =
  process.env.CATALOG_BENCHMARK_OUTPUT || 'docs/performance/catalog-m3.json';
await writeFile(path, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ path, statistics, probes }, null, 2));
if (
  samples.some((row) => row.status !== 200 || row.count === 0) ||
  probes.some((row) => row.status !== 200 || !row.normalized)
)
  process.exitCode = 1;
