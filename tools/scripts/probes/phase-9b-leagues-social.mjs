#!/usr/bin/env node
/**
 * Phase 9b probe — leagues (accumulation, sharding, rollover) + friends + profile.
 *
 *   A. Weekly XP accumulation: a lesson completion bumps the cohort standing.
 *   B. Cohort sharding: 33 students assigned → no cohort exceeds 30, ≥2 cohorts.
 *   C. Rollover: a finished BRONZE cohort ranks members; #1 promotes with
 *      150 coins + a freeze; re-running is idempotent.
 *   D. Friends: request → accept → list; nudge respects a 24h rate limit.
 *   E. Profile: public profile returns level + stats.
 */

import { execSync } from 'node:child_process';

const API = 'http://localhost:3000/api';
const ADMIN = 'Bearer dev-token-admin';
const tok = (who) => `Bearer dev-token-${who}`;

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
function sql(q) {
  return execSync(`docker exec codify-postgres psql -U codify -d codify_dev -A -t -c "${q.replace(/"/g, '\\"')}"`, { encoding: 'utf8' }).trim();
}
function prevMondayISO() {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7) - 7);
  return d.toISOString();
}

console.log(`Phase 9b probe — tag ${tag}\n`);

// Seed a free lesson everyone can complete.
const cat = (await api('POST', '/categories', { slug: `l9-${tag}`, name: 'L' })).body;
const course = (await api('POST', '/courses', { slug: `l9-c-${tag}`, title: 'L', categoryIds: [cat.id] })).body;
const mod = (await api('POST', `/courses/${course.id}/modules`, { title: 'M' })).body;
const lesson = (await api('POST', `/modules/${mod.id}/lessons`, { title: 'L', type: 'READING', isFree: true, baseXp: 10, baseCoins: 5 })).body;
await api('POST', `/courses/${course.id}/publish`, {});

// ─── A. Accumulation ───────────────────────────────────────────────────
console.log('A. Weekly XP accumulation');
await api('POST', `/lessons/${lesson.id}/complete`, {}, tok('student')); // may 409 if already done this run
const cur = await api('GET', '/league/current', null, tok('student'));
must(cur.status === 200, 'GET /league/current 200', `${cur.status}: ${cur.raw}`);
must(cur.body?.myWeeklyXp > 0 && cur.body?.myRank >= 1, 'caller is ranked with weekly XP', JSON.stringify({ xp: cur.body?.myWeeklyXp, rank: cur.body?.myRank }));
must(!!cur.body?.tier && new Date(cur.body?.resetAt) > new Date(), 'tier + future reset time present', JSON.stringify({ tier: cur.body?.tier, resetAt: cur.body?.resetAt }));

// ─── B. Sharding ───────────────────────────────────────────────────────
console.log('\nB. Cohort sharding (33 students)');
const N = 33;
for (let i = 100; i < 100 + N; i++) {
  await api('GET', '/me', null, tok(`student${i}`)); // create user
  const r = await api('POST', `/lessons/${lesson.id}/complete`, {}, tok(`student${i}`));
  if (r.status !== 201 && r.status !== 409) fail(`studentN complete ${i}: ${r.status}`);
}
const ws = sql(`SELECT date_trunc('week', now())::date`); // not used for assert; informational
const sizes = sql(`SELECT count(*) FROM "LeagueMembership" m JOIN "League" l ON l.id=m."leagueId" WHERE l."weekStart" = date_trunc('week', (now() at time zone 'UTC'))::timestamptz GROUP BY m."leagueId" ORDER BY count(*) DESC`);
const cohortSizes = sizes.split('\n').filter(Boolean).map((s) => parseInt(s, 10));
must(cohortSizes.length >= 2, 'at least 2 cohorts for this week (>30 users)', JSON.stringify(cohortSizes));
must(cohortSizes.every((s) => s <= 30), 'no cohort exceeds capacity (30)', JSON.stringify(cohortSizes));

// ─── C. Rollover ───────────────────────────────────────────────────────
console.log('\nC. Rollover rewards + idempotency');
const prev = prevMondayISO();
// Build a finished BRONZE cohort from 10 fresh students with descending XP.
const rollIds = [];
for (let i = 200; i < 210; i++) {
  const me = await api('GET', '/me', null, tok(`student${i}`));
  rollIds.push(me.body.id);
}
const leagueRaw = sql(`INSERT INTO "League"(id,tier,"weekStart","cohortKey","createdAt") VALUES (uuid_generate_v7(),'BRONZE','${prev}','roll-${tag}',now()) RETURNING id`);
const leagueId = (leagueRaw.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/) || [''])[0];
rollIds.forEach((uid, idx) => {
  const xp = (10 - idx) * 100; // student200 highest
  sql(`INSERT INTO "LeagueMembership"("leagueId","userId","weeklyXp") VALUES ('${leagueId}','${uid}',${xp})`);
});
const winnerId = rollIds[0];
const winnerCoinsBefore = parseInt(sql(`SELECT coins FROM "User" WHERE id='${winnerId}'`), 10);

const roll = await api('POST', '/league/rollover', { weekStart: prev });
must(roll.status === 200 || roll.status === 201, 'rollover ran', `${roll.status}: ${roll.raw}`);
must(roll.body?.promotions >= 7, 'top 7 promoted', JSON.stringify(roll.body));
const winnerPromoted = sql(`SELECT promoted FROM "LeagueMembership" WHERE "leagueId"='${leagueId}' AND "userId"='${winnerId}'`);
must(winnerPromoted === 't', 'cohort #1 marked promoted', winnerPromoted);
const winnerCoinsAfter = parseInt(sql(`SELECT coins FROM "User" WHERE id='${winnerId}'`), 10);
must(winnerCoinsAfter - winnerCoinsBefore === 150, '#1 got 150 coins (100 promo + 50 rank-1)', `${winnerCoinsBefore}->${winnerCoinsAfter}`);
const winnerFreeze = parseInt(sql(`SELECT COALESCE("freezesAvailable",0) FROM "Streak" WHERE "userId"='${winnerId}'`) || '0', 10);
must(winnerFreeze >= 1, '#1 got a freeze', `${winnerFreeze}`);

// Idempotent re-run: no further coin change.
const roll2 = await api('POST', '/league/rollover', { weekStart: prev });
must(roll2.body?.membersRewarded === 0, 're-run rewards nobody (idempotent)', JSON.stringify(roll2.body));
const winnerCoinsAfter2 = parseInt(sql(`SELECT coins FROM "User" WHERE id='${winnerId}'`), 10);
must(winnerCoinsAfter2 === winnerCoinsAfter, 'no double reward on re-run', `${winnerCoinsAfter2}`);

// ─── D. Friends + nudge ────────────────────────────────────────────────
console.log('\nD. Friends + nudge rate limit');
// Clean any prior friendship/requests between student and student2.
const s1 = await api('GET', '/me', null, tok('student')).then((r) => r.body.id);
const s2 = await api('GET', '/me', null, tok('student2')).then((r) => r.body.id);
sql(`DELETE FROM "Friendship" WHERE ("userAId"='${s1}' AND "userBId"='${s2}') OR ("userAId"='${s2}' AND "userBId"='${s1}')`);
sql(`DELETE FROM "FriendRequest" WHERE ("senderId"='${s1}' AND "receiverId"='${s2}') OR ("senderId"='${s2}' AND "receiverId"='${s1}')`);
sql(`DELETE FROM "FriendNudge" WHERE "senderId"='${s1}' AND "receiverId"='${s2}'`);

const send = await api('POST', '/friends/requests', { email: 'student2@codify.local' }, tok('student'));
must(send.body?.status === 'sent', 'friend request sent', JSON.stringify(send.body));
const reqs = await api('GET', '/friends/requests', null, tok('student2'));
must((reqs.body ?? []).some((r) => r.senderId === s1), 'receiver sees incoming request', JSON.stringify(reqs.body?.length));
const reqId = (reqs.body ?? []).find((r) => r.senderId === s1)?.id;
const acc = await api('POST', `/friends/requests/${reqId}/respond`, { accept: true }, tok('student2'));
must(acc.body?.status === 'accepted', 'request accepted', JSON.stringify(acc.body));
const friends1 = await api('GET', '/friends', null, tok('student'));
must((friends1.body ?? []).some((f) => f.userId === s2), 'sender now lists the friend', JSON.stringify(friends1.body?.length));

const nudge1 = await api('POST', `/friends/${s2}/nudge`, {}, tok('student'));
must(nudge1.body?.status === 'nudged', 'first nudge ok', JSON.stringify(nudge1.body));
const nudge2 = await api('POST', `/friends/${s2}/nudge`, {}, tok('student'));
must(nudge2.status === 409, 'second nudge blocked by rate limit', `${nudge2.status}`);

// ─── E. Profile ────────────────────────────────────────────────────────
console.log('\nE. Public profile');
const prof = await api('GET', `/users/${s2}/profile`, null, tok('student'));
must(prof.status === 200 && typeof prof.body?.level === 'number', 'profile returns level', JSON.stringify({ status: prof.status, level: prof.body?.level }));
must(prof.body?.stats && typeof prof.body.stats.lessonsCompleted === 'number', 'profile returns stats', JSON.stringify(prof.body?.stats));

console.log(`\n${failures === 0 ? '✅ PASS' : `❌ ${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
