#!/usr/bin/env node
/**
 * Ingest benchmark. Measures POST /api/ingest/logs latency for the shapes that matter:
 *   info      — plain entries (bulk insert path)
 *   repeat    — the same error repeated (in-batch dedupe)
 *   distinct  — N different errors (per-fingerprint dedupe path, worst case)
 *
 * Usage: node scripts/bench-ingest.mjs [entries]
 */
import process from 'node:process';

const endpoint = (process.env.MANAGER_ENDPOINT ?? 'http://127.0.0.1:3300').replace(/\/$/, '');
const apiKey = process.env.MANAGER_LOG_KEY ?? '';
const appId = process.env.MANAGER_APP_ID ?? 'resume-builder';
const size = Number(process.argv[2] ?? 100);

if (apiKey === '') {
  process.stderr.write('MANAGER_LOG_KEY is required\n');
  process.exit(2);
}

const headers = { 'content-type': 'application/json', 'x-api-key': apiKey };

async function post(label, logs) {
  const started = performance.now();
  const response = await fetch(`${endpoint}/api/ingest/logs`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ logs }),
  });
  const body = await response.json();
  const ms = performance.now() - started;
  process.stdout.write(
    `${label.padEnd(22)} status=${response.status} ${ms.toFixed(0).padStart(5)}ms ` +
      `accepted=${body.accepted ?? '-'} stored=${body.stored ?? '-'} dupes=${body.duplicates ?? '-'}\n`,
  );
  return ms;
}

const now = Date.now();
const filler = 'x'.repeat(80);

process.stdout.write(`ingest benchmark -> ${endpoint} (app ${appId})\n\n`);

await post(
  'info x' + size,
  Array.from({ length: size }, (_, i) => ({
    level: 'info',
    message: `bench_info_${i}_${now}`,
    meta: { i, filler },
  })),
);

await post(
  'same error x' + size,
  Array.from({ length: size }, () => ({
    level: 'error',
    message: `bench_repeat_${now}`,
    stack: 'Error: bench\n    at bench.js:1:1',
  })),
);

await post(
  'distinct errors x' + size,
  Array.from({ length: size }, (_, i) => ({
    level: 'error',
    message: `bench_distinct_${i}_${now}`,
    stack: `Error: bench ${i}\n    at bench${i}.js:1:1`,
  })),
);

await post(
  'distinct errors x' + size + ' (2nd)',
  Array.from({ length: size }, (_, i) => ({
    level: 'error',
    message: `bench_distinct_${i}_${now}`,
    stack: `Error: bench ${i}\n    at bench${i}.js:1:1`,
  })),
);
