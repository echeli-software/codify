#!/usr/bin/env node
/**
 * Phase 9 acceptance: "Cohort sharding produces ~30-person groups; verified
 * at 1k synthetic users" (docs/15-roadmap.md, docs/07-gamification.md).
 *
 * 1. Ensures the free "Codify Demo" course exists (seeds it via
 *    tools/scripts/seed-demo-course.mjs if missing).
 * 2. Creates N synthetic students (dev tokens `dev-token-student<k>`; the API
 *    upserts the user on first sight) and has each one complete the free
 *    reading lesson concurrently — the reward path lazily assigns the user to
 *    a weekly league cohort.
 * 3. Reads every user's current league (GET /league/current), groups users by
 *    cohort and asserts: every cohort ≤ 30 members, and the cohorts holding
 *    the synthetic users average ≈ 30 (only the last-opened cohort per tier
 *    may be partially filled).
 *
 * Needs dev tokens enabled (non-production API). Usage:
 *   API_URL=http://localhost:3107/api node tools/load/league-sharding.mjs \
 *     [--users=1000] [--concurrency=25] [--start=100000]
 *
 * `--start` offsets the student numbers so runs don't collide with the small
 * numbered students used by probes (re-running with the same range is
 * idempotent: completions replay as 409 and memberships already exist).
 * Exit code 0 = acceptance met, 1 = assertion failed, 2 = setup problem.
 */
import {
  API,
  assertApiUp,
  call,
  ensureDemoCourse,
  histogram,
  intArg,
  latencySummary,
  fmtMs,
  parseArgs,
  pool,
  progress,
} from './lib.mjs';

const CAPACITY = 30;
const args = parseArgs();
const USERS = intArg(args, 'users', 1000);
const CONCURRENCY = intArg(args, 'concurrency', 25);
const START = intArg(args, 'start', 100000);

console.log(`League sharding load test → ${API}`);
console.log(
  `  users=${USERS} concurrency=${CONCURRENCY} students ${START}..${START + USERS - 1}\n`,
);

await assertApiUp();
const course = await ensureDemoCourse();
const lessonId = course.lessons.READING;
if (!lessonId) {
  console.error(`✗ Demo course ${course.slug} has no READING lesson`);
  process.exit(2);
}
console.log(
  `  Demo course: ${course.slug} · free reading lesson ${lessonId}\n`,
);

const tokens = Array.from(
  { length: USERS },
  (_, i) => `dev-token-student${START + i}`,
);

// ── Phase 1: every user completes the free lesson ─────────────────────────
const t0 = performance.now();
const completions = await pool(
  tokens,
  CONCURRENCY,
  async (token) => call('POST', `/lessons/${lessonId}/complete`, { token }),
  { onProgress: progress('complete lesson') },
);
const completeSecs = (performance.now() - t0) / 1000;
const byStatus = {};
for (const r of completions) {
  const key = r.error ? `error:${r.error.message}` : r.status;
  byStatus[key] = (byStatus[key] ?? 0) + 1;
}
const failedCompletions = completions.filter(
  (r) => r.error || (r.status !== 201 && r.status !== 409),
);
const completeLatency = latencySummary(
  completions.filter((r) => !r.error).map((r) => r.ms),
);
console.log(
  `\n  Completions in ${completeSecs.toFixed(1)}s — status counts: ${JSON.stringify(byStatus)}`,
);
console.log(
  `  POST /lessons/:id/complete latency p50=${fmtMs(completeLatency.p50)} p95=${fmtMs(completeLatency.p95)} p99=${fmtMs(completeLatency.p99)}\n`,
);

// ── Phase 2: read every user's cohort ─────────────────────────────────────
const views = await pool(
  tokens,
  CONCURRENCY,
  async (token) => {
    const r = await call('GET', '/league/current', { token });
    if (r.status !== 200) throw new Error(`GET /league/current → ${r.status}`);
    return r.body;
  },
  { onProgress: progress('read league') },
);
const viewErrors = views.filter((v) => v?.error);

// Group by cohort: every member of a cohort sees the same member set, so the
// smallest member id is a stable cohort key.
const cohorts = new Map();
for (const v of views) {
  if (!v || v.error) continue;
  const key = `${v.tier}:${v.members.map((m) => m.userId).sort()[0]}`;
  const me = v.members.find((m) => m.isMe);
  const entry = cohorts.get(key) ?? {
    tier: v.tier,
    size: v.members.length,
    synthetic: new Set(),
  };
  entry.size = Math.max(entry.size, v.members.length);
  if (me) entry.synthetic.add(me.userId);
  cohorts.set(key, entry);
}

const sizes = [...cohorts.values()].map((c) => c.size);
const overCapacity = [...cohorts.values()].filter((c) => c.size > CAPACITY);
const totalPlaced = [...cohorts.values()].reduce(
  (a, c) => a + c.synthetic.size,
  0,
);
const mean = sizes.reduce((a, b) => a + b, 0) / (sizes.length || 1);
// Expected: all but the newest cohort per tier are full. Allow one partial
// cohort per tier when judging "≈30 on average".
const tiers = new Set([...cohorts.values()].map((c) => c.tier));
const full = sizes.filter((s) => s === CAPACITY).length;
const partial = sizes.filter((s) => s < CAPACITY).length;

const dist = new Map();
for (const s of sizes) dist.set(s, (dist.get(s) ?? 0) + 1);

console.log('\n── Result ────────────────────────────────────────────────────');
console.log(
  `  Synthetic users placed: ${totalPlaced}/${USERS} (league read errors: ${viewErrors.length})`,
);
console.log(
  `  Cohorts touched: ${cohorts.size} across tier(s) ${[...tiers].join(', ')}`,
);
console.log(
  `  Cohort size: min=${Math.min(...sizes)} max=${Math.max(...sizes)} mean=${mean.toFixed(2)} · full(30)=${full} partial=${partial}`,
);
console.log('  Distribution (cohort size → count):');
histogram([...dist.entries()].sort((a, b) => b[0] - a[0]));

const failures = [];
if (failedCompletions.length)
  failures.push(`${failedCompletions.length} lesson completions failed`);
if (viewErrors.length)
  failures.push(`${viewErrors.length} league reads failed`);
if (totalPlaced !== USERS)
  failures.push(`only ${totalPlaced}/${USERS} users placed in a cohort`);
if (overCapacity.length)
  failures.push(
    `${overCapacity.length} cohort(s) exceed ${CAPACITY}: ${overCapacity.map((c) => c.size).join(', ')}`,
  );
// ≈30: at most one partially-filled cohort per tier (the one still filling).
if (partial > tiers.size)
  failures.push(
    `${partial} partially-filled cohorts (expected ≤ ${tiers.size}, one per tier)`,
  );
// Mean over the full cohorts' worth of users: ceil(N/30) cohorts expected.
const expectedCohorts = Math.ceil(totalPlaced / CAPACITY);
if (cohorts.size > expectedCohorts + tiers.size) {
  failures.push(
    `${cohorts.size} cohorts for ${totalPlaced} users (expected ≈ ${expectedCohorts})`,
  );
}

if (failures.length) {
  console.log(`\n❌ FAIL — ${failures.join('; ')}`);
  process.exit(1);
}
console.log(
  `\n✅ PASS — every cohort ≤ ${CAPACITY}; ${full} full cohorts + ${partial} filling; mean ${mean.toFixed(2)}`,
);
