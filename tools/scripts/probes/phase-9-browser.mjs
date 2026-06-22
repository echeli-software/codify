#!/usr/bin/env node
/**
 * Phase 9 browser probe — League screen + Friends + Profile UI.
 *
 * Requires API (:3000) and student (:4201).
 *
 *   1. Seed: dev-student completes a lesson (earns league standing).
 *   2. League tab: hero + my rank + leaderboard rows + reset countdown.
 *   3. Friends: add student2 by email → "Request sent"; (API) student2
 *      accepts; reload → student2 in the friends list; nudge → confirmation.
 *   4. Tap the friend → public profile page renders (hero + stats).
 */

import { execSync } from 'node:child_process';
import puppeteer from '../../../node_modules/puppeteer/lib/esm/puppeteer/puppeteer.js';

const API = 'http://localhost:3000/api';
const STU = 'http://localhost:4201';
const tok = (who) => `Bearer dev-token-${who}`;

const tag = Date.now().toString(36);
let failures = 0;
const fail = (m) => { failures += 1; console.error('  FAIL:', m); };
const ok = (m) => console.log('  OK:', m);
const must = (c, l, ctx = '') => (c ? ok(l) : fail(`${l} — ${ctx}`));

async function api(method, path, body, auth = tok('admin')) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'content-type': 'application/json', authorization: auth, 'idempotency-key': crypto.randomUUID() },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}
function sql(q) {
  return execSync(`docker exec codify-postgres psql -U codify -d codify_dev -A -t -c "${q.replace(/"/g, '\\"')}"`, { encoding: 'utf8' }).trim();
}

console.log(`Phase 9 browser probe — tag ${tag}\n`);

// Seed: ensure dev-student has league standing.
const cat = (await api('POST', '/categories', { slug: `p9-${tag}`, name: 'P' })).body;
const course = (await api('POST', '/courses', { slug: `p9-c-${tag}`, title: 'P', categoryIds: [cat.id] })).body;
const mod = (await api('POST', `/courses/${course.id}/modules`, { title: 'M' })).body;
const lesson = (await api('POST', `/modules/${mod.id}/lessons`, { title: 'L', type: 'READING', isFree: true })).body;
await api('POST', `/courses/${course.id}/publish`, {});
await api('POST', `/lessons/${lesson.id}/complete`, {}, tok('student'));
const s1 = (await api('GET', '/me', null, tok('student'))).body.id;
const s2 = (await api('GET', '/me', null, tok('student2'))).body.id;
// Clean prior friendship/requests so the add flow is deterministic.
sql(`DELETE FROM "Friendship" WHERE ("userAId"='${s1}' AND "userBId"='${s2}') OR ("userAId"='${s2}' AND "userBId"='${s1}')`);
sql(`DELETE FROM "FriendRequest" WHERE ("senderId"='${s1}' AND "receiverId"='${s2}') OR ("senderId"='${s2}' AND "receiverId"='${s1}')`);
sql(`DELETE FROM "FriendNudge" WHERE "senderId"='${s1}' AND "receiverId"='${s2}'`);
ok('seeded standing + cleaned friend state');

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('   [pageerror]', String(e).slice(0, 160)));
  await page.goto(`${STU}/login`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    localStorage.setItem('codify.auth.user', JSON.stringify({ id: 'dev-student', email: 'student@codify.local', displayName: 'Maria', role: 'STUDENT', avatarUrl: null, locale: 'pt-BR' }));
    localStorage.setItem('codify.auth.token', JSON.stringify({ token: 'dev-token-student', expiresAt: null }));
  });

  // 2. League screen
  await page.goto(`${STU}/league`, { waitUntil: 'networkidle2' });
  must(await page.waitForSelector('[data-testid="league-hero"]', { timeout: 12_000 }).then(() => true).catch(() => false), 'league hero renders', '');
  const myRank = await page.$eval('[data-testid="my-rank"]', (el) => el.textContent || '').catch(() => '');
  must(/#\d+/.test(myRank), 'my rank shown', JSON.stringify(myRank));
  const resetText = await page.$eval('[data-testid="league-reset"]', (el) => el.textContent || '').catch(() => '');
  must(/Resets in/.test(resetText), 'reset countdown shown', JSON.stringify(resetText.trim()));
  const rows = await page.$$eval('[data-testid="leaderboard"] .row', (els) => els.length);
  must(rows >= 1, 'leaderboard has rows', `${rows}`);

  // 3. Friends — add student2, accept (API), nudge.
  await page.goto(`${STU}/friends`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('[data-testid="friend-email"]', { timeout: 10_000 }).catch(() => {});
  await page.type('[data-testid="friend-email"] input', 'student2@codify.local');
  await page.evaluate(() => document.querySelector('[data-testid="add-friend-btn"] ion-button')?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  const sentMsg = await page.waitForFunction(() => /sent|pending/i.test(document.querySelector('.msg')?.textContent || ''), { timeout: 8_000 }).then(() => true).catch(() => false);
  must(sentMsg, 'friend request sent via UI', '');

  // student2 accepts the request (server side).
  const reqId = (await api('GET', '/friends/requests', null, tok('student2'))).body.find((r) => r.senderId === s1)?.id;
  await api('POST', `/friends/requests/${reqId}/respond`, { accept: true }, tok('student2'));

  await page.goto(`${STU}/friends`, { waitUntil: 'networkidle2' });
  const friendShown = await page.waitForSelector(`[data-testid="friends-list"] [data-user-id="${s2}"]`, { timeout: 10_000 }).then(() => true).catch(() => false);
  must(friendShown, 'accepted friend appears in the list', '');
  await page.evaluate((id) => document.querySelector(`[data-user-id="${id}"] [data-testid="nudge-btn"] ion-button`)?.dispatchEvent(new MouseEvent('click', { bubbles: true })), s2);
  const nudgeMsg = await page.waitForFunction(() => /nudged/i.test(document.querySelector('.msg')?.textContent || ''), { timeout: 8_000 }).then(() => true).catch(() => false);
  must(nudgeMsg, 'nudging a friend confirms', '');

  // 4. Public profile
  await page.goto(`${STU}/u/${s2}`, { waitUntil: 'networkidle2' });
  must(await page.waitForSelector('[data-testid="profile-hero"]', { timeout: 10_000 }).then(() => true).catch(() => false), 'profile hero renders', '');
  must(!!(await page.$('[data-testid="profile-stats"]')), 'profile stats render', '');
} finally {
  await browser.close();
}

console.log(`\n${failures === 0 ? '✅ PASS' : `❌ ${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
