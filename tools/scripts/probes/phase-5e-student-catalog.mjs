#!/usr/bin/env node
/**
 * Phase 5e probe — student catalog browse + course detail + locked-lesson states.
 *
 *   1. Use API as ADMIN to seed: a category, a course in that category,
 *      a module, one free lesson + one paid lesson, then publish.
 *   2. Hit STUDENT /api/courses (server forces status=PUBLISHED for STUDENT)
 *      and confirm the seeded course is present.
 *   3. Hit STUDENT /api/courses?categoryId=… and confirm the filter works.
 *   4. Open the student app /catalog → grid present, our card present.
 *   5. Tap the category chip → grid still contains our card.
 *   6. Tap the card → land on /courses/:slug.
 *   7. Curriculum shows 2 lesson rows. Free one has data-lesson-free="true"
 *      and a working router link; paid one has data-lesson-free="false"
 *      and the item is disabled (no click-through).
 *   8. Click the free lesson → land on /lessons/:id placeholder; the
 *      rendered id matches the seeded lesson id.
 *
 * Per `memory/feedback_phase_verification.md`: behaviour-specific, not
 * just "page loads."
 */

import puppeteer from '../../../node_modules/puppeteer/lib/esm/puppeteer/puppeteer.js';

const API = 'http://localhost:3000/api';
const ADMIN_AUTH = 'Bearer dev-token-admin';
const STUDENT_AUTH = 'Bearer dev-token-student';

const tag = Date.now().toString(36);
const categorySlug = `phase5e-cat-${tag}`;
const courseSlug = `phase5e-course-${tag}`;

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

console.log(`Phase 5e probe — tag ${tag}\n`);

// ─── 1. Seed via API as ADMIN ─────────────────────────────────────────
console.log('Seeding category + course + lessons via API …');
const catRes = await api('POST', '/categories', {
  slug: categorySlug,
  name: `5e Cat ${tag}`,
});
if (catRes.status !== 201) {
  fail(`category create — expected 201, got ${catRes.status} ${catRes.raw}`);
  process.exit(1);
}
const categoryId = catRes.body.id;
ok(`category created id=${categoryId}`);

const courseRes = await api('POST', '/courses', {
  slug: courseSlug,
  title: `5e Course ${tag}`,
  description: 'Phase 5e probe course',
  categoryIds: [categoryId],
  difficulty: 2,
  estimatedMinutes: 90,
});
if (courseRes.status !== 201) {
  fail(`course create — expected 201, got ${courseRes.status} ${courseRes.raw}`);
  process.exit(1);
}
const courseId = courseRes.body.id;
ok(`course created id=${courseId}`);

const moduleRes = await api('POST', `/courses/${courseId}/modules`, {
  title: 'Module One',
});
if (moduleRes.status !== 201) {
  fail(`module create — expected 201, got ${moduleRes.status} ${moduleRes.raw}`);
  process.exit(1);
}
const moduleId = moduleRes.body.id;
ok(`module created id=${moduleId}`);

const freeRes = await api('POST', `/modules/${moduleId}/lessons`, {
  title: 'Free Lesson',
  type: 'READING',
  isFree: true,
});
const paidRes = await api('POST', `/modules/${moduleId}/lessons`, {
  title: 'Paid Lesson',
  type: 'READING',
  isFree: false,
});
if (freeRes.status !== 201 || paidRes.status !== 201) {
  fail(`lesson create — free=${freeRes.status} paid=${paidRes.status}`);
  process.exit(1);
}
const freeId = freeRes.body.id;
const paidId = paidRes.body.id;
ok(`lessons created free=${freeId} paid=${paidId}`);

const pubRes = await api('POST', `/courses/${courseId}/publish`, {});
if (pubRes.status !== 200 && pubRes.status !== 201) {
  fail(`publish — expected 200, got ${pubRes.status} ${pubRes.raw}`);
  process.exit(1);
}
ok(`course published`);

// ─── 2. STUDENT /api/courses must include this course ─────────────────
const studentList = await api('GET', `/courses?take=200`, null, STUDENT_AUTH);
if (studentList.status !== 200) {
  fail(`student list — got ${studentList.status}`);
} else {
  const found = studentList.body.items?.find((c) => c.id === courseId);
  if (!found) fail('student list — seeded course not in PUBLISHED list');
  else if (found.lessonCount !== 2)
    fail(`student list — expected lessonCount=2 got ${found.lessonCount}`);
  else ok(`student list — course present with lessonCount=2`);
}

// ─── 3. STUDENT /api/courses?categoryId=…  ────────────────────────────
const filtered = await api(
  'GET',
  `/courses?categoryId=${encodeURIComponent(categoryId)}`,
  null,
  STUDENT_AUTH,
);
if (filtered.status !== 200) {
  fail(`student categoryId filter — got ${filtered.status}`);
} else if (!filtered.body.items.find((c) => c.id === courseId)) {
  fail('student categoryId filter — seeded course missing');
} else {
  ok('student categoryId filter — course present');
}

// ─── 4-8. Drive student UI ────────────────────────────────────────────
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

await page.goto('http://localhost:4201/catalog', { waitUntil: 'networkidle2' });
await page.waitForSelector('[data-testid="catalog-grid"]', { timeout: 10_000 }).catch(() => {});

// 4. Catalog grid contains our course slug
const gridHasCard = await page.evaluate((slug) => {
  return !!document.querySelector(`a[data-course-slug="${slug}"]`);
}, courseSlug);
if (!gridHasCard) fail('catalog — seeded course card not visible');
else ok('catalog — seeded course card visible');

// 5. Tap our category chip — grid still contains the card
const chipName = `5e Cat ${tag}`;
const clickedChip = await page.evaluate((name) => {
  const chips = Array.from(document.querySelectorAll('.catalog-filters ion-chip'));
  const target = chips.find((c) => c.textContent?.trim().includes(name));
  if (!target) return false;
  target.click();
  return true;
}, chipName);
if (!clickedChip) fail('catalog — could not click category chip');
else {
  await new Promise((r) => setTimeout(r, 800));
  const stillThere = await page.evaluate(
    (slug) => !!document.querySelector(`a[data-course-slug="${slug}"]`),
    courseSlug,
  );
  if (!stillThere) fail('catalog — filtered grid lost the seeded course');
  else ok('catalog — category filter retains seeded course');
}

// 6. Click the card → /courses/:slug
await Promise.all([
  page.waitForNavigation({ waitUntil: 'networkidle2' }),
  page.click(`a[data-course-slug="${courseSlug}"]`),
]);
if (!page.url().endsWith(`/courses/${courseSlug}`)) {
  fail(`course-detail nav — url is ${page.url()}`);
} else {
  ok(`course-detail nav — url ${page.url()}`);
}

// 7. Curriculum + lesson rows
await page.waitForSelector('[data-testid="course-curriculum"]', { timeout: 5_000 }).catch(() => {});
const hero = await page.$('[data-testid="course-hero"]');
if (!hero) fail('course-detail — hero card missing');
else ok('course-detail — hero card present');

const rows = await page.$$eval('cdf-lesson-item', (els) =>
  els.map((el) => ({
    id: el.getAttribute('data-lesson-id'),
    free: el.getAttribute('data-lesson-free'),
    disabled: !!el.querySelector('ion-item[disabled]'),
  })),
);
if (rows.length !== 2) {
  fail(`course-detail — expected 2 lesson rows, got ${rows.length}`);
} else {
  ok(`course-detail — 2 lesson rows`);
}
const freeRow = rows.find((r) => r.id === freeId);
const paidRow = rows.find((r) => r.id === paidId);
if (!freeRow || freeRow.free !== 'true' || freeRow.disabled) {
  fail(`free lesson row malformed: ${JSON.stringify(freeRow)}`);
} else {
  ok('free lesson row — free=true and enabled');
}
if (!paidRow || paidRow.free !== 'false' || !paidRow.disabled) {
  fail(`paid lesson row malformed: ${JSON.stringify(paidRow)}`);
} else {
  ok('paid lesson row — free=false and disabled (locked)');
}

// 8. Click the free lesson row → /lessons/:id resolved
const freeRowClickable = await page.evaluateHandle((id) => {
  const root = document.querySelector(`cdf-lesson-item[data-lesson-id="${id}"]`);
  return root?.querySelector('ion-item') ?? null;
}, freeId);
const target = freeRowClickable.asElement();
if (!target) {
  fail('free lesson row — could not find clickable ion-item');
} else {
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle2' }),
    target.click(),
  ]);
  if (!page.url().endsWith(`/lessons/${freeId}`)) {
    fail(`lesson nav — url is ${page.url()}`);
  } else {
    const renderedId = await page.$eval(
      '[data-testid="lesson-id"]',
      (el) => el.textContent?.trim() ?? '',
    );
    if (renderedId !== freeId) {
      fail(`lesson page — rendered id "${renderedId}" !== ${freeId}`);
    } else {
      ok(`lesson page — rendered id matches`);
    }
  }
}

await browser.close();

console.log();
if (failures > 0) {
  console.error(`✗ ${failures} failure(s)`);
  process.exit(1);
}
console.log(`✓ Phase 5e probe — all assertions passed`);
