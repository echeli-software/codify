#!/usr/bin/env node
/**
 * Phase 6 browser probe — student subscribe → unlock, end to end.
 *
 * Requires the API (:3000) and the student app (:4201) running.
 *
 *   1. Seed via API (admin): category, course (1 free + 1 paid lesson),
 *      plan unlocking the category + a price, sync to Stripe, publish.
 *   2. Browser as STUDENT (dev-token in localStorage):
 *      a) /courses/:slug → paywall banner shown, the plan is listed under
 *         "plans including this course", the paid lesson row is LOCKED.
 *      b) /subscription → plan picker lists the plan; click Subscribe.
 *      c) Redirect lands on /billing/success which completes the (dev)
 *         checkout → success card shown.
 *      d) Back to /courses/:slug → "included in your plan" badge shown and
 *         the paid lesson row is now UNLOCKED (navigable).
 *
 * Per memory/feedback_phase_verification.md: a green build is not a working
 * app — this drives the real UI against the real API.
 */

import puppeteer from '../../../node_modules/puppeteer/lib/esm/puppeteer/puppeteer.js';

const API = 'http://localhost:3000/api';
const APP = 'http://localhost:4201';
const ADMIN = 'Bearer dev-token-admin';

const tag = Date.now().toString(36);
let failures = 0;
const fail = (m) => {
  failures += 1;
  console.error('  FAIL:', m);
};
const ok = (m) => console.log('  OK:', m);

async function api(method, path, body, auth = ADMIN) {
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
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

console.log(`Phase 6 browser probe — tag ${tag}\n`);

// ─── 1. Seed ──────────────────────────────────────────────────────────
console.log('Seeding via API …');
const cat = (await api('POST', '/categories', { slug: `p6b-br-${tag}`, name: 'Br' })).body;
const courseSlug = `p6-br-course-${tag}`;
const course = (
  await api('POST', '/courses', { slug: courseSlug, title: `Phase6 Browser ${tag}`, categoryIds: [cat.id] })
).body;
const mod = (await api('POST', `/courses/${course.id}/modules`, { title: 'M1' })).body;
await api('POST', `/modules/${mod.id}/lessons`, { title: 'Free Intro', type: 'READING', isFree: true });
const paid = (
  await api('POST', `/modules/${mod.id}/lessons`, { title: 'Paid Deep Dive', type: 'READING', isFree: false })
).body;
await api('POST', `/courses/${course.id}/publish`, {});
const plan = (
  await api('POST', '/plans', {
    slug: `p6-br-plan-${tag}`,
    name: `Browser Plan ${tag}`,
    tagline: 'Unlock the course',
    categoryIds: [cat.id],
    prices: [{ currency: 'BRL', amountCents: 3990, period: 'MONTHLY' }],
  })
).body;
const synced = (await api('POST', `/plans/${plan.id}/sync-stripe`, {})).body;
const priceId = synced.prices[0].id;
ok(`seeded course ${courseSlug} + plan ${plan.id} (price ${priceId})`);

// ─── 2. Browser ───────────────────────────────────────────────────────
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error') console.log('   [browser error]', m.text().slice(0, 160));
  });
  page.on('response', (r) => {
    if (r.url().includes('/billing/')) console.log('   [net]', r.request().method(), r.status(), r.url().replace(API, ''));
  });
  page.on('pageerror', (e) => console.log('   [pageerror]', String(e).slice(0, 160)));

  // Seed dev auth into localStorage.
  await page.goto(`${APP}/login`, { waitUntil: 'domcontentloaded' });
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

  // a) Course detail — paywalled.
  await page.goto(`${APP}/courses/${courseSlug}`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('[data-testid="course-hero"]', { timeout: 10_000 }).catch(() => {});
  await page.waitForSelector('[data-testid="course-paywall"]', { timeout: 8_000 }).catch(() => {});
  const paywall = await page.$('[data-testid="course-paywall"]');
  paywall ? ok('course detail shows paywall banner') : fail('paywall banner missing');

  const planListed = await page.$eval(
    '[data-testid="plans-including-course"]',
    (el, id) => !!el.querySelector(`[data-plan-id="${id}"]`),
    plan.id,
  ).catch(() => false);
  planListed ? ok('plan listed under "plans including this course"') : fail('plan not listed in paywall');

  const paidLockedBefore = await page.$eval(
    `[data-lesson-id="${paid.id}"]`,
    (el) => el.getAttribute('data-lesson-locked'),
  ).catch(() => null);
  paidLockedBefore === 'true'
    ? ok('paid lesson locked before subscribing')
    : fail(`paid lesson not locked before (got ${paidLockedBefore})`);

  // b) Subscription page — pick OUR plan's price (the page lists all plans).
  await page.goto(`${APP}/subscription`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('[data-testid="plan-list"]', { timeout: 10_000 }).catch(() => {});
  const btnSelector = `[data-testid="subscribe-btn"][data-price-id="${priceId}"]`;
  const subscribeBtn = await page.$(btnSelector);
  subscribeBtn ? ok('subscription page lists our plan with a subscribe button') : fail('seeded plan subscribe button missing');

  // c) Subscribe → redirect → /billing/success completes dev checkout.
  if (subscribeBtn) {
    await page.evaluate((sel) => document.querySelector(sel)?.scrollIntoView(), btnSelector);
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15_000 }).catch(() => {}),
      page.click(`${btnSelector} ion-button`).catch(() => subscribeBtn.click()),
    ]);
    await page.waitForSelector('[data-testid="checkout-success"]', { timeout: 12_000 }).catch(() => {});
    const success = await page.$('[data-testid="checkout-success"]');
    const url = page.url();
    success
      ? ok(`checkout completed (success page at ${url.replace(/\?.*/, '')})`)
      : fail(`checkout success not shown (url ${url})`);
  }

  // d) Course detail again — unlocked.
  await page.goto(`${APP}/courses/${courseSlug}`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('[data-testid="course-hero"]', { timeout: 10_000 }).catch(() => {});
  const accessBadge = await page
    .waitForSelector('[data-testid="access-badge"]', { timeout: 8_000 })
    .then(() => true)
    .catch(() => false);
  accessBadge ? ok('"included in your plan" badge shown after subscribing') : fail('access badge missing after subscribe');

  const paidUnlockedAfter = await page.$eval(
    `[data-lesson-id="${paid.id}"]`,
    (el) => el.getAttribute('data-lesson-locked'),
  ).catch(() => null);
  paidUnlockedAfter === 'false'
    ? ok('paid lesson unlocked after subscribing')
    : fail(`paid lesson still locked after subscribe (got ${paidUnlockedAfter})`);
} finally {
  await browser.close();
}

console.log(`\n${failures === 0 ? '✅ PASS' : `❌ ${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
