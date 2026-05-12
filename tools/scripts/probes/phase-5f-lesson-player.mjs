#!/usr/bin/env node
/**
 * Phase 5f probe — student lesson player + Progress recording.
 *
 *   1. Seed via API (admin): category, course, module, 2 lessons
 *      (one free, one paid), patch the free lesson's contentJson with
 *      identifiable text, publish the course.
 *   2. Capture STUDENT.totalXp / .coins baseline (psql).
 *   3. STUDENT GET /api/lessons/:freeId — 200, contentJson echoed.
 *   4. STUDENT POST /api/lessons/:freeId/complete — 201, returns
 *      progress row + updated totals. Totals match baseline +
 *      baseXp/baseCoins.
 *   5. Replay same POST — 409 Conflict (per /docs/16-offline §8) with
 *      the original progress payload echoed back. Totals not bumped.
 *   6. STUDENT POST /api/lessons/:paidId/complete — 402 (paywall).
 *   7. STUDENT GET /api/courses/:id/progress — items contains free,
 *      not paid. completedLessons=1, totalLessons=2.
 *   8. Drive STUDENT UI:
 *      a) Open /lessons/:freeId, see [data-testid="lesson-article"] +
 *         [data-testid="lesson-completed"] (we already completed via API).
 *      b) Open /courses/:slug, the free lesson row has
 *         data-lesson-completed="true", paid stays locked.
 *   9. Drive STUDENT UI: create a SECOND free lesson via API. Open
 *      /lessons/:secondId, click [data-testid="lesson-complete-btn"]
 *      → POST 201 fires → [data-testid="lesson-completed"] appears
 *      with XP + Coin badges.
 */

import puppeteer from '../../../node_modules/puppeteer/lib/esm/puppeteer/puppeteer.js';
import { execSync } from 'node:child_process';

const API = 'http://localhost:3000/api';
const ADMIN_AUTH = 'Bearer dev-token-admin';
const STUDENT_AUTH = 'Bearer dev-token-student';
const DB_URL = process.env.DATABASE_URL ??
  'postgresql://codify:codify@localhost:55432/codify_dev?schema=public';

const tag = Date.now().toString(36);
const categorySlug = `phase5f-cat-${tag}`;
const courseSlug = `phase5f-course-${tag}`;
const lessonText = `5f probe content ${tag}`;

let failures = 0;
const fail = (msg) => {
  failures += 1;
  console.error('  FAIL:', msg);
};
const ok = (msg) => console.log('  OK:', msg);

async function api(method, path, body, auth = ADMIN_AUTH) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      authorization: auth,
      'idempotency-key': crypto.randomUUID(),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* not JSON */
  }
  return { status: res.status, body: json, raw: text };
}

function studentTotals() {
  // Cheap psql fetch via the dockerized postgres so probes don't depend
  // on a host-installed psql binary.
  const sql = `SELECT \\"totalXp\\", \\"coins\\" FROM \\"User\\" WHERE \\"clerkId\\"='dev-student'`;
  const out = execSync(
    `docker exec codify-postgres psql -U codify -d codify_dev -A -F'|' -t -c "${sql}"`,
    { encoding: 'utf8' },
  ).trim();
  if (!out) return null;
  const [xp, coins] = out.split('|').map((s) => parseInt(s, 10));
  return { totalXp: xp, coins };
}

console.log(`Phase 5f probe — tag ${tag}\n`);

// ─── 1. Seed ──────────────────────────────────────────────────────────
console.log('Seeding via API …');
const cat = await api('POST', '/categories', {
  slug: categorySlug,
  name: `5f Cat ${tag}`,
});
if (cat.status !== 201) {
  fail(`category create — ${cat.status}: ${cat.raw}`);
  process.exit(1);
}

const course = await api('POST', '/courses', {
  slug: courseSlug,
  title: `5f Course ${tag}`,
  categoryIds: [cat.body.id],
});
if (course.status !== 201) {
  fail(`course create — ${course.status}`);
  process.exit(1);
}
const courseId = course.body.id;

const mod = await api('POST', `/courses/${courseId}/modules`, { title: 'M1' });
if (mod.status !== 201) {
  fail(`module create — ${mod.status}`);
  process.exit(1);
}
const moduleId = mod.body.id;

const free = await api('POST', `/modules/${moduleId}/lessons`, {
  title: 'Free Lesson',
  type: 'READING',
  isFree: true,
  baseXp: 12,
  baseCoins: 4,
});
const paid = await api('POST', `/modules/${moduleId}/lessons`, {
  title: 'Paid Lesson',
  type: 'READING',
  isFree: false,
});
if (free.status !== 201 || paid.status !== 201) {
  fail(`lesson create — free=${free.status} paid=${paid.status}`);
  process.exit(1);
}
const freeId = free.body.id;
const paidId = paid.body.id;

// Stamp identifiable text into the free lesson via PATCH.
const contentDoc = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [{ type: 'text', text: lessonText }],
    },
  ],
  version: 1,
};
const stamp = await api('PATCH', `/lessons/${freeId}`, {
  contentJson: contentDoc,
});
if (stamp.status !== 200) {
  fail(`stamp contentJson — ${stamp.status}`);
  process.exit(1);
}
ok(`seeded course/module/2 lessons; stamped free contentJson`);

const pub = await api('POST', `/courses/${courseId}/publish`, {});
if (pub.status !== 200 && pub.status !== 201) {
  fail(`publish — ${pub.status}`);
  process.exit(1);
}
ok('course published');

// ─── 2. Baseline student totals ──────────────────────────────────────
const baseline = studentTotals() ?? { totalXp: 0, coins: 0 };
ok(`baseline totals — xp=${baseline.totalXp} coins=${baseline.coins}`);

// ─── 3. STUDENT GET lesson detail ────────────────────────────────────
const det = await api('GET', `/lessons/${freeId}`, null, STUDENT_AUTH);
if (det.status !== 200) {
  fail(`student GET lesson — ${det.status}`);
} else if (JSON.stringify(det.body.contentJson).indexOf(lessonText) === -1) {
  fail(`student GET lesson — contentJson missing stamped text`);
} else {
  ok('student GET lesson — 200 with stamped contentJson');
}

// ─── 4. POST complete (new) ──────────────────────────────────────────
const c1 = await api('POST', `/lessons/${freeId}/complete`, {}, STUDENT_AUTH);
if (c1.status !== 201) {
  fail(`first complete — expected 201, got ${c1.status} ${c1.raw}`);
} else if (
  c1.body.progress.xpAwarded !== 12 ||
  c1.body.progress.coinsAwarded !== 4
) {
  fail(`first complete — wrong award ${JSON.stringify(c1.body.progress)}`);
} else if (
  c1.body.totals.totalXp !== baseline.totalXp + 12 ||
  c1.body.totals.coins !== baseline.coins + 4
) {
  fail(`first complete — totals not bumped ${JSON.stringify(c1.body.totals)}`);
} else {
  ok('first complete — 201, awarded 12 XP + 4 coins, totals bumped');
}

// ─── 5. Replay → 409 with original Progress payload, no double-award ─
const c2 = await api('POST', `/lessons/${freeId}/complete`, {}, STUDENT_AUTH);
if (c2.status !== 409) {
  fail(`replay complete — expected 409, got ${c2.status}`);
} else if (
  c2.body.totals?.totalXp !== c1.body.totals.totalXp ||
  c2.body.totals?.coins !== c1.body.totals.coins
) {
  fail(
    `replay complete — totals diverged: ${JSON.stringify(c2.body.totals)}`,
  );
} else {
  ok('replay complete — 409 Conflict, totals unchanged');
}

// Verify the User's actual totals after replay — server must not have
// double-incremented under the hood.
const afterReplay = studentTotals();
if (
  afterReplay.totalXp !== c1.body.totals.totalXp ||
  afterReplay.coins !== c1.body.totals.coins
) {
  fail(
    `db totals after replay diverged: ${JSON.stringify(afterReplay)} vs ${JSON.stringify(c1.body.totals)}`,
  );
} else {
  ok('db totals after replay unchanged (no double-award)');
}

// ─── 6. Paid lesson → 402 ────────────────────────────────────────────
const pay = await api('POST', `/lessons/${paidId}/complete`, {}, STUDENT_AUTH);
if (pay.status !== 402) {
  fail(`paid complete — expected 402, got ${pay.status}`);
} else {
  ok('paid complete — 402 paywall');
}

// ─── 7. Course progress endpoint ─────────────────────────────────────
const prog = await api('GET', `/courses/${courseId}/progress`, null, STUDENT_AUTH);
if (prog.status !== 200) {
  fail(`progress GET — ${prog.status}`);
} else if (
  prog.body.totalLessons !== 2 ||
  prog.body.completedLessons !== 1
) {
  fail(
    `progress GET — wrong counts: ${JSON.stringify({
      total: prog.body.totalLessons,
      done: prog.body.completedLessons,
    })}`,
  );
} else if (!prog.body.items.find((i) => i.lessonId === freeId)) {
  fail('progress GET — free lesson missing from items');
} else if (prog.body.items.find((i) => i.lessonId === paidId)) {
  fail('progress GET — paid lesson should not be in items');
} else {
  ok('progress GET — 1/2 completed, free in items, paid not');
}

// ─── 8. UI: lesson page shows completed; curriculum marks completion ─
const browser = await puppeteer.launch({ headless: 'shell' });
const page = await browser.newPage();
page.on('pageerror', (err) => fail(`pageerror: ${err.message}`));
page.on('console', (msg) => {
  if (msg.type() === 'error' && !/\[vite\]/.test(msg.text())) {
    fail(`console.error: ${msg.text()}`);
  }
});

await page.goto('http://localhost:4201/login', { waitUntil: 'domcontentloaded' });
await page.evaluate(() => {
  localStorage.setItem(
    'codify.auth.user',
    JSON.stringify({
      id: 'dev-student',
      email: 'student@codify.local',
      displayName: 'Maria',
      role: 'STUDENT',
      avatarUrl: null,
      locale: 'pt-BR',
    }),
  );
  localStorage.setItem(
    'codify.auth.token',
    JSON.stringify({ token: 'dev-token-student', expiresAt: null }),
  );
});

await page.goto(`http://localhost:4201/lessons/${freeId}`, { waitUntil: 'networkidle2' });
await page.waitForSelector('[data-testid="lesson-article"]', { timeout: 8_000 }).catch(() => {});
const lessonArticle = await page.$('[data-testid="lesson-article"]');
if (!lessonArticle) fail('UI lesson page — article missing');
else ok('UI lesson page — article rendered');

const proseMirrorText = await page
  .$eval('.ProseMirror', (el) => el.textContent ?? '')
  .catch(() => '');
if (!proseMirrorText.includes(lessonText)) {
  fail(`UI lesson page — ProseMirror missing stamped text (got "${proseMirrorText.slice(0, 80)}")`);
} else {
  ok('UI lesson page — ProseMirror renders stamped text');
}

const completedBadge = await page.$('[data-testid="lesson-completed"]');
if (!completedBadge) fail('UI lesson page — already-completed badge missing');
else ok('UI lesson page — completed badge present (loaded via /progress)');

await page.goto(`http://localhost:4201/courses/${courseSlug}`, { waitUntil: 'networkidle2' });
await page.waitForSelector('[data-testid="course-curriculum"]', { timeout: 8_000 }).catch(() => {});
const freeCompletedFlag = await page.$eval(
  `cdf-lesson-item[data-lesson-id="${freeId}"]`,
  (el) => el.getAttribute('data-lesson-completed'),
).catch(() => null);
const paidCompletedFlag = await page.$eval(
  `cdf-lesson-item[data-lesson-id="${paidId}"]`,
  (el) => el.getAttribute('data-lesson-completed'),
).catch(() => null);
if (freeCompletedFlag !== 'true') fail(`curriculum — free row not marked completed: ${freeCompletedFlag}`);
else ok('curriculum — free row marked completed');
if (paidCompletedFlag !== 'false') fail(`curriculum — paid row should be false: ${paidCompletedFlag}`);
else ok('curriculum — paid row not completed');

// ─── 9. UI: complete a SECOND lesson via button ──────────────────────
const second = await api('POST', `/modules/${moduleId}/lessons`, {
  title: 'Free Lesson 2',
  type: 'READING',
  isFree: true,
  baseXp: 7,
  baseCoins: 2,
});
if (second.status !== 201) {
  fail(`second free lesson create — ${second.status}`);
} else {
  const secondId = second.body.id;
  await page.goto(`http://localhost:4201/lessons/${secondId}`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('[data-testid="lesson-complete-btn"]', { timeout: 8_000 }).catch(() => {});

  // Capture the POST that the button triggers.
  const postWatch = page.waitForResponse(
    (res) => res.url().endsWith(`/lessons/${secondId}/complete`) && res.request().method() === 'POST',
    { timeout: 10_000 },
  );
  await page.click('[data-testid="lesson-complete-btn"]');
  const postRes = await postWatch.catch(() => null);
  if (!postRes || postRes.status() !== 201) {
    fail(`UI complete button — POST didn't return 201 (got ${postRes?.status()})`);
  } else {
    ok('UI complete button — POST 201 fired');
  }
  await page.waitForSelector('[data-testid="lesson-completed"]', { timeout: 3_000 }).catch(() => {});
  const doneBadge = await page.$('[data-testid="lesson-completed"]');
  if (!doneBadge) fail('UI complete button — completed badge did not render');
  else ok('UI complete button — completed badge rendered');
}

await browser.close();

console.log();
if (failures > 0) {
  console.error(`✗ ${failures} failure(s)`);
  process.exit(1);
}
console.log('✓ Phase 5f probe — all assertions passed');
