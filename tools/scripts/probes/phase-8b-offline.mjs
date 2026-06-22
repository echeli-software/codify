#!/usr/bin/env node
/**
 * Phase 8b probe — download → offline read + storage management + LRU.
 *
 * Requires API (:3000) and student (:4201).
 *
 * Dev has no service worker, so we simulate "offline" by blocking only
 * requests to the API (request interception) while the app shell (served
 * from :4201) and IndexedDB keep working — the real offline read path.
 */

import puppeteer from '../../../node_modules/puppeteer/lib/esm/puppeteer/puppeteer.js';

const API = 'http://localhost:3000/api';
const STU = 'http://localhost:4201';
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
const doc = (text) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });

async function seedCourse(label, lessonText) {
  const cat = (await api('POST', '/categories', { slug: `o-${label}-${tag}`, name: label })).body;
  const course = (await api('POST', '/courses', { slug: `o-c-${label}-${tag}`, title: `Course ${label}`, categoryIds: [cat.id] })).body;
  const mod = (await api('POST', `/courses/${course.id}/modules`, { title: 'M' })).body;
  const lesson = (await api('POST', `/modules/${mod.id}/lessons`, { title: `Lesson ${label}`, type: 'READING', isFree: true })).body;
  await api('PATCH', `/lessons/${lesson.id}`, { contentJson: doc(lessonText) });
  await api('POST', `/courses/${course.id}/publish`, {});
  return { course, lesson };
}

console.log(`Phase 8b probe — tag ${tag}\n`);

const TEXT1 = `offline-content-${tag}`;
const c1 = await seedCourse('one', TEXT1);
const c2 = await seedCourse('two', `second-${tag}`);
ok('seeded two courses with identifiable lesson content');

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('   [pageerror]', String(e).slice(0, 160)));

  // Block only API calls when `blockApi` is on — the offline simulation.
  let blockApi = false;
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    if (blockApi && req.url().includes(':3000/api')) req.abort().catch(() => {});
    else req.continue().catch(() => {});
  });

  await page.goto(`${STU}/login`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    localStorage.setItem('codify.auth.user', JSON.stringify({ id: 'dev-student', email: 's@codify.local', displayName: 'Maria', role: 'STUDENT', avatarUrl: null, locale: 'pt-BR' }));
    localStorage.setItem('codify.auth.token', JSON.stringify({ token: 'dev-token-student', expiresAt: null }));
  });

  // 2. Download course 1
  await page.goto(`${STU}/courses/${c1.course.slug}`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('[data-testid="download-btn"]', { timeout: 12_000 }).catch(() => {});
  must(!!(await page.$('[data-testid="download-btn"]')), 'course shows a Download button', '');
  await page.click('[data-testid="download-btn"] ion-button');
  const downloaded = await page.waitForSelector('[data-testid="downloaded-badge"]', { timeout: 15_000 }).then(() => true).catch(() => false);
  must(downloaded, 'course flips to "Downloaded"', '');

  // 3. Online lesson render (full nav while online).
  await page.goto(`${STU}/lessons/${c1.lesson.id}`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('[data-testid="lesson-article"]', { timeout: 10_000 }).catch(() => {});
  const onlineText = await page.$eval('[data-testid="lesson-article"]', (el) => el.textContent || '').catch(() => '');
  must(onlineText.includes(TEXT1), 'lesson renders online with its content', JSON.stringify(onlineText.slice(0, 60)));

  // 4. Offline read: block the API, reload the lesson → cache fallback.
  blockApi = true;
  await page.goto(`${STU}/lessons/${c1.lesson.id}`, { waitUntil: 'domcontentloaded' });
  const offlineBanner = await page.waitForSelector('[data-testid="offline-read"]', { timeout: 12_000 }).then(() => true).catch(() => false);
  must(offlineBanner, 'lesson reads from cache offline ("Reading offline")', '');
  const offlineText = await page.$eval('[data-testid="lesson-article"]', (el) => el.textContent || '').catch(() => '');
  must(offlineText.includes(TEXT1), 'offline lesson shows the cached content', JSON.stringify(offlineText.slice(0, 60)));

  // 5. Back online → Downloads settings shows the course + storage used.
  blockApi = false;
  await page.goto(`${STU}/downloads`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('[data-testid="downloads-list"]', { timeout: 10_000 }).catch(() => {});
  must(!!(await page.$(`[data-testid="downloads-list"] [data-course-id="${c1.course.id}"]`)), 'Downloads settings lists the course', '');
  const usedText = await page.$eval('[data-testid="storage-used"]', (el) => el.textContent || '').catch(() => '');
  must(!usedText.trim().startsWith('0 B'), 'storage usage is non-zero', JSON.stringify(usedText.trim()));

  // 5b. Offline dressing room renders from the prefetched asset cache.
  await page.goto(`${STU}/avatar`, { waitUntil: 'networkidle2' }); // online → caches avatar+inventory
  await page.waitForSelector('[data-testid="dressing-avatar"]', { timeout: 8_000 }).catch(() => {});
  blockApi = true;
  await page.goto(`${STU}/avatar`, { waitUntil: 'domcontentloaded' }); // offline → cache
  const avOffline = await page.waitForSelector('[data-testid="dressing-avatar"]', { timeout: 8_000 }).then(() => true).catch(() => false);
  must(avOffline, 'dressing-room avatar renders offline (asset prefetch)', '');
  blockApi = false;

  // 6. LRU eviction: tiny budget, download course 2 → course 1 evicted.
  await page.evaluate(() => localStorage.setItem('codify.downloads.prefs', JSON.stringify({ wifiOnly: true, autoUpdate: true, budgetBytes: 50 })));
  await page.goto(`${STU}/courses/${c2.course.slug}`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('[data-testid="download-btn"]', { timeout: 10_000 }).catch(() => {});
  await page.click('[data-testid="download-btn"] ion-button');
  await page.waitForSelector('[data-testid="downloaded-badge"]', { timeout: 15_000 }).catch(() => {});
  await page.goto(`${STU}/downloads`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('[data-testid="downloads-list"]', { timeout: 10_000 }).catch(() => {});
  const hasC1 = await page.$(`[data-testid="downloads-list"] [data-course-id="${c1.course.id}"]`);
  const hasC2 = await page.$(`[data-testid="downloads-list"] [data-course-id="${c2.course.id}"]`);
  must(!hasC1 && !!hasC2, 'LRU eviction: oldest download removed under budget', `c1=${!!hasC1} c2=${!!hasC2}`);
} finally {
  await browser.close();
}

console.log(`\n${failures === 0 ? '✅ PASS' : `❌ ${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
