#!/usr/bin/env node
/**
 * Phase 12 browser probe — AI prompt + scenario lessons in the student player.
 *
 *   1. Seed a free AI_PROMPT lesson + a free SCENARIO lesson, published.
 *   2. STUDENT AI prompt: write a strong answer → submit → rubric checklist
 *      lights up (criteria pass) and "rubric met" shows.
 *   3. STUDENT scenario: walk start → choice → ending → "Scenario complete".
 *
 * Requires API (:3000) + student (:4201).
 */

import { execSync } from 'node:child_process';
import puppeteer from '../../../node_modules/puppeteer/lib/esm/puppeteer/puppeteer.js';

const API = 'http://localhost:3000/api';
const STU = 'http://localhost:4201';
const tag = Date.now().toString(36);
let failures = 0;
const fail = (m) => { failures += 1; console.error('  FAIL:', m); };
const ok = (m) => console.log('  OK:', m);
const must = (c, l, ctx = '') => (c ? ok(l) : fail(`${l} — ${ctx}`));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'content-type': 'application/json', authorization: 'Bearer dev-token-admin', 'idempotency-key': crypto.randomUUID() },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json().catch(() => null);
}
function sql(q) { return execSync(`docker exec codify-postgres psql -U codify -d codify_dev -A -t -c "${q.replace(/"/g, '\\"')}"`, { encoding: 'utf8' }).trim(); }
async function authStudent(page) {
  await page.evaluate(() => {
    localStorage.setItem('codify.auth.user', JSON.stringify({ id: 'dev-student', email: 'student@codify.local', displayName: 'Student', role: 'STUDENT', avatarUrl: null, locale: 'pt-BR' }));
    localStorage.setItem('codify.auth.token', JSON.stringify({ token: 'dev-token-student', expiresAt: null }));
  });
}
const dispatchClick = (sel) => `document.querySelector('${sel}')?.dispatchEvent(new MouseEvent('click',{bubbles:true}))`;

console.log(`Phase 12 browser probe — tag ${tag}\n`);

const STUDENT_ID = sql(`SELECT id FROM "User" WHERE "clerkId"='dev-student'`);
const cat = await api('POST', '/categories', { slug: `p12br-${tag}`, name: 'B' });
const course = await api('POST', '/courses', { slug: `p12br-c-${tag}`, title: 'B', categoryIds: [cat.id] });
const mod = await api('POST', `/courses/${course.id}/modules`, { title: 'M' });

const aiLesson = await api('POST', `/modules/${mod.id}/lessons`, { title: 'Explain errors', type: 'AI_PROMPT', isFree: true, baseXp: 20, baseCoins: 10 });
await api('POST', `/lessons/${aiLesson.id}/ai-prompt`, {
  promptText: 'Explain how to handle errors in JavaScript and why it matters.',
  passThreshold: 70,
  rubric: [
    { id: 'kw', label: 'Mentions try/catch', weight: 2, kind: 'keyword', config: { all: ['try', 'catch'] } },
    { id: 'len', label: 'Enough detail', weight: 1, kind: 'minWords', config: { min: 20 } },
    { id: 'why', label: 'Explains why it matters', weight: 2, kind: 'llm', config: { concepts: ['crash', 'user', 'recover'] } },
  ],
});

const scLesson = await api('POST', `/modules/${mod.id}/lessons`, { title: 'Angry customer', type: 'SCENARIO', isFree: true, baseXp: 20, baseCoins: 10 });
await api('POST', `/lessons/${scLesson.id}/scenario`, {
  graph: {
    startId: 'start',
    nodes: {
      start: { id: 'start', speaker: 'Customer', text: 'My order never arrived!', choices: [ { id: 'a', label: 'Apologise and investigate', to: 'mid' }, { id: 'b', label: 'Blame the courier', ending: true, outcome: 'bailed' } ] },
      mid: { id: 'mid', speaker: 'Customer', text: 'Okay, what now?', choices: [ { id: 'x', label: 'Offer a refund', ending: true, outcome: 'resolved' }, { id: 'y', label: 'Argue', ending: true, outcome: 'escalated' } ] },
    },
  },
});
await api('POST', `/courses/${course.id}/publish`, {});
sql(`DELETE FROM "Progress" WHERE "lessonId" IN ('${aiLesson.id}','${scLesson.id}')`);
sql(`DELETE FROM "AiSubmission" WHERE "userId"='${STUDENT_ID}'`);
sql(`DELETE FROM "ScenarioRun" WHERE "userId"='${STUDENT_ID}'`);
ok('seeded AI_PROMPT + SCENARIO lessons');

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('   [pageerror]', String(e).slice(0, 160)));

  await page.goto(`${STU}/login`, { waitUntil: 'domcontentloaded' });
  await authStudent(page);

  // ── AI prompt ──
  await page.goto(`${STU}/lessons/${aiLesson.id}`, { waitUntil: 'networkidle2' });
  must(await page.waitForSelector('[data-testid="ai-playground"]', { timeout: 12_000 }).then(() => true).catch(() => false), 'AiPromptPlayground renders', '');
  await page.evaluate(() => {
    const ta = document.querySelector('[data-testid="ai-answer"]');
    ta.value = 'In JavaScript you handle errors with a try/catch block: risky code goes in try and the catch clause receives the Error so you can react. It matters because an unhandled error can crash the program or leave the user stuck; catching lets you recover gracefully.';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.evaluate(dispatchClick('[data-testid="ai-submit"] ion-button'));
  const aiPassed = await page.waitForSelector('[data-testid="ai-passed"]', { timeout: 12_000 }).then(() => true).catch(() => false);
  must(aiPassed, 'AI prompt: strong answer passes ("rubric met")', '');
  const litUp = await page.$$eval('[data-testid="ai-rubric"] li', (lis) => lis.filter((l) => l.getAttribute('data-state') === 'pass').length);
  must(litUp >= 2, 'rubric checklist lit up (criteria pass)', `${litUp} pass`);

  // ── Scenario ──
  await page.goto(`${STU}/lessons/${scLesson.id}`, { waitUntil: 'networkidle2' });
  must(await page.waitForSelector('[data-testid="scenario-runner"]', { timeout: 12_000 }).then(() => true).catch(() => false), 'ScenarioRunner renders', '');
  const startNode = await page.$eval('[data-testid="scenario-node"]', (el) => el.getAttribute('data-node-id')).catch(() => null);
  must(startNode === 'start', 'scenario starts at the start node', `${startNode}`);
  // Choose 'a' → advances to 'mid'.
  await page.evaluate(dispatchClick('[data-choice-id="a"] ion-button'));
  const advanced = await page.waitForFunction(() => document.querySelector('[data-testid="scenario-node"]')?.getAttribute('data-node-id') === 'mid', { timeout: 8000 }).then(() => true).catch(() => false);
  must(advanced, 'choosing a reply advances to the next node (branch depth 2)', '');
  // Choose 'x' (ending) → complete.
  await sleep(200);
  await page.evaluate(dispatchClick('[data-choice-id="x"] ion-button'));
  const ended = await page.waitForSelector('[data-testid="scenario-ending"]', { timeout: 12_000 }).then(() => true).catch(() => false);
  must(ended, 'reaching an ending shows "Scenario complete"', '');
  const outcome = await page.$eval('[data-testid="scenario-outcome"]', (el) => el.textContent?.trim()).catch(() => '');
  must(/resolved/i.test(outcome ?? ''), 'ending outcome shown', JSON.stringify(outcome));
} finally {
  await browser.close();
}

console.log(`\n${failures === 0 ? '✅ PASS' : `❌ ${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
