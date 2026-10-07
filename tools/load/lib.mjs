/**
 * Shared helpers for the load scripts in tools/load. Plain Node 22 (global
 * fetch, no dependencies) so they run anywhere the repo is checked out.
 *
 * Environment:
 *   API_URL   Base URL incl. the /api prefix (default http://localhost:3000/api)
 */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const API = (process.env.API_URL ?? 'http://localhost:3000/api').replace(
  /\/$/,
  '',
);
const here = dirname(fileURLToPath(import.meta.url));

/** Parse `--key=value` / `--flag` CLI args into an object. */
export function parseArgs(argv = process.argv.slice(2)) {
  const out = {};
  for (const arg of argv) {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(arg);
    if (m) out[m[1]] = m[2] ?? true;
  }
  return out;
}

export const intArg = (args, key, fallback) => {
  const v = args[key] ?? process.env[key.toUpperCase().replace(/-/g, '_')];
  const n = Number.parseInt(v ?? '', 10);
  return Number.isFinite(n) ? n : fallback;
};

/**
 * Minimal HTTP helper. Returns `{ status, body, ms }` and never throws on a
 * non-2xx status (load scripts decide what counts as an error).
 */
export async function call(method, path, { token, body, headers = {} } = {}) {
  const started = performance.now();
  const res = await fetch(API + path, {
    method,
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(method !== 'GET' ? { 'idempotency-key': crypto.randomUUID() } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const ms = performance.now() - started;
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  return { status: res.status, body: parsed, ms };
}

/**
 * Run `worker(item, index)` over `items` with at most `concurrency` in
 * flight. Results keep input order. Errors are captured per item as
 * `{ error }` so one failure doesn't abort the run.
 */
export async function pool(items, concurrency, worker, { onProgress } = {}) {
  const results = new Array(items.length);
  let next = 0;
  let done = 0;
  async function lane() {
    while (next < items.length) {
      const i = next++;
      try {
        results[i] = await worker(items[i], i);
      } catch (error) {
        results[i] = { error };
      }
      done += 1;
      onProgress?.(done, items.length);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, lane),
  );
  return results;
}

/** Progress printer that writes at most ~10 lines per run. */
export function progress(label) {
  let lastPct = -1;
  return (done, total) => {
    const pct = Math.floor((done / total) * 10) * 10;
    if (pct !== lastPct) {
      lastPct = pct;
      process.stdout.write(`  ${label}: ${done}/${total} (${pct}%)\n`);
    }
  };
}

/** Nearest-rank percentile over a numeric array. */
export function percentile(values, p) {
  if (!values.length) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))];
}

export function latencySummary(values) {
  const sum = values.reduce((a, b) => a + b, 0);
  return {
    n: values.length,
    min: Math.min(...values),
    mean: sum / values.length,
    p50: percentile(values, 50),
    p95: percentile(values, 95),
    p99: percentile(values, 99),
    max: Math.max(...values),
  };
}

export const fmtMs = (ms) =>
  Number.isFinite(ms) ? `${ms.toFixed(0)}ms` : 'n/a';

/** Fail fast with a clear message if the API isn't reachable. */
export async function assertApiUp() {
  try {
    const { status, body } = await call('GET', '/health');
    if (status !== 200) throw new Error(`HTTP ${status}`);
    return body;
  } catch (err) {
    console.error(
      `✗ API not reachable at ${API}/health (${err.message}). Start it first, e.g.`,
    );
    console.error('    API_PORT=3000 node apps/api/dist/main.js');
    process.exit(2);
  }
}

/**
 * Find the most recently updated published "Codify Demo" course (seeded by
 * tools/scripts/seed-demo-course.mjs); seed one if none exists. Returns
 * `{ id, slug, lessons: { READING, EXERCISE, AI_PROMPT, SCENARIO } }` where
 * each lesson entry is the lesson id of that type.
 */
export async function ensureDemoCourse({ reseed = false } = {}) {
  const find = async () => {
    const { status, body } = await call(
      'GET',
      '/courses?status=PUBLISHED&take=200',
      {
        token: 'dev-token-admin',
      },
    );
    if (status !== 200)
      throw new Error(`GET /courses → ${status}: ${JSON.stringify(body)}`);
    const items = body.items ?? body.courses ?? body;
    return items.find(
      (c) => c.title === 'Codify Demo' && c.status === 'PUBLISHED',
    );
  };

  let course = reseed ? undefined : await find();
  if (!course) {
    console.log('  No published "Codify Demo" course — seeding one…');
    const seed = spawnSync(
      process.execPath,
      [join(here, '../scripts/seed-demo-course.mjs')],
      {
        env: { ...process.env, API_URL: API },
        stdio: 'inherit',
      },
    );
    if (seed.status !== 0) throw new Error('seed-demo-course.mjs failed');
    course = await find();
    if (!course)
      throw new Error(
        'Seeded the demo course but could not find it via GET /courses',
      );
  }

  const detail = await call('GET', `/courses/${course.id}`, {
    token: 'dev-token-admin',
  });
  if (detail.status !== 200)
    throw new Error(`GET /courses/${course.id} → ${detail.status}`);
  const lessons = {};
  for (const mod of detail.body.modules ?? []) {
    for (const lesson of mod.lessons ?? []) lessons[lesson.type] ??= lesson.id;
  }
  return { id: course.id, slug: course.slug, lessons };
}

/** Print a small ASCII histogram: `rows` is [[label, count], ...]. */
export function histogram(rows, width = 40) {
  const max = Math.max(...rows.map(([, c]) => c), 1);
  for (const [label, count] of rows) {
    const bar = '█'.repeat(
      Math.max(count > 0 ? 1 : 0, Math.round((count / max) * width)),
    );
    console.log(`    ${String(label).padStart(6)} │ ${bar} ${count}`);
  }
}
