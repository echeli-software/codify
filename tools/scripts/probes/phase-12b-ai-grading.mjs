#!/usr/bin/env node
/**
 * Phase 12b probe — AI-prompt rubric grading (dev heuristic grader).
 *
 *   1. ADMIN creates an AI_PROMPT lesson with a mixed rubric (keyword + regex
 *      + minWords + llm) and previews the reference answer → passes.
 *   2. STUDENT GET prompt → labels only, no rubric config leaked.
 *   3. Submit a weak answer → FAIL (per-criterion breakdown explains why).
 *   4. Submit a strong answer → PASS, first-pass reward + lesson complete.
 *   5. Re-submitting the identical strong answer is served from cache.
 *   6. Rapid re-submit → 429 rate limit.
 *   7. Grades return fast (p95 < 3s — acceptance).
 */

import { execSync } from 'node:child_process';

const API = 'http://localhost:3000/api';
const ADMIN = 'Bearer dev-token-admin';
const STUDENT = 'Bearer dev-token-student';

const tag = Date.now().toString(36);
let failures = 0;
const fail = (m) => { failures += 1; console.error('  FAIL:', m); };
const ok = (m) => console.log('  OK:', m);
const must = (c, l, ctx = '') => (c ? ok(l) : fail(`${l} — ${ctx}`));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(method, path, body, auth = ADMIN) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'content-type': 'application/json', authorization: auth, 'idempotency-key': crypto.randomUUID() },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null; try { json = text ? JSON.parse(text) : null; } catch { /* */ }
  return { status: res.status, body: json, raw: text };
}
function sql(q) { return execSync(`docker exec codify-postgres psql -U codify -d codify_dev -A -t -c "${q.replace(/"/g, '\\"')}"`, { encoding: 'utf8' }).trim(); }

console.log(`Phase 12b probe — tag ${tag}\n`);

const STUDENT_ID = sql(`SELECT id FROM "User" WHERE "clerkId"='dev-student'`);

// 1. Seed an AI_PROMPT lesson with a mixed rubric.
const cat = (await api('POST', '/categories', { slug: `ai-${tag}`, name: 'AI' })).body;
const course = (await api('POST', '/courses', { slug: `ai-c-${tag}`, title: 'AI', categoryIds: [cat.id] })).body;
const mod = (await api('POST', `/courses/${course.id}/modules`, { title: 'M' })).body;
const lesson = (await api('POST', `/modules/${mod.id}/lessons`, { title: 'Explain try/catch', type: 'AI_PROMPT', isFree: true, baseXp: 30, baseCoins: 15 })).body;
sql(`DELETE FROM "Progress" WHERE "lessonId"='${lesson.id}'`);
sql(`DELETE FROM "AiSubmission" WHERE "userId"='${STUDENT_ID}'`);

const created = await api('POST', `/lessons/${lesson.id}/ai-prompt`, {
  promptText: 'Explain how to handle errors in JavaScript and why it matters.',
  contextText: 'Audience: a beginner.',
  passThreshold: 70,
  rubric: [
    { id: 'kw', label: 'Mentions try/catch', weight: 2, kind: 'keyword', config: { all: ['try', 'catch'] } },
    { id: 'rx', label: 'References an Error object', weight: 1, kind: 'regex', config: { pattern: 'error', flags: 'i' } },
    { id: 'len', label: 'Explains in enough detail', weight: 1, kind: 'minWords', config: { min: 20 } },
    { id: 'llm', label: 'Explains WHY error handling matters', weight: 2, kind: 'llm', config: { concepts: ['crash', 'user', 'recover', 'graceful'] } },
  ],
});
must(created.status === 201 && created.body?.id, 'created AI prompt on lesson', `${created.status}: ${created.raw}`);
await api('POST', `/courses/${course.id}/publish`, {});

const STRONG = 'In JavaScript you handle errors with a try/catch block: code that might throw goes in try, and the catch clause receives the Error object so you can react. This matters because an unhandled error can crash the program or leave the user stuck; catching it lets you recover gracefully and show a helpful message.';
const WEAK = 'Use try it and hope nothing breaks.';

// Admin preview of the strong answer passes.
const preview = await api('POST', `/ai-prompts/${created.body.id}/preview`, { response: STRONG });
must(preview.body?.passed === true && preview.body?.scorePct >= 70, 'admin preview: reference answer passes', JSON.stringify(preview.body?.scorePct));

// 2. Student view hides rubric config.
const view = await api('GET', `/lessons/${lesson.id}/ai-prompt`, null, STUDENT);
must((view.body?.rubric ?? []).length === 4 && !JSON.stringify(view.body).includes('concepts') && !JSON.stringify(view.body).includes('pattern'), 'student view: rubric labels only (no config leaked)', '');
const promptId = view.body.id;

// 3. Weak answer → FAIL with a breakdown.
const weak = await api('POST', `/ai-prompts/${promptId}/submit`, { response: WEAK }, STUDENT);
must(weak.body?.passed === false, 'weak answer → FAIL', JSON.stringify({ s: weak.body?.scorePct }));
must((weak.body?.results ?? []).some((r) => r.id === 'kw' && r.passed === false), 'breakdown flags the missing keyword criterion', JSON.stringify(weak.body?.results?.map((r) => [r.id, r.passed])));
must(weak.body?.reward == null, 'no reward on fail', '');

await sleep(3100);

// 4. Strong answer → PASS + reward.
const xpBefore = parseInt(sql(`SELECT "totalXp" FROM "User" WHERE id='${STUDENT_ID}'`), 10);
const t0 = Date.now();
const strong = await api('POST', `/ai-prompts/${promptId}/submit`, { response: STRONG }, STUDENT);
const elapsed = Date.now() - t0;
must(strong.body?.passed === true && strong.body?.scorePct >= 70, 'strong answer → PASS', JSON.stringify(strong.body?.scorePct));
must(strong.body?.reward?.xp > 0 && strong.body?.reward?.coins > 0, 'first-pass reward granted', JSON.stringify(strong.body?.reward));
const xpAfter = parseInt(sql(`SELECT "totalXp" FROM "User" WHERE id='${STUDENT_ID}'`), 10);
must(xpAfter > xpBefore, 'user XP increased', `${xpBefore}->${xpAfter}`);
must(sql(`SELECT count(*) FROM "Progress" WHERE "lessonId"='${lesson.id}' AND "userId"='${STUDENT_ID}'`) === '1', 'AI-prompt pass marked the lesson complete', '');
must(elapsed < 3000, 'grading round-trips well under 3s (p95 acceptance)', `${elapsed}ms`);

await sleep(3100);

// 5. Identical answer is served from cache.
const cachedSub = await api('POST', `/ai-prompts/${promptId}/submit`, { response: STRONG }, STUDENT);
must(cachedSub.body?.cached === true && cachedSub.body?.passed === true, 'identical response served from cache', JSON.stringify(cachedSub.body?.cached));

// 6. Rate limit.
const fast = await api('POST', `/ai-prompts/${promptId}/submit`, { response: STRONG }, STUDENT);
must(fast.status === 429, 'rapid re-submit → 429 rate limit', `${fast.status}`);

console.log(`\n${failures === 0 ? '✅ PASS' : `❌ ${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
