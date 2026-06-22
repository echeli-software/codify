#!/usr/bin/env node
/**
 * Phase 11a probe — RevenueCat entitlement webhook → Subscription → access.
 *
 *   1. Seed a paid course (category A) + a plan granting entitlement E.
 *   2. STUDENT has no access to the paid lesson.
 *   3. RevenueCat INITIAL_PURCHASE (App Store) → Subscription (source
 *      APPLE_IAP, ACTIVE) created; access now GRANTED. (Acceptance #1.)
 *   4. RENEWAL (same original_transaction_id) extends the period in place.
 *   5. Duplicate delivery (same event id) is dropped.
 *   6. EXPIRATION closes the period → access REVOKED.
 *   7. Malformed payload → 400. Ledger drift-free (IAP never touches coins/xp).
 */

import { execSync } from 'node:child_process';

const API = 'http://localhost:3000/api';
const ADMIN = 'Bearer dev-token-admin';
const STUDENT = 'Bearer dev-token-student';

const tag = Date.now().toString(36);
const ENTITLEMENT = `all_access_${tag}`;
const ORIG_TX = `100000_${tag}`;
let failures = 0;
const fail = (m) => { failures += 1; console.error('  FAIL:', m); };
const ok = (m) => console.log('  OK:', m);
const must = (c, l, ctx = '') => (c ? ok(l) : fail(`${l} — ${ctx}`));

async function api(method, path, body, auth = ADMIN, extraHeaders = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'content-type': 'application/json', authorization: auth, 'idempotency-key': crypto.randomUUID(), ...extraHeaders },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null; try { json = text ? JSON.parse(text) : null; } catch { /* */ }
  return { status: res.status, body: json, raw: text };
}
function sql(q) { return execSync(`docker exec codify-postgres psql -U codify -d codify_dev -A -t -c "${q.replace(/"/g, '\\"')}"`, { encoding: 'utf8' }).trim(); }

/** Post a RevenueCat webhook (unauthenticated public route, dev provider). */
function rcPost(event) {
  return api('POST', '/webhooks/revenuecat', { api_version: '1.0', event }, 'Bearer none');
}
function rcEvent(type, overrides = {}) {
  return {
    id: `evt_${type}_${tag}_${overrides.idSuffix ?? ''}`.replace(/_$/, ''),
    type,
    app_user_id: STUDENT_ID,
    product_id: `codify.all_access.monthly`,
    entitlement_ids: [ENTITLEMENT],
    period_type: 'NORMAL',
    store: 'APP_STORE',
    transaction_id: `${ORIG_TX}.${overrides.txN ?? 1}`,
    original_transaction_id: ORIG_TX,
    environment: 'SANDBOX',
    purchased_at_ms: Date.now(),
    expiration_at_ms: Date.now() + 30 * 86_400_000,
    ...overrides,
  };
}

console.log(`Phase 11a probe — tag ${tag}\n`);

const STUDENT_ID = sql(`SELECT id FROM "User" WHERE "clerkId"='dev-student'`);
must(!!STUDENT_ID, 'resolved dev-student id', STUDENT_ID);
// Clean slate: drop the student's subscriptions so "no access before purchase" holds.
sql(`DELETE FROM "Subscription" WHERE "userId"='${STUDENT_ID}'`);

// 1. Seed paid course + plan.
const catA = (await api('POST', '/categories', { slug: `p11a-${tag}`, name: 'A' })).body;
const course = (await api('POST', '/courses', { slug: `p11a-c-${tag}`, title: 'A', categoryIds: [catA.id] })).body;
const mod = (await api('POST', `/courses/${course.id}/modules`, { title: 'M' })).body;
const paid = (await api('POST', `/modules/${mod.id}/lessons`, { title: 'Paid', type: 'READING', isFree: false })).body;
await api('POST', `/courses/${course.id}/publish`, {});
const plan = (await api('POST', '/plans', { slug: `p11a-plan-${tag}`, name: 'Mobile Plan', categoryIds: [catA.id], revenueCatEntitlementId: ENTITLEMENT, prices: [{ currency: 'BRL', amountCents: 2990, period: 'MONTHLY' }] })).body;
must(plan?.revenueCatEntitlementId === ENTITLEMENT, 'plan created with RevenueCat entitlement via API', JSON.stringify(plan?.revenueCatEntitlementId));

// 2. No access before purchase.
const before = await api('GET', `/billing/access/lesson/${paid.id}`, null, STUDENT);
must(before.body?.granted === false, 'no access to paid lesson before purchase', JSON.stringify(before.body));

// 3. INITIAL_PURCHASE → subscription + access.
const init = await rcPost(rcEvent('INITIAL_PURCHASE'));
must(init.status === 200 && init.body?.handled === true && init.body?.duplicate === false, 'INITIAL_PURCHASE handled', JSON.stringify(init.body));
const subRow = sql(`SELECT source||'|'||status FROM "Subscription" WHERE "storeTransactionId"='${ORIG_TX}'`);
must(subRow === 'APPLE_IAP|ACTIVE', 'Subscription created (APPLE_IAP, ACTIVE)', subRow);
const after = await api('GET', `/billing/access/lesson/${paid.id}`, null, STUDENT);
must(after.body?.granted === true, 'access GRANTED after IAP purchase (acceptance #1)', JSON.stringify(after.body));
const subResp = await api('GET', '/billing/subscription', null, STUDENT);
must((subResp.body?.activePlanIds ?? []).includes(plan.id), 'GET /billing/subscription lists the plan', JSON.stringify(subResp.body?.activePlanIds));

// 4. RENEWAL extends the period in place (same original_transaction_id).
const endBefore = sql(`SELECT extract(epoch from "currentPeriodEnd")::bigint FROM "Subscription" WHERE "storeTransactionId"='${ORIG_TX}'`);
const renew = await rcPost(rcEvent('RENEWAL', { idSuffix: 'r', txN: 2, expiration_at_ms: Date.now() + 60 * 86_400_000 }));
must(renew.body?.handled === true, 'RENEWAL handled', JSON.stringify(renew.body));
const rowCount = sql(`SELECT count(*) FROM "Subscription" WHERE "storeTransactionId"='${ORIG_TX}'`);
must(rowCount === '1', 'renewal updates the same row (no duplicate)', rowCount);
const endAfter = sql(`SELECT extract(epoch from "currentPeriodEnd")::bigint FROM "Subscription" WHERE "storeTransactionId"='${ORIG_TX}'`);
must(Number(endAfter) > Number(endBefore), 'renewal extends currentPeriodEnd', `${endBefore} -> ${endAfter}`);

// 5. Duplicate delivery (same event id) is dropped.
const dup = await rcPost(rcEvent('INITIAL_PURCHASE'));
must(dup.body?.duplicate === true && dup.body?.handled === false, 'duplicate event id dropped (idempotent)', JSON.stringify(dup.body));

// 6. EXPIRATION → access revoked.
const exp = await rcPost(rcEvent('EXPIRATION', { idSuffix: 'x', expiration_at_ms: Date.now() - 1000 }));
must(exp.body?.handled === true, 'EXPIRATION handled', JSON.stringify(exp.body));
const expStatus = sql(`SELECT status FROM "Subscription" WHERE "storeTransactionId"='${ORIG_TX}'`);
must(expStatus === 'CANCELED', 'subscription CANCELED on expiration', expStatus);
const afterExp = await api('GET', `/billing/access/lesson/${paid.id}`, null, STUDENT);
must(afterExp.body?.granted === false, 'access REVOKED after expiration', JSON.stringify(afterExp.body));

// 7. Malformed payload → 400.
const bad = await api('POST', '/webhooks/revenuecat', { event: { type: 'RENEWAL' } }, 'Bearer none');
must(bad.status === 400, 'malformed payload (no id/app_user_id) → 400', `${bad.status}`);

console.log(`\n${failures === 0 ? '✅ PASS' : `❌ ${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
