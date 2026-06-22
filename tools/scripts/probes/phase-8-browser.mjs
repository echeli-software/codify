#!/usr/bin/env node
/**
 * Phase 8 browser probe — shop buy → equip in dressing room + admin items.
 *
 * Requires API (:3000), student (:4201), admin (:4202), and a seeded catalog
 * (run tools/scripts/seed-shop.mjs first).
 *
 *   1. Reset dev-student, give 1000 coins.
 *   2. STUDENT Shop: filter to Hats, buy the first affordable hat through the
 *      UI → coin balance drops and the card flips to "Owned".
 *   3. STUDENT Dressing room: the hat is in the HAT slot's owned grid; equip
 *      it → the AvatarRenderer reports it is "wearing" an item.
 *   4. ADMIN Items page boots; adding an item through the UI appends a row.
 */

import { execSync } from 'node:child_process';
import puppeteer from '../../../node_modules/puppeteer/lib/esm/puppeteer/puppeteer.js';

const STU = 'http://localhost:4201';
const ADM = 'http://localhost:4202';

const tag = Date.now().toString(36);
let failures = 0;
const fail = (m) => { failures += 1; console.error('  FAIL:', m); };
const ok = (m) => console.log('  OK:', m);
const must = (c, l, ctx = '') => (c ? ok(l) : fail(`${l} — ${ctx}`));
function sql(q) {
  return execSync(`docker exec codify-postgres psql -U codify -d codify_dev -A -t -c "${q.replace(/"/g, '\\"')}"`, { encoding: 'utf8' }).trim();
}
async function authptr(page, role) {
  await page.evaluate((r) => {
    localStorage.setItem('codify.auth.user', JSON.stringify({ id: `dev-${r}`, email: `${r}@codify.local`, displayName: r, role: r.toUpperCase(), avatarUrl: null, locale: 'pt-BR' }));
    localStorage.setItem('codify.auth.token', JSON.stringify({ token: `dev-token-${r}`, expiresAt: null }));
  }, role);
}

console.log(`Phase 8 browser probe — tag ${tag}\n`);

// 1. Reset student with coins
const uid = `(SELECT id FROM "User" WHERE "clerkId"='dev-student')`;
for (const t of ['EquippedItem', 'UserItem', 'CoinTransaction', 'XpEvent']) sql(`DELETE FROM "${t}" WHERE "userId" IN ${uid}`);
sql(`UPDATE "User" SET coins=1000, "totalXp"=0 WHERE "clerkId"='dev-student'`);
ok('reset dev-student (1000 coins)');

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('   [pageerror]', String(e).slice(0, 160)));

  // 2. Shop: buy a hat
  await page.goto(`${STU}/login`, { waitUntil: 'domcontentloaded' });
  await authptr(page, 'student');
  await page.goto(`${STU}/shop`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('[data-testid="shop-grid"]', { timeout: 12_000 }).catch(() => {});
  must(!!(await page.$('[data-testid="shop-grid"]')), 'shop grid renders', '');

  // Filter to Hats so the dressing room's default HAT slot has the bought item.
  await page.evaluate(() => {
    const chip = [...document.querySelectorAll('[data-testid="slot-filters"] .chip')].find((c) => c.textContent?.trim() === 'Hats');
    chip?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="buy-btn"]').length > 0, { timeout: 10_000 }).catch(() => {});

  const coinsBefore = await page.$eval('[data-testid="coin-balance"]', (el) => parseInt((el.textContent || '').replace(/\D/g, ''), 10)).catch(() => 0);
  const buyBtn = await page.$('[data-testid="buy-btn"] ion-button');
  must(!!buyBtn, 'an affordable hat has a Buy button', `coins=${coinsBefore}`);
  if (buyBtn) {
    await buyBtn.click();
    const dropped = await page
      .waitForFunction((before) => {
        const el = document.querySelector('[data-testid="coin-balance"]');
        const n = parseInt((el?.textContent || '').replace(/\D/g, ''), 10);
        return Number.isFinite(n) && n < before;
      }, { timeout: 12_000 }, coinsBefore)
      .then(() => true)
      .catch(() => false);
    must(dropped, 'coin balance drops after buying', `before=${coinsBefore}`);
    const ownedShown = await page.waitForFunction(() => (document.querySelector('[data-testid="shop-grid"]')?.textContent || '').includes('Owned'), { timeout: 8_000 }).then(() => true).catch(() => false);
    must(ownedShown, 'bought item shows "Owned"', '');
  }

  // 3. Dressing room: equip the hat
  await page.goto(`${STU}/avatar`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('[data-testid="owned-grid"]', { timeout: 12_000 }).catch(() => {});
  // The first owned card (after the "None" tile) is our hat — click to equip.
  const equipped = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('[data-testid="owned-grid"] [data-item-id]')];
    if (!cards.length) return false;
    cards[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return true;
  });
  must(equipped, 'dressing room shows an owned hat to equip', '');
  // The equipped card gets an "On" badge; the renderer's inner aria-label
  // (on .avatar, not the host) reports the worn item.
  const wearing = await page
    .waitForFunction(() => {
      const onBadge = (document.querySelector('[data-testid="owned-grid"]')?.textContent || '').includes('On');
      const label = (document.querySelector('[data-testid="dressing-avatar"] [aria-label]')?.getAttribute('aria-label') || '').toLowerCase();
      return onBadge && label.includes('wearing');
    }, { timeout: 8_000 })
    .then(() => true)
    .catch(() => false);
  must(wearing, 'avatar renders the equipped hat (card "On" + aria "wearing")', '');

  // 4. Admin Items page
  await page.goto(`${ADM}/login`, { waitUntil: 'domcontentloaded' });
  await authptr(page, 'admin');
  await page.goto(`${ADM}/items`, { waitUntil: 'networkidle2' });
  const sectionOk = await page.waitForSelector('[data-testid="items-section"]', { timeout: 12_000 }).then(() => true).catch(() => false);
  must(sectionOk, 'admin Items page boots', '');
  if (sectionOk) {
    const before = await page.$$eval('[data-testid="items-section"] .rows li', (els) => els.length);
    await page.type('[data-testid="item-slug"] input', `probe-item-${tag}`);
    await page.type('[data-testid="item-sprite"] input', 'emoji:🧪');
    // Name field is the 2nd input in the form-grid.
    await page.evaluate((t) => {
      const inputs = document.querySelectorAll('[data-testid="items-section"] .form-grid input');
      const nameInput = inputs[1];
      if (nameInput) { nameInput.value = `Probe Item ${t}`; nameInput.dispatchEvent(new Event('input', { bubbles: true })); }
    }, tag);
    await page.click('[data-testid="add-item-btn"] button');
    const grew = await page.waitForFunction((n) => document.querySelectorAll('[data-testid="items-section"] .rows li').length > n, { timeout: 10_000 }, before).then(() => true).catch(() => false);
    must(grew, 'adding an item via UI appends a row', `before=${before}`);
  }
} finally {
  await browser.close();
}

console.log(`\n${failures === 0 ? '✅ PASS' : `❌ ${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
