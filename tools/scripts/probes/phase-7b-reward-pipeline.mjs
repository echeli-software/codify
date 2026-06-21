#!/usr/bin/env node
/**
 * Phase 7b probe — server-authoritative reward pipeline + streak + multiplier.
 *
 *   1. Seed a course with two FREE lessons (so a no-sub student can complete).
 *   2. STUDENT completes lesson A → 201 with a canonical `reward`:
 *      base XP/coins (no active multiplier), streak.currentDays = 1,
 *      totals.level present, levelUp null. Progress.xpAwarded matches reward.
 *   3. Re-complete lesson A → 409 (idempotent; no double credit — totals
 *      unchanged vs. after step 2).
 *   4. Insert a CAMPAIGN 2x multiplier directly in the DB, complete lesson B
 *      → reward.multiplier = 2, xp = base×2, breakdown contains CAMPAIGN, and
 *      the coin ledger's balanceAfter equals the user's running coin total.
 *
 * Multiplier MATH is unit-tested in libs/domain; this asserts the
 * resolver↔pipeline↔ledger wiring end to end.
 */

import { execSync } from 'node:child_process';

const API = 'http://localhost:3000/api';
const ADMIN = 'Bearer dev-token-admin';
const STUDENT = 'Bearer dev-token-student';

const tag = Date.now().toString(36);
let failures = 0;
const fail = (m) => {
  failures += 1;
  console.error('  FAIL:', m);
};
const ok = (m) => console.log('  OK:', m);
const must = (c, l, ctx = '') => (c ? ok(l) : fail(`${l} — ${ctx}`));

async function api(method, path, body, auth = ADMIN) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'content-type': 'application/json', authorization: auth, 'idempotency-key': crypto.randomUUID() },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* */ }
  return { status: res.status, body: json, raw: text };
}

function sql(q) {
  return execSync(
    `docker exec codify-postgres psql -U codify -d codify_dev -A -t -c "${q.replace(/"/g, '\\"')}"`,
    { encoding: 'utf8' },
  ).trim();
}

console.log(`Phase 7b probe — tag ${tag}\n`);

// 0. Reset dev-student gamification state so assertions are deterministic
//    (prior probe runs accumulate XP/coins/streak/multipliers).
const uid = `(SELECT id FROM \\"User\\" WHERE \\"clerkId\\"='dev-student')`;
sql(`DELETE FROM "CoinTransaction" WHERE "userId" IN ${uid.replace(/\\"/g, '"')}`);
sql(`DELETE FROM "XpEvent" WHERE "userId" IN ${uid.replace(/\\"/g, '"')}`);
sql(`DELETE FROM "Progress" WHERE "userId" IN ${uid.replace(/\\"/g, '"')}`);
sql(`DELETE FROM "Streak" WHERE "userId" IN ${uid.replace(/\\"/g, '"')}`);
sql(`UPDATE "User" SET coins=0, "totalXp"=0 WHERE "clerkId"='dev-student'`);
sql(`DELETE FROM "Multiplier" WHERE kind='CAMPAIGN'`);
ok('reset dev-student state');

// 1. Seed
const cat = (await api('POST', '/categories', { slug: `p7b-${tag}`, name: 'G' })).body;
const course = (await api('POST', '/courses', { slug: `p7b-c-${tag}`, title: 'G', categoryIds: [cat.id] })).body;
const mod = (await api('POST', `/courses/${course.id}/modules`, { title: 'M' })).body;
const lessonA = (await api('POST', `/modules/${mod.id}/lessons`, { title: 'A', type: 'READING', isFree: true, baseXp: 10, baseCoins: 5 })).body;
const lessonB = (await api('POST', `/modules/${mod.id}/lessons`, { title: 'B', type: 'READING', isFree: true, baseXp: 10, baseCoins: 5 })).body;
await api('POST', `/courses/${course.id}/publish`, {});
must(lessonA?.id && lessonB?.id, 'seed two free lessons', JSON.stringify({ a: lessonA?.id }));

// 2. Complete A
const c1 = await api('POST', `/lessons/${lessonA.id}/complete`, {}, STUDENT);
must(c1.status === 201, 'complete A → 201', `${c1.status}: ${c1.raw}`);
const r1 = c1.body?.reward;
must(r1?.xp === 10 && r1?.coins === 5, 'base reward (xp 10 / coins 5, no multiplier)', JSON.stringify({ xp: r1?.xp, coins: r1?.coins }));
must(r1?.multiplier === 1, 'effective multiplier = 1', JSON.stringify(r1?.multiplier));
must(r1?.streak?.currentDays === 1, 'streak started at 1', JSON.stringify(r1?.streak));
must(typeof r1?.totals?.level === 'number', 'totals carries level', JSON.stringify(r1?.totals));
must(r1?.levelUp === null, 'no level-up on first small reward', JSON.stringify(r1?.levelUp));
must(c1.body?.progress?.xpAwarded === 10, 'Progress.xpAwarded = granted xp', JSON.stringify(c1.body?.progress));
const xpAfter1 = r1?.totals?.totalXp;

// 3. Idempotent replay
const c1b = await api('POST', `/lessons/${lessonA.id}/complete`, {}, STUDENT);
must(c1b.status === 409, 're-complete A → 409', `${c1b.status}`);
const xpNow = await api('GET', '/me', null, STUDENT).then((r) => r.body?.totalXp);
must(xpNow === xpAfter1, 'no double credit after replay', `${xpNow} vs ${xpAfter1}`);

// 4. Multiplier path — insert a global CAMPAIGN 2x, complete B
console.log('\nMultiplier wiring …');
sql(`INSERT INTO "Multiplier" (id, kind, target, value, "isActive", "createdAt", "updatedAt") VALUES (uuid_generate_v7(), 'CAMPAIGN', 'BOTH', 2.00, true, now(), now())`);
const c2 = await api('POST', `/lessons/${lessonB.id}/complete`, {}, STUDENT);
must(c2.status === 201, 'complete B → 201', `${c2.status}: ${c2.raw}`);
const r2 = c2.body?.reward;
must(r2?.multiplier === 2, 'effective multiplier = 2 (campaign)', JSON.stringify(r2?.multiplier));
must(r2?.xp === 20 && r2?.coins === 10, 'reward doubled (xp 20 / coins 10)', JSON.stringify({ xp: r2?.xp, coins: r2?.coins }));
must(
  (r2?.breakdown ?? []).some((b) => b.source === 'CAMPAIGN' && b.multiplier === 2),
  'breakdown lists CAMPAIGN ×2',
  JSON.stringify(r2?.breakdown),
);

// Ledger integrity: latest balanceAfter == running coin total == SUM(delta)
const studentId = await api('GET', '/me', null, STUDENT).then((r) => r.body?.id);
const runningCoins = await api('GET', '/me', null, STUDENT).then((r) => r.body?.coins ?? r2?.totals?.coins);
const balanceAfter = parseInt(sql(`SELECT "balanceAfter" FROM "CoinTransaction" WHERE "userId"='${studentId}' ORDER BY "createdAt" DESC LIMIT 1`), 10);
const sumDelta = parseInt(sql(`SELECT COALESCE(SUM(delta),0) FROM "CoinTransaction" WHERE "userId"='${studentId}'`), 10);
must(balanceAfter === sumDelta, 'ledger balanceAfter == SUM(delta) (no drift)', `${balanceAfter} vs ${sumDelta}`);
must(balanceAfter === (r2?.totals?.coins), 'ledger balanceAfter == reward totals.coins', `${balanceAfter} vs ${r2?.totals?.coins}`);

console.log(`\n${failures === 0 ? '✅ PASS' : `❌ ${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
