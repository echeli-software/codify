#!/usr/bin/env node
/**
 * Phase 7 browser probe — reward pipeline → client celebration + admin UI.
 *
 * Requires API (:3000), student (:4201), admin (:4202).
 *
 *   1. Reset dev-student; seed (admin API): one active easy quest template,
 *      a CAMPAIGN ×2 multiplier, a course with a free lesson (base 10 XP).
 *   2. STUDENT lesson page: click "Mark as complete" → the completed state
 *      shows the canonical post-multiplier award (20 XP = 10 × 2), proving
 *      the server reward flowed into the client + RewardOrchestrator ran.
 *   3. STUDENT Today: the server-assigned daily quest renders.
 *   4. ADMIN Gamification page boots; adding a multiplier through the UI
 *      appends it to the list.
 */

import { execSync } from 'node:child_process';
import puppeteer from '../../../node_modules/puppeteer/lib/esm/puppeteer/puppeteer.js';

const API = 'http://localhost:3000/api';
const STU = 'http://localhost:4201';
const ADM = 'http://localhost:4202';
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
  return { status: res.status, body: text ? JSON.parse(text) : null };
}
function sql(q) {
  return execSync(`docker exec codify-postgres psql -U codify -d codify_dev -A -t -c "${q.replace(/"/g, '\\"')}"`, { encoding: 'utf8' }).trim();
}
async function authptr(page, role) {
  await page.evaluate((r) => {
    localStorage.setItem('codify.auth.user', JSON.stringify({ id: `dev-${r}`, email: `${r}@codify.local`, displayName: r, role: r.toUpperCase(), avatarUrl: null, locale: 'pt-BR' }));
    localStorage.setItem('codify.auth.token', JSON.stringify({ token: `dev-token-${r}`, expiresAt: null }));
  }, role);
}

console.log(`Phase 7 browser probe — tag ${tag}\n`);

// 1. Reset + seed
const uid = `(SELECT id FROM "User" WHERE "clerkId"='dev-student')`;
for (const t of ['CoinTransaction', 'XpEvent', 'Progress', 'Streak', 'QuestAssignment', 'UserBadge']) sql(`DELETE FROM "${t}" WHERE "userId" IN ${uid}`);
sql(`UPDATE "User" SET coins=0, "totalXp"=0 WHERE "clerkId"='dev-student'`);
sql(`UPDATE "QuestTemplate" SET "isActive"=false`);
sql(`DELETE FROM "Multiplier" WHERE kind='CAMPAIGN'`);
await api('POST', '/quest-templates', { slug: `b-easy-${tag}`, kind: 'LESSON_COUNT', title: `Finish a lesson ${tag}`, difficulty: 1, target: 1, xpReward: 5, coinReward: 5 });
await api('POST', '/multipliers', { kind: 'CAMPAIGN', target: 'BOTH', value: 2, description: 'probe 2x' });
const cat = (await api('POST', '/categories', { slug: `b-cat-${tag}`, name: 'B' })).body;
const course = (await api('POST', '/courses', { slug: `b-c-${tag}`, title: 'B', categoryIds: [cat.id] })).body;
const mod = (await api('POST', `/courses/${course.id}/modules`, { title: 'M' })).body;
const lesson = (await api('POST', `/modules/${mod.id}/lessons`, { title: 'Lesson', type: 'READING', isFree: true, baseXp: 10, baseCoins: 5 })).body;
await api('POST', `/courses/${course.id}/publish`, {});
ok('seeded quest + 2x campaign + free lesson');

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('   [pageerror]', String(e).slice(0, 160)));

  // 2. Student completes the lesson
  await page.goto(`${STU}/login`, { waitUntil: 'domcontentloaded' });
  await authptr(page, 'student');
  await page.goto(`${STU}/lessons/${lesson.id}`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('[data-testid="lesson-complete-btn"]', { timeout: 10_000 }).catch(() => {});
  const hasBtn = await page.$('[data-testid="lesson-complete-btn"]');
  must(!!hasBtn, 'lesson player shows complete button', '');
  if (hasBtn) {
    await page.click('[data-testid="lesson-complete-btn"] ion-button').catch(() => hasBtn.click());
    await page.waitForSelector('[data-testid="lesson-completed"]', { timeout: 10_000 }).catch(() => {});
    const txt = await page.$eval('[data-testid="lesson-completed"]', (el) => el.textContent || '').catch(() => '');
    must(/20/.test(txt), 'completed state shows canonical ×2 award (20 XP)', JSON.stringify(txt.replace(/\s+/g, ' ').trim().slice(0, 80)));
  }

  // 3. Today shows the server-assigned daily quest
  await page.goto(`${STU}/today`, { waitUntil: 'networkidle2' });
  const questText = await page
    .waitForFunction((t) => (document.body.textContent || '').includes(`Finish a lesson ${t}`), { timeout: 10_000 }, tag)
    .then(() => true)
    .catch(() => false);
  must(questText, 'Today renders the server-assigned daily quest', '');

  // 4. Admin Gamification page boots + add a multiplier via UI
  await page.goto(`${ADM}/login`, { waitUntil: 'domcontentloaded' });
  await authptr(page, 'admin');
  await page.goto(`${ADM}/gamification`, { waitUntil: 'networkidle2' });
  const sectionOk = await page.waitForSelector('[data-testid="multipliers-section"]', { timeout: 10_000 }).then(() => true).catch(() => false);
  must(sectionOk, 'admin Gamification page boots (multipliers section)', '');
  if (sectionOk) {
    const before = await page.$$eval('[data-testid="multipliers-section"] .rows li', (els) => els.length);
    await page.click('[data-testid="mult-value"] input', { clickCount: 3 }).catch(() => {});
    await page.type('[data-testid="mult-value"] input', '3');
    await page.click('[data-testid="add-mult-btn"] button');
    const grew = await page
      .waitForFunction((n) => document.querySelectorAll('[data-testid="multipliers-section"] .rows li').length > n, { timeout: 10_000 }, before)
      .then(() => true)
      .catch(() => false);
    must(grew, 'adding a multiplier via UI appends it to the list', `before=${before}`);
  }
} finally {
  await browser.close();
}

console.log(`\n${failures === 0 ? '✅ PASS' : `❌ ${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
