#!/usr/bin/env node
/**
 * Phase 6 admin browser probe — Plans page boots + create → price → sync.
 *
 * Requires the API (:3000) and the admin app (:4202) running. Guards against
 * the failure mode in memory/feedback_phase_verification.md (a JIT/boot break
 * that compiles fine). Drives the real admin UI:
 *
 *   1. Seed a category via API (the plan needs something to unlock).
 *   2. Browser as ADMIN: open /plans → page boots, editor present.
 *   3. Fill slug + name, create → plan appears, editor switches to edit mode
 *      (Stripe section + price form appear).
 *   4. Add a price (defaults BRL/3990/MONTHLY) → price list shows it.
 *   5. Click "Sync to Stripe" → synced badge appears.
 */

import puppeteer from '../../../node_modules/puppeteer/lib/esm/puppeteer/puppeteer.js';

const API = 'http://localhost:3000/api';
const APP = 'http://localhost:4202';
const ADMIN = 'Bearer dev-token-admin';

const tag = Date.now().toString(36);
const planSlug = `p6-adm-${tag}`;
let failures = 0;
const fail = (m) => {
  failures += 1;
  console.error('  FAIL:', m);
};
const ok = (m) => console.log('  OK:', m);

await fetch(`${API}/categories`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: ADMIN, 'idempotency-key': crypto.randomUUID() },
  body: JSON.stringify({ slug: `p6-adm-cat-${tag}`, name: 'Adm Cat' }),
});

console.log(`Phase 6 admin browser probe — tag ${tag}\n`);

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('   [pageerror]', String(e).slice(0, 160)));

  await page.goto(`${APP}/login`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    localStorage.setItem(
      'codify.auth.user',
      JSON.stringify({ id: 'dev-admin', email: 'admin@codify.local', displayName: 'Ana', role: 'ADMIN', avatarUrl: null, locale: 'pt-BR' }),
    );
    localStorage.setItem('codify.auth.token', JSON.stringify({ token: 'dev-token-admin', expiresAt: null }));
  });

  // 2. Plans page boots.
  await page.goto(`${APP}/plans`, { waitUntil: 'networkidle2' });
  const editor = await page.waitForSelector('[data-testid="plan-editor"]', { timeout: 10_000 }).then(() => true).catch(() => false);
  editor ? ok('admin Plans page boots + editor renders') : fail('plan editor did not render (boot failure?)');

  // 3. Create a plan.
  await page.click('[data-testid="new-plan-btn"]').catch(() => {});
  await page.type('[data-testid="plan-slug"] input', planSlug);
  await page.type('[data-testid="plan-name"] input', `Admin Plan ${tag}`);
  await page.click('[data-testid="plan-save"] button');
  // After create, the editor switches to edit mode → sync button appears.
  const syncBtn = await page.waitForSelector('[data-testid="sync-stripe-btn"]', { timeout: 10_000 }).then(() => true).catch(() => false);
  syncBtn ? ok('plan created → editor entered edit mode (Stripe section shown)') : fail('sync section did not appear after create');

  // 4. Add a price (form prefilled with BRL/3990/MONTHLY).
  await page.click('[data-testid="add-price-btn"] button').catch(() => {});
  const priceShown = await page
    .waitForFunction(() => {
      const list = document.querySelector('[data-testid="price-list"]');
      return !!list && /R\$/.test(list.textContent || '');
    }, { timeout: 10_000 })
    .then(() => true)
    .catch(() => false);
  priceShown ? ok('price added → appears in price list (formatted)') : fail('price not shown after add');

  // 5. Sync to Stripe → synced badge.
  await page.click('[data-testid="sync-stripe-btn"] button').catch(() => {});
  const synced = await page.waitForSelector('[data-testid="synced-badge"]', { timeout: 10_000 }).then(() => true).catch(() => false);
  synced ? ok('Sync to Stripe → synced badge shown') : fail('synced badge missing after sync');
} finally {
  await browser.close();
}

console.log(`\n${failures === 0 ? '✅ PASS' : `❌ ${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
