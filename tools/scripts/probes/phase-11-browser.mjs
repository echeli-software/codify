#!/usr/bin/env node
/**
 * Phase 11 browser probe — native-conditional subscription UI.
 *
 * The IAP purchase + push delivery themselves need a real device, but the
 * native-vs-web branching is browser-verifiable: we load /subscription twice,
 * once as a plain PWA (no Capacitor) and once with an injected fake Capacitor
 * runtime, and assert the "Restore purchases" affordance (an App Store / Play
 * requirement) appears only on native.
 *
 * Requires API (:3000) + student (:4201).
 */

import puppeteer from '../../../node_modules/puppeteer/lib/esm/puppeteer/puppeteer.js';

const API = 'http://localhost:3000/api';
const STU = 'http://localhost:4201';
const tag = Date.now().toString(36);
let failures = 0;
const fail = (m) => { failures += 1; console.error('  FAIL:', m); };
const ok = (m) => console.log('  OK:', m);
const must = (c, l, ctx = '') => (c ? ok(l) : fail(`${l} — ${ctx}`));

async function api(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'content-type': 'application/json', authorization: 'Bearer dev-token-admin', 'idempotency-key': crypto.randomUUID() },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json().catch(() => null);
}
async function authStudent(page) {
  await page.evaluate(() => {
    localStorage.setItem('codify.auth.user', JSON.stringify({ id: 'dev-student', email: 'student@codify.local', displayName: 'Student', role: 'STUDENT', avatarUrl: null, locale: 'pt-BR' }));
    localStorage.setItem('codify.auth.token', JSON.stringify({ token: 'dev-token-student', expiresAt: null }));
  });
}

console.log(`Phase 11 browser probe — tag ${tag}\n`);

// Seed an active plan so the picker has content.
const cat = await api('POST', '/categories', { slug: `p11br-${tag}`, name: 'B' });
await api('POST', '/plans', { slug: `p11br-plan-${tag}`, name: 'Mobile', categoryIds: [cat.id], revenueCatEntitlementId: `ent_${tag}`, prices: [{ currency: 'BRL', amountCents: 1990, period: 'MONTHLY' }] });
ok('seeded a plan');

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
try {
  // ── Web (no Capacitor): restore button absent, subscribe present ──
  const web = await browser.newPage();
  web.on('pageerror', (e) => console.log('   [pageerror]', String(e).slice(0, 160)));
  await web.goto(`${STU}/login`, { waitUntil: 'domcontentloaded' });
  await authStudent(web);
  await web.goto(`${STU}/subscription`, { waitUntil: 'networkidle2' });
  await web.waitForSelector('[data-testid="plan-list"], [data-testid="no-subscription"]', { timeout: 12_000 }).catch(() => {});
  const webRestore = await web.$('[data-testid="restore-btn"]');
  must(webRestore === null, 'web: "Restore purchases" is hidden (not native)', '');
  const webSubscribe = await web.$('[data-testid="subscribe-btn"]');
  must(webSubscribe !== null, 'web: subscribe button present (web checkout path)', '');

  // ── Native (injected fake Capacitor): restore button appears ──
  const nat = await browser.newPage();
  nat.on('pageerror', (e) => console.log('   [pageerror]', String(e).slice(0, 160)));
  await nat.evaluateOnNewDocument(() => {
    // Minimal Capacitor shim so NativePlatformService.isNative === true.
    window.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'ios' };
  });
  await nat.goto(`${STU}/login`, { waitUntil: 'domcontentloaded' });
  await authStudent(nat);
  await nat.goto(`${STU}/subscription`, { waitUntil: 'networkidle2' });
  const natRestore = await nat
    .waitForSelector('[data-testid="restore-btn"]', { timeout: 12_000 })
    .then(() => true)
    .catch(() => false);
  must(natRestore, 'native: "Restore purchases" is shown (store requirement)', '');
  const isNativeFlag = await nat.evaluate(() => window.Capacitor?.isNativePlatform?.() === true);
  must(isNativeFlag, 'native: Capacitor.isNativePlatform() === true', '');
} finally {
  await browser.close();
}

console.log(`\n${failures === 0 ? '✅ PASS' : `❌ ${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
