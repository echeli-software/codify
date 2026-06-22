#!/usr/bin/env node
/**
 * Phase 11b probe — push device tokens + streak reminders.
 *
 *   1. STUDENT registers a device token via POST /devices.
 *   2. Set up three streaks: at-risk (acted yesterday, valid token),
 *      control (acted today), at-risk with a stale token.
 *   3. ADMIN POST /notifications/streak-reminder/run.
 *   4. The DevPushProvider captured a streak_reminder for the at-risk token
 *      (acceptance #2, software side), NOT for the control token.
 *   5. The stale "invalid-*" token was pruned from DeviceToken.
 *   6. DELETE /devices/:token unregisters.
 */

import { execSync } from 'node:child_process';

const API = 'http://localhost:3000/api';
const ADMIN = 'Bearer dev-token-admin';
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
function setStreak(userId, days, daysAgo) {
  sql(`INSERT INTO "Streak" ("userId","currentDays","longestDays","freezesAvailable","lastActivityDate","updatedAt")
       VALUES ('${userId}',${days},${days},0, now() - interval '${daysAgo} days', now())
       ON CONFLICT ("userId") DO UPDATE SET "currentDays"=${days}, "lastActivityDate"=now() - interval '${daysAgo} days'`);
}

console.log(`Phase 11b probe — tag ${tag}\n`);

const T_RISK = `tok-risk-${tag}`;
const T_CTRL = `tok-ctrl-${tag}`;
const T_STALE = `invalid-${tag}`;

// 1. Register the at-risk student's token (materializes nothing new; dev-student exists).
const reg = await api('POST', '/devices', { token: T_RISK, platform: 'IOS' }, 'Bearer dev-token-student');
must(reg.status === 201 && reg.body?.id, 'student registered device token', `${reg.status}: ${reg.raw}`);
const riskId = sql(`SELECT id FROM "User" WHERE "clerkId"='dev-student'`);

// Control + stale-token students (registering materializes the users via auth middleware).
await api('POST', '/devices', { token: T_CTRL, platform: 'ANDROID' }, 'Bearer dev-token-student2');
await api('POST', '/devices', { token: T_STALE, platform: 'IOS' }, 'Bearer dev-token-student3');
const ctrlId = sql(`SELECT id FROM "User" WHERE "clerkId"='dev-student2'`);
const staleId = sql(`SELECT id FROM "User" WHERE "clerkId"='dev-student3'`);
must(!!ctrlId && !!staleId, 'control + stale-token users materialized', `${ctrlId} ${staleId}`);

// 2. Streaks: risk acted 2 days ago, control acted today, stale acted 2 days ago.
setStreak(riskId, 5, 2);
setStreak(ctrlId, 3, 0);
setStreak(staleId, 2, 2);
ok('streak state seeded (risk=5d/2d-ago, control=3d/today, stale=2d/2d-ago)');

// 3. Trigger reminders.
const run = await api('POST', '/notifications/streak-reminder/run', {});
must(run.status === 201 || run.status === 200, 'streak-reminder run ok', `${run.status}: ${run.raw}`);
must((run.body?.pruned ?? 0) >= 1, 'run reports pruned stale token(s)', JSON.stringify(run.body));

// 4. The at-risk token got a streak_reminder; control did not.
const riskSent = await api('GET', `/notifications/dev/sent?token=${encodeURIComponent(T_RISK)}`);
const riskMsgs = riskSent.body?.messages ?? [];
must(riskMsgs.length >= 1, 'at-risk device received a push (acceptance #2)', JSON.stringify(riskMsgs.length));
const m = riskMsgs[riskMsgs.length - 1];
must(m?.data?.type === 'streak_reminder' && m?.data?.streakDays === '5', 'push payload is a streak_reminder with day count', JSON.stringify(m?.data));
must(/streak|sequ/i.test(m?.body ?? ''), 'push body has streak copy', JSON.stringify(m?.body));

const ctrlSent = await api('GET', `/notifications/dev/sent?token=${encodeURIComponent(T_CTRL)}`);
must((ctrlSent.body?.messages ?? []).length === 0, 'control device (acted today) was NOT reminded', JSON.stringify(ctrlSent.body?.messages?.length));

// 5. Stale token pruned from the DB.
const staleCount = sql(`SELECT count(*) FROM "DeviceToken" WHERE token='${T_STALE}'`);
must(staleCount === '0', 'stale "invalid-*" token pruned from DeviceToken', staleCount);

// 6. Unregister.
const del = await api('DELETE', `/devices/${encodeURIComponent(T_RISK)}`, null, 'Bearer dev-token-student');
must(del.body?.removed === 1, 'DELETE /devices/:token unregisters', JSON.stringify(del.body));
must(sql(`SELECT count(*) FROM "DeviceToken" WHERE token='${T_RISK}'`) === '0', 'token gone after unregister', '');

console.log(`\n${failures === 0 ? '✅ PASS' : `❌ ${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
