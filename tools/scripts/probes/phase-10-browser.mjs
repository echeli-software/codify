#!/usr/bin/env node
/**
 * Phase 10 browser probe — admin authors an exercise, student solves it.
 *
 * Requires API (:3000), student (:4201), admin (:4202).
 *
 *   1. Seed a free EXERCISE lesson.
 *   2. ADMIN exercise editor → Verify (saves defaults + runs reference
 *      solution) → "passes" confirmation.
 *   3. STUDENT lesson → ExerciseRunner: submit the (wrong) starter → FAIL;
 *      write the correct solution → submit → PASS + "Solved".
 */

import { execSync } from 'node:child_process';
import puppeteer from '../../../node_modules/puppeteer/lib/esm/puppeteer/puppeteer.js';

const API = 'http://localhost:3000/api';
const STU = 'http://localhost:4201';
const ADM = 'http://localhost:4202';
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
function sql(q) { return execSync(`docker exec codify-postgres psql -U codify -d codify_dev -A -t -c "${q.replace(/"/g, '\\"')}"`, { encoding: 'utf8' }).trim(); }
async function authptr(page, who, id) {
  await page.evaluate((w, uid) => {
    localStorage.setItem('codify.auth.user', JSON.stringify({ id: uid, email: `${w}@codify.local`, displayName: w, role: w.toUpperCase(), avatarUrl: null, locale: 'pt-BR' }));
    localStorage.setItem('codify.auth.token', JSON.stringify({ token: `dev-token-${w}`, expiresAt: null }));
  }, who, id);
}

console.log(`Phase 10 browser probe — tag ${tag}\n`);

const cat = (await api('POST', '/categories', { slug: `e10-${tag}`, name: 'E' })).body;
const course = (await api('POST', '/courses', { slug: `e10-c-${tag}`, title: 'E', categoryIds: [cat.id] })).body;
const mod = (await api('POST', `/courses/${course.id}/modules`, { title: 'M' })).body;
const lesson = (await api('POST', `/modules/${mod.id}/lessons`, { title: 'Coding', type: 'EXERCISE', isFree: true, baseXp: 25, baseCoins: 12 })).body;
await api('POST', `/courses/${course.id}/publish`, {});
// Clean any prior pass for dev-student so the runner is fresh.
sql(`DELETE FROM "Progress" WHERE "lessonId"='${lesson.id}'`);
ok('seeded free EXERCISE lesson');

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('   [pageerror]', String(e).slice(0, 200)));
  page.on('console', (m) => { if (m.type() === 'error') console.log('   [console]', m.text().slice(0, 200)); });
  page.on('response', (r) => { if (r.url().includes('/exercise') && r.status() >= 400) console.log('   [net]', r.status(), r.url().replace(API, '')); });

  // 2. Admin authors + verifies the exercise.
  await page.goto(`${ADM}/login`, { waitUntil: 'domcontentloaded' });
  await authptr(page, 'admin', 'dev-admin');
  await page.goto(`${ADM}/lessons/${lesson.id}/exercise`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('[data-testid="verify-btn"]', { timeout: 12_000 }).catch(() => {});
  await page.evaluate(() => document.querySelector('[data-testid="verify-btn"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  const verified = await page
    .waitForFunction(() => /passes/i.test(document.querySelector('[data-testid="verify-result"]')?.textContent || ''), { timeout: 12_000 })
    .then(() => true)
    .catch(() => false);
  must(verified, 'admin: reference solution verifies ("passes")', '');

  // 3. Student solves it.
  await page.goto(`${STU}/login`, { waitUntil: 'domcontentloaded' });
  await authptr(page, 'student', 'dev-student');
  await page.goto(`${STU}/lessons/${lesson.id}`, { waitUntil: 'networkidle2' });
  must(await page.waitForSelector('[data-testid="exercise-runner"]', { timeout: 12_000 }).then(() => true).catch(() => false), 'ExerciseRunner renders in the lesson', '');

  // Submit the (wrong) starter code.
  await page.evaluate(() => document.querySelector('[data-testid="submit-btn"] ion-button')?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  const failVerdict = await page
    .waitForFunction(() => /FAIL/.test(document.querySelector('[data-testid="verdict"]')?.textContent || ''), { timeout: 12_000 })
    .then(() => true)
    .catch(() => false);
  must(failVerdict, 'submitting the starter → FAIL', '');

  // Write a correct solution and submit (wait out the 3s submit cooldown).
  await new Promise((r) => setTimeout(r, 3300));
  await page.evaluate(() => {
    const ta = document.querySelector('[data-testid="code-editor"]');
    if (ta) {
      ta.value = 'function solution(a, b) { return a + b; }';
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
  await page.evaluate(() => document.querySelector('[data-testid="submit-btn"] ion-button')?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  const solved = await page.waitForSelector('[data-testid="exercise-passed"]', { timeout: 12_000 }).then(() => true).catch(() => false);
  must(solved, 'correct solution → "Solved!" (PASS)', '');
  const passVerdict = await page.$eval('[data-testid="verdict"]', (el) => el.textContent || '').catch(() => '');
  must(/PASS/.test(passVerdict), 'verdict shows PASS', JSON.stringify(passVerdict.trim()));
} finally {
  await browser.close();
}

console.log(`\n${failures === 0 ? '✅ PASS' : `❌ ${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
