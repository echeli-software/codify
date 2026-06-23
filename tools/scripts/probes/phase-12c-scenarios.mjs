#!/usr/bin/env node
/**
 * Phase 12c probe — branching scenario lessons.
 *
 *   1. ADMIN creates a SCENARIO lesson (2-deep branching graph); an invalid
 *      graph (dangling target) is rejected.
 *   2. STUDENT GET scenario → the graph (branching IS the content).
 *   3. Complete a 2-deep path → completed + outcome + first-completion reward
 *      + lesson complete (acceptance: 2+ branch depth).
 *   4. Replay a different branch → recorded, no second reward (acceptance: replay).
 *   5. An invalid choice path → 400.
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

const GRAPH = {
  startId: 'start',
  nodes: {
    start: { id: 'start', speaker: 'Customer', text: 'My order never arrived!', choices: [
      { id: 'a', label: 'Apologise and investigate', to: 'mid' },
      { id: 'b', label: 'Blame the courier', ending: true, outcome: 'bailed' },
    ] },
    mid: { id: 'mid', speaker: 'Customer', text: 'Okay, what now?', choices: [
      { id: 'x', label: 'Offer a refund', ending: true, outcome: 'resolved' },
      { id: 'y', label: 'Argue', ending: true, outcome: 'escalated' },
    ] },
  },
};

console.log(`Phase 12c probe — tag ${tag}\n`);

const STUDENT_ID = sql(`SELECT id FROM "User" WHERE "clerkId"='dev-student'`);

const cat = (await api('POST', '/categories', { slug: `sc-${tag}`, name: 'SC' })).body;
const course = (await api('POST', '/courses', { slug: `sc-c-${tag}`, title: 'SC', categoryIds: [cat.id] })).body;
const mod = (await api('POST', `/courses/${course.id}/modules`, { title: 'M' })).body;
const lesson = (await api('POST', `/modules/${mod.id}/lessons`, { title: 'Angry customer', type: 'SCENARIO', isFree: true, baseXp: 28, baseCoins: 14 })).body;
sql(`DELETE FROM "Progress" WHERE "lessonId"='${lesson.id}'`);
sql(`DELETE FROM "ScenarioRun" WHERE "userId"='${STUDENT_ID}'`);

// 1. Invalid graph rejected; valid graph accepted.
const bad = await api('POST', `/lessons/${lesson.id}/scenario`, { graph: { startId: 'start', nodes: { start: { id: 'start', text: 'hi', choices: [{ id: 'a', label: 'go', to: 'ghost' }] } } } });
must(bad.status === 400, 'invalid scenario (dangling target) → 400', `${bad.status}`);
const created = await api('POST', `/lessons/${lesson.id}/scenario`, { graph: GRAPH });
must(created.status === 201 && created.body?.id, 'created scenario on lesson', `${created.status}: ${created.raw}`);
await api('POST', `/courses/${course.id}/publish`, {});

// 2. Student sees the graph.
const view = await api('GET', `/lessons/${lesson.id}/scenario`, null, STUDENT);
must(view.body?.graph?.startId === 'start' && Object.keys(view.body?.graph?.nodes ?? {}).length === 2, 'student GET scenario returns the branching graph', JSON.stringify(Object.keys(view.body?.graph?.nodes ?? {})));
const scenarioId = view.body.id;

// 3. Complete a 2-deep path → reward.
const xpBefore = parseInt(sql(`SELECT "totalXp" FROM "User" WHERE id='${STUDENT_ID}'`), 10);
const done = await api('POST', `/scenarios/${scenarioId}/complete`, { path: ['a', 'x'] }, STUDENT);
must(done.body?.completed === true && done.body?.depth === 2 && done.body?.outcome === 'resolved', 'completed a 2-deep path (acceptance: 2+ depth)', JSON.stringify({ d: done.body?.depth, o: done.body?.outcome }));
must(done.body?.reward?.xp > 0 && done.body?.reward?.coins > 0, 'first-completion reward granted', JSON.stringify(done.body?.reward));
const xpAfter = parseInt(sql(`SELECT "totalXp" FROM "User" WHERE id='${STUDENT_ID}'`), 10);
must(xpAfter > xpBefore, 'user XP increased', `${xpBefore}->${xpAfter}`);
must(sql(`SELECT count(*) FROM "Progress" WHERE "lessonId"='${lesson.id}' AND "userId"='${STUDENT_ID}'`) === '1', 'scenario completion marked the lesson complete', '');

// 4. Replay a different branch → recorded, no second reward.
const replay = await api('POST', `/scenarios/${scenarioId}/complete`, { path: ['b'] }, STUDENT);
must(replay.body?.completed === true && replay.body?.outcome === 'bailed', 'replay a different branch works (acceptance: replay)', JSON.stringify(replay.body?.outcome));
must(replay.body?.reward == null, 'no second reward on replay', JSON.stringify(replay.body?.reward));
must(sql(`SELECT count(*) FROM "ScenarioRun" WHERE "userId"='${STUDENT_ID}' AND "scenarioId"='${scenarioId}'`) === '2', 'both play-throughs recorded as runs', '');

// 5. Invalid path → 400.
const invalid = await api('POST', `/scenarios/${scenarioId}/complete`, { path: ['a', 'nope'] }, STUDENT);
must(invalid.status === 400, 'invalid choice path → 400', `${invalid.status}`);

console.log(`\n${failures === 0 ? '✅ PASS' : `❌ ${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
