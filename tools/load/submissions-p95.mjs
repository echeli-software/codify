#!/usr/bin/env node
/**
 * Phase 10 acceptance: "p95 submission turnaround < 4s under realistic load"
 * (docs/12-code-execution.md §10: p50 < 1.5s, p95 < 4s).
 *
 * Fires concurrent "Submit" requests at the demo course's exercise lesson
 * from distinct synthetic students (the API enforces 1 scored submission per
 * 3s per user, so each request uses its own user). Turnaround is measured
 * end-to-end from POST until a final verdict: if the API answers
 * synchronously the POST latency is the turnaround; if it answers with a
 * queued submission it polls GET /submissions/:id until the verdict lands.
 *
 * Results depend on which executor the API is wired to — the dev in-process
 * executor locally, Judge0 when JUDGE0_URL is set. Run it against staging to
 * measure the real sandbox.
 *
 *   API_URL=http://localhost:3107/api node tools/load/submissions-p95.mjs \
 *     [--requests=200] [--concurrency=10] [--start=300000] [--fail-ratio=0.3]
 */
import {
  API,
  assertApiUp,
  call,
  ensureDemoCourse,
  fmtMs,
  intArg,
  latencySummary,
  parseArgs,
  pool,
  progress,
} from './lib.mjs';

const P95_TARGET_MS = 4000;
const P50_TARGET_MS = 1500;
const args = parseArgs();
const REQUESTS = intArg(args, 'requests', 200);
const CONCURRENCY = intArg(args, 'concurrency', 10);
const START = intArg(args, 'start', 300000);
const FAIL_RATIO = Number.parseFloat(args['fail-ratio'] ?? '0.3');

const PASSING = 'function solution(a, b) {\n  return a + b;\n}';
const FAILING = 'function solution(a, b) {\n  return a - b;\n}';
const PENDING = new Set(['PENDING', 'QUEUED', 'RUNNING']);

console.log(`Exercise submission turnaround → ${API}`);
console.log(
  `  requests=${REQUESTS} concurrency=${CONCURRENCY} fail-ratio=${FAIL_RATIO}\n`,
);

await assertApiUp();
const course = await ensureDemoCourse();
const lessonId = course.lessons.EXERCISE;
if (!lessonId) {
  console.error(`✗ Demo course ${course.slug} has no EXERCISE lesson`);
  process.exit(2);
}
const view = await call('GET', `/lessons/${lessonId}/exercise`, {
  token: `dev-token-student${START}`,
});
if (view.status !== 200) {
  console.error(
    `✗ GET /lessons/${lessonId}/exercise → ${view.status}: ${JSON.stringify(view.body)}`,
  );
  process.exit(2);
}
const exerciseId = view.body.id;
console.log(
  `  Demo course ${course.slug} · exercise ${exerciseId} (${view.body.language})\n`,
);

async function submitOne(i) {
  const token = `dev-token-student${START + i}`;
  // Deterministically spread FAIL_RATIO of the requests as wrong answers.
  const code =
    Math.floor((i + 1) * FAIL_RATIO) > Math.floor(i * FAIL_RATIO)
      ? FAILING
      : PASSING;
  const started = performance.now();
  const res = await call('POST', `/exercises/${exerciseId}/submit`, {
    token,
    body: { code },
  });
  if (res.status >= 300)
    return { ok: false, status: res.status, ms: res.ms, body: res.body };
  let body = res.body;
  const deadline = started + 15000;
  while (
    (!body.verdict || PENDING.has(body.verdict) || PENDING.has(body.status)) &&
    performance.now() < deadline
  ) {
    await new Promise((r) => setTimeout(r, 250));
    const poll = await call(
      'GET',
      `/submissions/${body.submissionId ?? body.id}`,
      { token },
    );
    if (poll.status !== 200)
      return {
        ok: false,
        status: poll.status,
        ms: performance.now() - started,
      };
    body = poll.body;
  }
  const done = body.verdict && !PENDING.has(body.verdict);
  return {
    ok: done,
    status: res.status,
    ms: performance.now() - started,
    verdict: body.verdict,
  };
}

const t0 = performance.now();
const results = await pool(
  Array.from({ length: REQUESTS }, (_, i) => i),
  CONCURRENCY,
  submitOne,
  { onProgress: progress('submit') },
);
const wall = (performance.now() - t0) / 1000;

const ok = results.filter((r) => r && !r.error && r.ok);
const failed = results.filter((r) => !r || r.error || !r.ok);
const verdicts = {};
for (const r of ok) verdicts[r.verdict] = (verdicts[r.verdict] ?? 0) + 1;
const s = latencySummary(ok.map((r) => r.ms));

console.log('\n── Result ────────────────────────────────────────────────────');
console.log(
  `  ${ok.length}/${REQUESTS} completed in ${wall.toFixed(1)}s (${(ok.length / wall).toFixed(1)} req/s) · verdicts ${JSON.stringify(verdicts)}`,
);
if (failed.length) {
  const sample = failed
    .slice(0, 3)
    .map((r) =>
      r?.error
        ? r.error.message
        : `${r.status} ${JSON.stringify(r.body ?? '')}`,
    );
  console.log(`  ${failed.length} failed, e.g. ${sample.join(' | ')}`);
}
console.log(
  `  turnaround p50=${fmtMs(s.p50)} p95=${fmtMs(s.p95)} p99=${fmtMs(s.p99)} (min ${fmtMs(s.min)}, max ${fmtMs(s.max)})`,
);
console.log(`  targets: p50 < ${P50_TARGET_MS}ms, p95 < ${P95_TARGET_MS}ms`);

const pass =
  failed.length === 0 && s.p95 < P95_TARGET_MS && s.p50 < P50_TARGET_MS;
console.log(pass ? '\n✅ PASS' : '\n❌ FAIL');
process.exit(pass ? 0 : 1);
