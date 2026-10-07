#!/usr/bin/env node
/**
 * AI-prompt grading latency (docs/17-ai-grading.md, Phase 12): p95 < 3s.
 *
 * Fires concurrent submissions at the demo course's AI_PROMPT lesson from
 * distinct synthetic students (per-user cooldown is 3s), each with a unique
 * response so the (aiPrompt, response, rubric) cache can't short-circuit the
 * grader. Measures POST → graded result latency.
 *
 * Results depend on the grader the API is wired to — the deterministic dev
 * grader locally, the real LLM judge when ANTHROPIC_API_KEY is set. Run it
 * against staging (with a modest --requests, it costs tokens) to measure the
 * real judge.
 *
 *   API_URL=http://localhost:3107/api node tools/load/ai-grading-p95.mjs \
 *     [--requests=100] [--concurrency=10] [--start=400000]
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

const P95_TARGET_MS = 3000;
const args = parseArgs();
const REQUESTS = intArg(args, 'requests', 100);
const CONCURRENCY = intArg(args, 'concurrency', 10);
const START = intArg(args, 'start', 400000);

const ANSWERS = [
  'Use try and catch around risky code so a thrown error does not crash the program; the user sees a graceful message and the app can recover.',
  'Wrap calls in try / catch blocks. Handling errors matters because otherwise the whole app may crash and the user loses work instead of recovering.',
  'I would just ignore errors.',
];

console.log(`AI-prompt grading latency → ${API}`);
console.log(`  requests=${REQUESTS} concurrency=${CONCURRENCY}\n`);

await assertApiUp();
const course = await ensureDemoCourse();
const lessonId = course.lessons.AI_PROMPT;
if (!lessonId) {
  console.error(`✗ Demo course ${course.slug} has no AI_PROMPT lesson`);
  process.exit(2);
}
const view = await call('GET', `/lessons/${lessonId}/ai-prompt`, {
  token: `dev-token-student${START}`,
});
if (view.status !== 200) {
  console.error(
    `✗ GET /lessons/${lessonId}/ai-prompt → ${view.status}: ${JSON.stringify(view.body)}`,
  );
  process.exit(2);
}
const promptId = view.body.id;
console.log(`  Demo course ${course.slug} · AI prompt ${promptId}\n`);

const results = await pool(
  Array.from({ length: REQUESTS }, (_, i) => i),
  CONCURRENCY,
  async (i) => {
    const token = `dev-token-student${START + i}`;
    // Unique suffix defeats the grade cache; the content still varies pass/fail.
    const response = `${ANSWERS[i % ANSWERS.length]} (attempt ${START + i})`;
    const res = await call('POST', `/ai-prompts/${promptId}/submit`, {
      token,
      body: { response },
    });
    return {
      ok: res.status < 300,
      status: res.status,
      ms: res.ms,
      body: res.body,
    };
  },
  { onProgress: progress('grade') },
);

const ok = results.filter((r) => r && !r.error && r.ok);
const failed = results.filter((r) => !r || r.error || !r.ok);
const passed = ok.filter((r) => r.body?.passed).length;
const cached = ok.filter((r) => r.body?.cached).length;
const gradedBy = {};
for (const r of ok)
  gradedBy[r.body?.gradedBy] = (gradedBy[r.body?.gradedBy] ?? 0) + 1;
const s = latencySummary(ok.map((r) => r.ms));

console.log('\n── Result ────────────────────────────────────────────────────');
console.log(
  `  ${ok.length}/${REQUESTS} graded · passed ${passed} · cached ${cached} · gradedBy ${JSON.stringify(gradedBy)}`,
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
  `  latency p50=${fmtMs(s.p50)} p95=${fmtMs(s.p95)} p99=${fmtMs(s.p99)} (min ${fmtMs(s.min)}, max ${fmtMs(s.max)})`,
);
console.log(`  target: p95 < ${P95_TARGET_MS}ms`);

const pass = failed.length === 0 && s.p95 < P95_TARGET_MS;
console.log(pass ? '\n✅ PASS' : '\n❌ FAIL');
process.exit(pass ? 0 : 1);
