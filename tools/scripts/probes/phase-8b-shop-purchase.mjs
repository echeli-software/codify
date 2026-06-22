#!/usr/bin/env node
/**
 * Phase 8b probe — shop eligibility + atomic purchase + equip + ledger.
 *
 *   0. Reset dev-student; give them a known coin balance.
 *   1. ADMIN seeds an item category + 3 items: a cheap HAT (affordable), an
 *      expensive FRAME (too pricey), a level-locked PET.
 *   2. STUDENT GET /shop → eligibility per item (canBuy + reason).
 *   3. STUDENT buys the HAT → 201, coins debited exactly; ledger drift-free;
 *      re-buy → 409 (already owned), no double charge.
 *   4. STUDENT buys the expensive FRAME → 400 (not enough coins).
 *   5. STUDENT equips the HAT → GET /avatar shows it in the HAT slot;
 *      unequip → slot empty. Equipping an unowned item → 403.
 *   6. Inventory lists the owned HAT.
 */

import { execSync } from 'node:child_process';

const API = 'http://localhost:3000/api';
const ADMIN = 'Bearer dev-token-admin';
const STUDENT = 'Bearer dev-token-student';

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
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* */ }
  return { status: res.status, body: json, raw: text };
}
function sql(q) {
  return execSync(`docker exec codify-postgres psql -U codify -d codify_dev -A -t -c "${q.replace(/"/g, '\\"')}"`, { encoding: 'utf8' }).trim();
}

console.log(`Phase 8b probe — tag ${tag}\n`);

// 0. Reset + give 500 coins
const uid = `(SELECT id FROM "User" WHERE "clerkId"='dev-student')`;
for (const t of ['CoinTransaction', 'XpEvent', 'EquippedItem', 'UserItem', 'Streak']) sql(`DELETE FROM "${t}" WHERE "userId" IN ${uid}`);
sql(`UPDATE "User" SET coins=500, "totalXp"=0 WHERE "clerkId"='dev-student'`);
const studentId = await api('GET', '/me', null, STUDENT).then((r) => r.body?.id);
ok(`reset dev-student (500 coins, level 1)`);

// 1. Seed category + items
await api('POST', '/item-categories', { slug: `cat-${tag}`, name: 'Test' });
const hat = (await api('POST', '/items', { slug: `hat-${tag}`, name: 'Cap', slot: 'HAT', categorySlug: `cat-${tag}`, costCoins: 100, spriteAssetId: 'emoji:🧢' })).body;
const frame = (await api('POST', '/items', { slug: `frame-${tag}`, name: 'Gold Frame', slot: 'FRAME', categorySlug: `cat-${tag}`, costCoins: 9000, rarity: 'EPIC', spriteAssetId: 'color:#ffd700' })).body;
const pet = (await api('POST', '/items', { slug: `pet-${tag}`, name: 'Dragon', slot: 'PET', categorySlug: `cat-${tag}`, costCoins: 50, requiredLevel: 20, spriteAssetId: 'emoji:🐉' })).body;
must(hat?.id && frame?.id && pet?.id, 'seeded 3 items', JSON.stringify({ hat: hat?.id }));

// 2. Shop eligibility
const shop = await api('GET', '/shop', null, STUDENT);
const byId = Object.fromEntries((shop.body ?? []).map((s) => [s.id, s]));
must(byId[hat.id]?.canBuy === true && byId[hat.id]?.reason === 'ok', 'hat is buyable', JSON.stringify(byId[hat.id]));
must(byId[frame.id]?.canBuy === false && byId[frame.id]?.reason === 'insufficient_coins', 'frame too expensive', JSON.stringify(byId[frame.id]?.reason));
must(byId[pet.id]?.canBuy === false && byId[pet.id]?.reason === 'level_locked', 'pet level-locked', JSON.stringify(byId[pet.id]?.reason));

// 3. Buy the hat
const buy = await api('POST', `/shop/${hat.id}/purchase`, {}, STUDENT);
must(buy.status === 201, 'buy hat → 201', `${buy.status}: ${buy.raw}`);
must(buy.body?.coins === 400, 'coins debited 500→400', JSON.stringify(buy.body?.coins));
const balanceAfter = parseInt(sql(`SELECT "balanceAfter" FROM "CoinTransaction" WHERE "userId"='${studentId}' ORDER BY "createdAt" DESC LIMIT 1`), 10);
const sumDelta = parseInt(sql(`SELECT COALESCE(SUM(delta),0) FROM "CoinTransaction" WHERE "userId"='${studentId}'`), 10);
must(balanceAfter === sumDelta && balanceAfter === 400, 'ledger drift-free after purchase', `${balanceAfter} vs ${sumDelta}`);
const rebuy = await api('POST', `/shop/${hat.id}/purchase`, {}, STUDENT);
must(rebuy.status === 409, 're-buy hat → 409 (owned)', `${rebuy.status}`);
const coinsNow = await api('GET', '/me', null, STUDENT).then((r) => r.body?.coins);
must(coinsNow === 400, 'no double charge on re-buy', `${coinsNow}`);

// 4. Buy unaffordable
const buyFrame = await api('POST', `/shop/${frame.id}/purchase`, {}, STUDENT);
must(buyFrame.status === 400, 'buy frame → 400 (insufficient)', `${buyFrame.status}`);

// 5. Equip / unequip
const equip = await api('PUT', '/avatar/equip', { slot: 'HAT', itemId: hat.id }, STUDENT);
must(equip.body?.equipped?.HAT?.itemId === hat.id, 'equip hat → shows in HAT slot', JSON.stringify(equip.body?.equipped?.HAT));
const unequip = await api('PUT', '/avatar/equip', { slot: 'HAT', itemId: null }, STUDENT);
must(!unequip.body?.equipped?.HAT, 'unequip → HAT slot empty', JSON.stringify(unequip.body?.equipped));
const equipUnowned = await api('PUT', '/avatar/equip', { slot: 'PET', itemId: pet.id }, STUDENT);
must(equipUnowned.status === 403, 'equip unowned item → 403', `${equipUnowned.status}`);

// 6. Inventory
const inv = await api('GET', '/inventory', null, STUDENT);
must((inv.body ?? []).some((i) => i.item.id === hat.id), 'inventory lists owned hat', JSON.stringify((inv.body ?? []).map((i) => i.item.slug)));

console.log(`\n${failures === 0 ? '✅ PASS' : `❌ ${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
