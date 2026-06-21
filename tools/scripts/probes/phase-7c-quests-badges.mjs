#!/usr/bin/env node
/**
 * Phase 7c probe — daily quests + badges + streak milestone.
 *
 *   0. Reset dev-student gamification state; deactivate prior templates/badges
 *      so the daily picker + badge evaluator are deterministic.
 *   1. ADMIN creates 3 quest templates (easy LESSON_COUNT=1, medium XP_AMOUNT,
 *      hard LESSON_COUNT=3) + a "first-steps" badge (lesson_complete ≥ 1).
 *   2. Seed a course with two free lessons; publish.
 *   3. STUDENT GET /quests/today → 3 quests assigned (one per difficulty).
 *   4. STUDENT completes lesson A → response carries questsCompleted (easy +
 *      medium) and badgesUnlocked (first-steps); streak.currentDays = 1.
 *   5. GET /badges → first-steps earned; GET /quests/today → easy quest done.
 *   6. Streak milestone: force streak to 6 (yesterday), complete lesson B →
 *      reward.streakMilestone = { days: 7, coins: 50 }, freeze earned.
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
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* */ }
  return { status: res.status, body: json, raw: text };
}
function sql(q) {
  return execSync(`docker exec codify-postgres psql -U codify -d codify_dev -A -t -c "${q.replace(/"/g, '\\"')}"`, { encoding: 'utf8' }).trim();
}

console.log(`Phase 7c probe — tag ${tag}\n`);

// 0. Reset
const uidSub = `(SELECT id FROM "User" WHERE "clerkId"='dev-student')`;
for (const t of ['CoinTransaction', 'XpEvent', 'Progress', 'Streak', 'QuestAssignment', 'UserBadge']) {
  sql(`DELETE FROM "${t}" WHERE "userId" IN ${uidSub}`);
}
sql(`UPDATE "User" SET coins=0, "totalXp"=0 WHERE "clerkId"='dev-student'`);
sql(`UPDATE "QuestTemplate" SET "isActive"=false`);
sql(`UPDATE "Badge" SET "isActive"=false`);
sql(`DELETE FROM "Multiplier" WHERE kind='CAMPAIGN'`);
ok('reset state + deactivated prior templates/badges');

// 1. Templates + badge
const easy = (await api('POST', '/quest-templates', { slug: `q-easy-${tag}`, kind: 'LESSON_COUNT', title: 'Finish a lesson', difficulty: 1, target: 1, xpReward: 5, coinReward: 5 })).body;
const med = (await api('POST', '/quest-templates', { slug: `q-med-${tag}`, kind: 'XP_AMOUNT', title: 'Earn 5 XP', difficulty: 2, target: 5, xpReward: 5, coinReward: 10 })).body;
const hard = (await api('POST', '/quest-templates', { slug: `q-hard-${tag}`, kind: 'LESSON_COUNT', title: 'Finish 3 lessons', difficulty: 3, target: 3, xpReward: 20, coinReward: 20 })).body;
const badge = (await api('POST', '/badges', { slug: `first-steps-${tag}`, name: 'First Steps', iconName: 'rocket', rule: { all: [{ event: 'lesson_complete', count: { gte: 1 } }] }, xpReward: 15, coinReward: 25 })).body;
must(easy?.id && med?.id && hard?.id && badge?.id, 'created 3 templates + 1 badge', JSON.stringify({ easy: easy?.id, badge: badge?.id }));

// 2. Seed course
const cat = (await api('POST', '/categories', { slug: `q-cat-${tag}`, name: 'C' })).body;
const course = (await api('POST', '/courses', { slug: `q-c-${tag}`, title: 'C', categoryIds: [cat.id] })).body;
const mod = (await api('POST', `/courses/${course.id}/modules`, { title: 'M' })).body;
const lessonA = (await api('POST', `/modules/${mod.id}/lessons`, { title: 'A', type: 'READING', isFree: true, baseXp: 10, baseCoins: 5 })).body;
const lessonB = (await api('POST', `/modules/${mod.id}/lessons`, { title: 'B', type: 'READING', isFree: true, baseXp: 10, baseCoins: 5 })).body;
await api('POST', `/courses/${course.id}/publish`, {});
ok('seeded course with two free lessons');

// 3. Today's quests (lazy assign)
const today = await api('GET', '/quests/today', null, STUDENT);
const slugs = (today.body ?? []).map((q) => q.slug);
must(today.body?.length === 3, 'today has 3 quests', JSON.stringify(slugs));
must(slugs.includes(easy.slug) && slugs.includes(med.slug) && slugs.includes(hard.slug), 'one per difficulty assigned', JSON.stringify(slugs));

// 4. Complete lesson A
const c1 = await api('POST', `/lessons/${lessonA.id}/complete`, {}, STUDENT);
must(c1.status === 201, 'complete A → 201', `${c1.status}: ${c1.raw}`);
const doneSlugsViaTitle = (c1.body?.questsCompleted ?? []).map((q) => q.title);
must((c1.body?.questsCompleted ?? []).length >= 1, 'questsCompleted returned', JSON.stringify(doneSlugsViaTitle));
must(doneSlugsViaTitle.includes('Finish a lesson'), 'easy quest completed', JSON.stringify(doneSlugsViaTitle));
must(doneSlugsViaTitle.includes('Earn 5 XP'), 'medium XP quest completed (10 XP earned)', JSON.stringify(doneSlugsViaTitle));
must((c1.body?.badgesUnlocked ?? []).some((b) => b.slug === badge.slug), 'first-steps badge unlocked', JSON.stringify(c1.body?.badgesUnlocked));
must(c1.body?.reward?.streak?.currentDays === 1, 'streak started at 1', JSON.stringify(c1.body?.reward?.streak));

// 5. Read-side reflects it
const badgesNow = await api('GET', '/badges', null, STUDENT);
must((badgesNow.body ?? []).some((b) => b.slug === badge.slug && b.earned), 'GET /badges shows first-steps earned', JSON.stringify(badgesNow.body?.map((b) => [b.slug, b.earned])));
const todayNow = await api('GET', '/quests/today', null, STUDENT);
must((todayNow.body ?? []).find((q) => q.slug === easy.slug)?.completed === true, 'easy quest now completed in /quests/today', '');

// 6. Streak milestone — push to 6 (yesterday), complete B → 7
sql(`UPDATE "Streak" SET "currentDays"=6, "longestDays"=6, "lastActivityDate"=(CURRENT_DATE - INTERVAL '1 day') WHERE "userId" IN ${uidSub}`);
const c2 = await api('POST', `/lessons/${lessonB.id}/complete`, {}, STUDENT);
must(c2.status === 201, 'complete B → 201', `${c2.status}: ${c2.raw}`);
must(c2.body?.reward?.streak?.currentDays === 7, 'streak advanced to 7', JSON.stringify(c2.body?.reward?.streak));
must(c2.body?.reward?.streakMilestone?.days === 7 && c2.body?.reward?.streakMilestone?.coins === 50, 'streak milestone {7, +50 coins}', JSON.stringify(c2.body?.reward?.streakMilestone));
must(c2.body?.reward?.streak?.freezesAvailable === 1, 'freeze earned at 7-day milestone', JSON.stringify(c2.body?.reward?.streak));

console.log(`\n${failures === 0 ? '✅ PASS' : `❌ ${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
