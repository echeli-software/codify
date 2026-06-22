#!/usr/bin/env node
/**
 * Phase 10b probe — auto-graded exercises (dev JS executor).
 *
 *   1. ADMIN creates an EXERCISE lesson with a `sum(a,b)` exercise
 *      (visible + hidden tests) and verifies the reference solution passes.
 *   2. STUDENT GET exercise → starter + visible tests, NO solution/hidden.
 *   3. Run (wrong code) → visible tests fail, not scored.
 *   4. Submit (wrong code) → FAIL, hidden tests not revealed.
 *   5. Submit (correct code) → PASS 100%, hidden tests revealed, first-pass
 *      reward (XP/coins) granted, lesson marked complete.
 *   6. Re-submit immediately → 429 (rate limit).
 *   7. Submit an infinite loop → TIMEOUT verdict (sandbox kills it).
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

console.log(`Phase 10b probe — tag ${tag}\n`);

// Reset student so first-pass reward is deterministic.
sql(`DELETE FROM "Progress" WHERE "userId" IN (SELECT id FROM "User" WHERE "clerkId"='dev-student')`);
sql(`DELETE FROM "Submission" WHERE "userId" IN (SELECT id FROM "User" WHERE "clerkId"='dev-student')`);

// 1. Seed exercise lesson
const cat = (await api('POST', '/categories', { slug: `ex-${tag}`, name: 'Ex' })).body;
const course = (await api('POST', '/courses', { slug: `ex-c-${tag}`, title: 'Ex', categoryIds: [cat.id] })).body;
const mod = (await api('POST', `/courses/${course.id}/modules`, { title: 'M' })).body;
const lesson = (await api('POST', `/modules/${mod.id}/lessons`, { title: 'Sum', type: 'EXERCISE', isFree: true, baseXp: 25, baseCoins: 12 })).body;
const ex = await api('POST', `/lessons/${lesson.id}/exercise`, {
  language: 'javascript',
  entryFunction: 'sum',
  starterCode: 'function sum(a, b) {\n  // your code\n}',
  solutionCode: 'function sum(a, b) { return a + b; }',
  visibleTests: [
    { id: 'v1', name: '1 + 2 = 3', args: [1, 2], expected: 3 },
    { id: 'v2', name: '0 + 0 = 0', args: [0, 0], expected: 0 },
  ],
  hiddenTests: [
    { id: 'h1', name: 'negatives', args: [-4, 1], expected: -3 },
    { id: 'h2', name: 'big', args: [1000, 2000], expected: 3000 },
  ],
});
must(ex.status === 201 && ex.body?.id, 'created exercise on lesson', `${ex.status}: ${ex.raw}`);
await api('POST', `/courses/${course.id}/publish`, {});

const verify = await api('POST', `/exercises/${ex.body.id}/verify`);
must(verify.body?.ok === true && verify.body?.scorePct === 100, 'reference solution verifies (100%)', JSON.stringify(verify.body?.scorePct));

// 2. Student view hides solution + hidden tests
const view = await api('GET', `/lessons/${lesson.id}/exercise`, null, STUDENT);
must(view.body?.starterCode?.includes('your code') && !('solutionCode' in (view.body ?? {})), 'student view: starter present, no solution', '');
must((view.body?.visibleTests ?? []).length === 2 && JSON.stringify(view.body).indexOf('h1') === -1, 'hidden tests not exposed', '');
const exId = view.body.id;

// 3. Run wrong code (visible only, unscored)
const runWrong = await api('POST', `/exercises/${exId}/run`, { code: 'function sum(a,b){ return a*b; }' }, STUDENT);
must(runWrong.body?.results?.length === 2 && runWrong.body.verdict === 'FAIL', 'run uses visible tests, reports FAIL', JSON.stringify(runWrong.body?.verdict));

// 4. Submit wrong code
const subWrong = await api('POST', `/exercises/${exId}/submit`, { code: 'function sum(a,b){ return a*b; }' }, STUDENT);
must(subWrong.body?.verdict === 'FAIL' && subWrong.body?.passed === false, 'submit wrong → FAIL', JSON.stringify(subWrong.body?.verdict));
must((subWrong.body?.hiddenRevealed ?? []).length === 0, 'hidden tests NOT revealed on fail', '');
must(!subWrong.body?.reward, 'no reward on fail', '');

await sleep(3100); // clear rate-limit window

// 5. Submit correct code → PASS + reward
const xpBefore = parseInt(sql(`SELECT "totalXp" FROM "User" WHERE "clerkId"='dev-student'`), 10);
const subOk = await api('POST', `/exercises/${exId}/submit`, { code: 'function sum(a,b){ return a + b; }' }, STUDENT);
must(subOk.body?.verdict === 'PASS' && subOk.body?.scorePct === 100, 'submit correct → PASS 100%', JSON.stringify({ v: subOk.body?.verdict, s: subOk.body?.scorePct }));
must((subOk.body?.hiddenRevealed ?? []).length === 2, 'hidden tests revealed on pass', JSON.stringify(subOk.body?.hiddenRevealed?.length));
must(subOk.body?.reward?.xp > 0 && subOk.body?.reward?.coins > 0, 'first-pass reward granted', JSON.stringify({ xp: subOk.body?.reward?.xp, coins: subOk.body?.reward?.coins }));
const xpAfter = parseInt(sql(`SELECT "totalXp" FROM "User" WHERE "clerkId"='dev-student'`), 10);
must(xpAfter > xpBefore, 'user XP increased', `${xpBefore}->${xpAfter}`);
const progressCount = parseInt(sql(`SELECT count(*) FROM "Progress" WHERE "lessonId"='${lesson.id}' AND "userId" IN (SELECT id FROM "User" WHERE "clerkId"='dev-student')`), 10);
must(progressCount === 1, 'exercise pass marked the lesson complete', `${progressCount}`);

// 6. Rate limit
const subFast = await api('POST', `/exercises/${exId}/submit`, { code: 'function sum(a,b){ return a + b; }' }, STUDENT);
must(subFast.status === 429, 'rapid re-submit → 429 rate limit', `${subFast.status}`);

// 7. Infinite loop → TIMEOUT
await sleep(3100);
const subLoop = await api('POST', `/exercises/${exId}/submit`, { code: 'function sum(a,b){ while(true){} }' }, STUDENT);
must(subLoop.body?.verdict === 'TIMEOUT', 'infinite loop caught as TIMEOUT', JSON.stringify(subLoop.body?.verdict));

console.log(`\n${failures === 0 ? '✅ PASS' : `❌ ${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
