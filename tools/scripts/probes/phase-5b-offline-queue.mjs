#!/usr/bin/env node
/**
 * Phase 5b probe — offline lesson_complete queue + idempotent flush + 409 reconciliation.
 *
 *   1. API seed (admin): category, course, module, 3 free lessons; publish.
 *   2. Open student app, sign in (seed localStorage).
 *   3. Boot the shell so IdentityCacheService.prime() runs.  Verify
 *      IndexedDB(`codify-offline`).identity now has a row keyed
 *      'current' with totalXp/coins matching /api/me.
 *   4. Navigate to lesson #1 (online — so the lesson-page chunk caches),
 *      flip offline, click Mark-as-complete.  Verify the lesson page
 *      shows `[data-testid="lesson-completed"][data-queued="true"]` and
 *      that no network POST fired while offline.
 *   5. Confirm IndexedDB queue store now has the row, with a uuid-shaped
 *      clientEventId and userId='dev-student'.
 *   6. Seed two MORE pending events directly into IndexedDB (lessons
 *      #2 and #3) — this represents events queued on prior pages we
 *      can't drive after flipping offline (lazy-loaded chunks).
 *   7. Pre-complete lesson #2 server-side as the same student (online
 *      POST).  This sets up the 409 path — the device's queued event
 *      for that lesson will conflict on flush.
 *   8. Flip back online.  The constructor effect in OfflineSyncService
 *      auto-flushes when `online` flips true; wait until the queue is
 *      empty in IDB.
 *   9. API confirms 3 Progress rows for the user; User.totalXp/coins
 *      reflect 3 × baseXp/baseCoins (no double-credit through 409).
 *  10. AuditLog: exactly 3 new `lesson.complete` rows (the 409 path
 *      does NOT re-audit).
 */

import puppeteer from '../../../node_modules/puppeteer/lib/esm/puppeteer/puppeteer.js';
import { execSync } from 'node:child_process';

const API = 'http://localhost:3000/api';
const ADMIN_AUTH = 'Bearer dev-token-admin';
const STUDENT_AUTH = 'Bearer dev-token-student';

const tag = Date.now().toString(36);
const categorySlug = `phase5b-cat-${tag}`;
const courseSlug = `phase5b-course-${tag}`;

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
  return { status: res.status, body: json };
}

function studentTotals() {
  const sql = `SELECT \\"totalXp\\", \\"coins\\" FROM \\"User\\" WHERE \\"clerkId\\"='dev-student'`;
  const out = execSync(
    `docker exec codify-postgres psql -U codify -d codify_dev -A -F'|' -t -c "${sql}"`,
    { encoding: 'utf8' },
  ).trim();
  if (!out) return { totalXp: 0, coins: 0 };
  const [xp, coins] = out.split('|').map((s) => parseInt(s, 10));
  return { totalXp: xp, coins };
}

function studentId() {
  const sql = `SELECT id FROM \\"User\\" WHERE \\"clerkId\\"='dev-student'`;
  return execSync(
    `docker exec codify-postgres psql -U codify -d codify_dev -A -F'|' -t -c "${sql}"`,
    { encoding: 'utf8' },
  ).trim();
}

function rowsByUserAction(action) {
  const sql = `SELECT count(*) FROM \\"AuditLog\\" a JOIN \\"User\\" u ON u.id=a.\\"actorId\\" WHERE u.\\"clerkId\\"='dev-student' AND a.action='${action}' AND a.\\"createdAt\\" >= NOW() - INTERVAL '10 minutes'`;
  return parseInt(
    execSync(
      `docker exec codify-postgres psql -U codify -d codify_dev -A -F'|' -t -c "${sql}"`,
      { encoding: 'utf8' },
    ).trim(),
    10,
  );
}

console.log(`Phase 5b probe — tag ${tag}\n`);

// ─── 1. Seed via API ──────────────────────────────────────────────────
const cat = await api('POST', '/categories', { slug: categorySlug, name: `5b Cat ${tag}` });
if (cat.status !== 201) { fail(`cat create — ${cat.status}`); process.exit(1); }
const course = await api('POST', '/courses', {
  slug: courseSlug,
  title: `5b Course ${tag}`,
  categoryIds: [cat.body.id],
});
if (course.status !== 201) { fail(`course create — ${course.status}`); process.exit(1); }
const courseId = course.body.id;
const mod = await api('POST', `/courses/${courseId}/modules`, { title: 'M1' });
if (mod.status !== 201) { fail(`module — ${mod.status}`); process.exit(1); }
const moduleId = mod.body.id;
const free = [];
for (let i = 0; i < 3; i += 1) {
  const r = await api('POST', `/modules/${moduleId}/lessons`, {
    title: `Free Lesson ${i + 1}`,
    type: 'READING',
    isFree: true,
    baseXp: 5,
    baseCoins: 1,
  });
  if (r.status !== 201) { fail(`lesson ${i} — ${r.status}`); process.exit(1); }
  free.push(r.body.id);
}
const pub = await api('POST', `/courses/${courseId}/publish`, {});
if (pub.status !== 200 && pub.status !== 201) { fail(`publish — ${pub.status}`); process.exit(1); }
ok('seeded 3 free lessons under a published course');

const sId = studentId();
const baseline = studentTotals();
const auditBaseline = rowsByUserAction('lesson.complete');
ok(`baseline — xp=${baseline.totalXp} coins=${baseline.coins} prior audit rows=${auditBaseline}`);

// ─── 2. Sign in via puppeteer ─────────────────────────────────────────
const browser = await puppeteer.launch({ headless: 'shell' });
const page = await browser.newPage();
const consoleErrors = [];
page.on('console', (m) => {
  if (m.type() === 'error' && !/\[vite\]/.test(m.text())) consoleErrors.push(m.text());
});
page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.message}`));

await page.goto('http://localhost:4201/login', { waitUntil: 'domcontentloaded' });
await page.evaluate(() => {
  localStorage.setItem('codify.auth.user', JSON.stringify({
    id: 'dev-student', email: 'student@codify.local', displayName: 'Maria',
    role: 'STUDENT', avatarUrl: null, locale: 'pt-BR',
  }));
  localStorage.setItem('codify.auth.token', JSON.stringify({
    token: 'dev-token-student', expiresAt: null,
  }));
});

// Clear the offline DB so prior probes don't taint our queue counts.
await page.goto('http://localhost:4201/today', { waitUntil: 'networkidle2' });
await page.evaluate(() => {
  return new Promise((resolve) => {
    const r = indexedDB.deleteDatabase('codify-offline');
    r.onsuccess = r.onblocked = r.onerror = () => resolve();
  });
});

// ─── 3. IdentityStore primed ──────────────────────────────────────────
// Reload so the shell remounts and IdentityCacheService.prime() fires
// against the now-clean offline DB.
await page.goto('http://localhost:4201/today', { waitUntil: 'networkidle2' });
await new Promise((r) => setTimeout(r, 800));

const cachedIdentity = await page.evaluate(() => new Promise((resolve) => {
  const req = indexedDB.open('codify-offline');
  req.onsuccess = () => {
    const tx = req.result.transaction('identity', 'readonly');
    const g = tx.objectStore('identity').get('current');
    g.onsuccess = () => resolve(g.result);
    g.onerror = () => resolve(null);
  };
  req.onerror = () => resolve(null);
}));
if (!cachedIdentity) {
  fail('IdentityStore not primed on boot');
} else if (cachedIdentity.totalXp !== baseline.totalXp) {
  fail(`IdentityStore xp mismatch — cached=${cachedIdentity.totalXp} db=${baseline.totalXp}`);
} else {
  ok(`IdentityStore primed — xp=${cachedIdentity.totalXp} coins=${cachedIdentity.coins}`);
}

// ─── 4. Lesson page, flip offline, click Complete ─────────────────────
await page.goto(`http://localhost:4201/lessons/${free[0]}`, { waitUntil: 'networkidle2' });
await page.waitForSelector('[data-testid="lesson-complete-btn"]', { timeout: 8_000 }).catch(() => {});

// Capture POSTs to confirm nothing fires while offline.
const postsWhileOffline = [];
page.on('request', (req) => {
  if (req.method() === 'POST' && req.url().includes('/lessons/') && req.url().endsWith('/complete')) {
    postsWhileOffline.push(req.url());
  }
});

const client = await page.target().createCDPSession();
await client.send('Network.enable');
await client.send('Network.emulateNetworkConditions', {
  offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0,
});
await page.evaluate(() => {
  Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
  window.dispatchEvent(new Event('offline'));
});
await new Promise((r) => setTimeout(r, 300));

const chipOffline = await page
  .$eval('[data-testid="offline-chip"]', (el) => el.getAttribute('data-online'))
  .catch(() => null);
if (chipOffline !== 'false') {
  fail(`offline chip not shown (data-online=${chipOffline})`);
} else {
  ok('offline chip visible with data-online="false"');
}

await page.click('[data-testid="lesson-complete-btn"]');
await page.waitForFunction(
  () => document.querySelector('[data-testid="lesson-completed"][data-queued="true"]') !== null,
  { timeout: 4_000 },
).catch(() => {});
const queued = await page
  .$eval('[data-testid="lesson-completed"]', (el) => el.getAttribute('data-queued'))
  .catch(() => null);
if (queued !== 'true') {
  fail(`lesson page did not flip to data-queued="true" (got ${queued})`);
} else {
  ok('lesson page shows queued/saved-offline state');
}
if (postsWhileOffline.length > 0) {
  fail(`POST fired while offline (CDP should block it): ${postsWhileOffline.join(', ')}`);
} else {
  ok('no /complete POST left the device while offline');
}

// ─── 5. Confirm IDB queue has lesson #1 ───────────────────────────────
const after1 = await page.evaluate(() => new Promise((resolve) => {
  const req = indexedDB.open('codify-offline');
  req.onsuccess = () => {
    const tx = req.result.transaction('queue', 'readonly');
    const all = tx.objectStore('queue').getAll();
    all.onsuccess = () => resolve(all.result);
    all.onerror = () => resolve(null);
  };
}));
if (!Array.isArray(after1) || after1.length !== 1) {
  fail(`expected 1 queued event, got ${after1?.length}`);
} else if (after1[0].lessonId !== free[0]) {
  fail(`queued lessonId mismatch: ${after1[0].lessonId}`);
} else if (!/^[0-9a-f-]{36}$/i.test(after1[0].clientEventId)) {
  fail(`queued clientEventId looks malformed: ${after1[0].clientEventId}`);
} else {
  ok('queue has 1 row for lesson[0] with uuid clientEventId');
}

// ─── 6. Seed two more events directly into IDB ────────────────────────
await page.evaluate(({ events }) => new Promise((resolve, reject) => {
  const req = indexedDB.open('codify-offline');
  req.onsuccess = () => {
    const tx = req.result.transaction('queue', 'readwrite');
    const s = tx.objectStore('queue');
    for (const e of events) s.put(e);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  };
  req.onerror = () => reject(req.error);
}), {
  events: [
    {
      kind: 'lesson_complete',
      clientEventId: crypto.randomUUID(),
      clientTimestamp: Date.now() + 1,
      userId: sId,
      lessonId: free[1],
      attempts: 0,
    },
    {
      kind: 'lesson_complete',
      clientEventId: crypto.randomUUID(),
      clientTimestamp: Date.now() + 2,
      userId: sId,
      lessonId: free[2],
      attempts: 0,
    },
  ],
});
ok('seeded 2 more events directly into IDB (total queue=3)');

// ─── 7. Pre-complete lesson #2 server-side ────────────────────────────
const direct = await api('POST', `/lessons/${free[1]}/complete`, {}, STUDENT_AUTH);
if (direct.status !== 201) {
  fail(`server-side pre-complete on lesson[1] — ${direct.status}`);
} else {
  ok('server-side pre-complete on lesson[1] — 201');
}

// ─── 8. Flip online, wait for auto-flush ──────────────────────────────
await client.send('Network.emulateNetworkConditions', {
  offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1,
});
await page.evaluate(() => {
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
  window.dispatchEvent(new Event('online'));
});

const drained = await page.waitForFunction(
  () => new Promise((resolve) => {
    const req = indexedDB.open('codify-offline');
    req.onsuccess = () => {
      const tx = req.result.transaction('queue', 'readonly');
      const c = tx.objectStore('queue').count();
      c.onsuccess = () => resolve(c.result === 0);
      c.onerror = () => resolve(false);
    };
    req.onerror = () => resolve(false);
  }),
  { timeout: 12_000 },
).then(() => true).catch(() => false);

if (!drained) {
  const remaining = await page.evaluate(() => new Promise((resolve) => {
    const req = indexedDB.open('codify-offline');
    req.onsuccess = () => {
      const tx = req.result.transaction('queue', 'readonly');
      const c = tx.objectStore('queue').count();
      c.onsuccess = () => resolve(c.result);
    };
  }));
  fail(`queue did not drain after coming online (size=${remaining})`);
} else {
  ok('queue drained to 0 after coming online');
}

// ─── 9. Server has 3 completions; totals match expected ───────────────
const cp = await api('GET', `/courses/${courseId}/progress`, null, STUDENT_AUTH);
if (cp.status !== 200) {
  fail(`progress GET — ${cp.status}`);
} else if (cp.body.completedLessons !== 3) {
  fail(`expected 3 completed, got ${cp.body.completedLessons}`);
} else {
  ok('server shows 3/3 completed for the course');
}

const post = studentTotals();
const expectedXp = baseline.totalXp + 3 * 5;
const expectedCoins = baseline.coins + 3 * 1;
if (post.totalXp !== expectedXp || post.coins !== expectedCoins) {
  fail(`totals diverged: expected xp=${expectedXp}/coins=${expectedCoins}, got xp=${post.totalXp}/coins=${post.coins}`);
} else {
  ok('totals match — no double-credit through 409 path');
}

// ─── 10. AuditLog: exactly 3 new lesson.complete rows ─────────────────
// (1 from the direct pre-complete + 2 from the queue flush. The third
// flush event for lesson[1] hit the 409 path and did not audit.)
const auditAfter = rowsByUserAction('lesson.complete');
const delta = auditAfter - auditBaseline;
if (delta !== 3) {
  fail(`expected 3 new audit rows, got ${delta}`);
} else {
  ok('AuditLog has 3 new lesson.complete rows (409 replay did not re-audit)');
}

// Filter expected offline-mode network noise + the deliberate 409 from
// the conflict-reconciliation path out of console errors.
const realErrors = consoleErrors.filter(
  (e) =>
    !/Failed to fetch/.test(e) &&
    !/ERR_INTERNET_DISCONNECTED/.test(e) &&
    !/NetworkError/.test(e) &&
    !/HTTP 0/.test(e) &&
    !/HTTP 504/.test(e) &&
    !/status of 409/.test(e),
);
if (realErrors.length > 0) {
  realErrors.forEach((e) => fail(`unexpected console.error: ${e}`));
}

await browser.close();

console.log();
if (failures > 0) {
  console.error(`✗ ${failures} failure(s)`);
  process.exit(1);
}
console.log('✓ Phase 5b probe — all assertions passed');
