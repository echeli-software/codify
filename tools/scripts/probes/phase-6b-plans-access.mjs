#!/usr/bin/env node
/**
 * Phase 6b probe — Plans API + server-authoritative access + dev checkout.
 *
 * Pure-API (no browser). Exercises the billing flow end-to-end against a
 * running API using the dev-token stub auth + the DevBillingProvider:
 *
 *   1. Seed: category A, course-A in A, module, one paid + one free lesson,
 *      publish. Plus an unrelated category B + course-B in B.
 *   2. ADMIN create plan (categoryIds=[A], one BRL/monthly price);
 *      syncedToStripe=false until synced.
 *   3. ADMIN POST /plans/:id/sync-stripe → stripeProductId + price ids set.
 *   4. STUDENT GET /plans?courseId=courseA → includes the plan;
 *      GET /plans?courseId=courseB → excludes it.
 *   5. STUDENT complete paid lesson with no sub → 402 paywall, requiredPlans
 *      carries the plan. GET /billing/access/lesson/:id agrees.
 *   6. STUDENT POST /billing/checkout-session → mode=dev, url has session_id.
 *   7. STUDENT POST /billing/dev/complete-checkout → TRIALING, grantsAccess.
 *   8. STUDENT GET /billing/subscription → activePlanIds includes the plan.
 *   9. STUDENT complete paid lesson → 201 (granted via subscription); free
 *      lesson → 201; replay paid → 409 (idempotent).
 *  10. Access-after-category-change: course-B still paywalled; ADMIN PATCH
 *      plan to add category B → course-B access flips to granted immediately.
 *
 * Per memory/feedback_phase_verification.md: behaviour-specific assertions,
 * not just "endpoint returns 200".
 */

const API = 'http://localhost:3000/api';
const ADMIN = 'Bearer dev-token-admin';
const STUDENT = 'Bearer dev-token-student';

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
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* not json */
  }
  return { status: res.status, body: json, raw: text };
}

const must = (cond, label, ctx = '') => (cond ? ok(label) : fail(`${label} — ${ctx}`));

console.log(`Phase 6b probe — tag ${tag}\n`);

// ─── 1. Seed catalog ──────────────────────────────────────────────────
console.log('Seeding catalog …');
const catA = (await api('POST', '/categories', { slug: `p6b-a-${tag}`, name: 'A' })).body;
const catB = (await api('POST', '/categories', { slug: `p6b-b-${tag}`, name: 'B' })).body;

const courseA = (
  await api('POST', '/courses', {
    slug: `p6b-ca-${tag}`,
    title: 'Course A',
    categoryIds: [catA.id],
  })
).body;
const courseB = (
  await api('POST', '/courses', {
    slug: `p6b-cb-${tag}`,
    title: 'Course B',
    categoryIds: [catB.id],
  })
).body;

const modA = (await api('POST', `/courses/${courseA.id}/modules`, { title: 'M' })).body;
const modB = (await api('POST', `/courses/${courseB.id}/modules`, { title: 'M' })).body;
const paid = (
  await api('POST', `/modules/${modA.id}/lessons`, { title: 'Paid', type: 'READING', isFree: false })
).body;
const free = (
  await api('POST', `/modules/${modA.id}/lessons`, {
    title: 'Free',
    type: 'READING',
    isFree: true,
    baseXp: 7,
    baseCoins: 3,
  })
).body;
const paidB = (
  await api('POST', `/modules/${modB.id}/lessons`, { title: 'PaidB', type: 'READING', isFree: false })
).body;
await api('POST', `/courses/${courseA.id}/publish`, {});
await api('POST', `/courses/${courseB.id}/publish`, {});
must(catA?.id && courseA?.id && paid?.id && courseB?.id, 'seed catalog', JSON.stringify({ catA: catA?.id, courseA: courseA?.id }));

// ─── 2. Create plan ───────────────────────────────────────────────────
console.log('\nPlan create + sync …');
const created = await api('POST', '/plans', {
  slug: `p6b-plan-${tag}`,
  name: 'P6 Plan',
  tagline: 'Frontend track',
  categoryIds: [catA.id],
  prices: [{ currency: 'BRL', amountCents: 3990, period: 'MONTHLY' }],
});
must(created.status === 201, 'plan created', `${created.status}: ${created.raw}`);
const plan = created.body;
must(plan?.syncedToStripe === false, 'plan starts unsynced', JSON.stringify(plan?.syncedToStripe));
must(plan?.prices?.length === 1, 'plan has 1 price', JSON.stringify(plan?.prices?.length));

// ─── 3. Sync to Stripe ────────────────────────────────────────────────
const synced = await api('POST', `/plans/${plan.id}/sync-stripe`, {});
must(synced.status === 201 || synced.status === 200, 'sync-stripe ok', `${synced.status}`);
must(
  synced.body?.syncedToStripe === true && !!synced.body?.stripeProductId,
  'plan now has stripeProductId',
  JSON.stringify(synced.body?.stripeProductId),
);
const price = synced.body.prices[0];
must(!!price?.stripePriceId, 'price now has stripePriceId', JSON.stringify(price?.stripePriceId));

// ─── 4. plans-including-course ────────────────────────────────────────
console.log('\nplans-including-course …');
const forA = await api('GET', `/plans?courseId=${courseA.id}`, null, STUDENT);
must(
  forA.body?.items?.some((p) => p.id === plan.id),
  'plan listed for course A',
  JSON.stringify(forA.body?.items?.map((p) => p.id)),
);
const forB = await api('GET', `/plans?courseId=${courseB.id}`, null, STUDENT);
must(
  !forB.body?.items?.some((p) => p.id === plan.id),
  'plan NOT listed for course B',
  JSON.stringify(forB.body?.items?.map((p) => p.id)),
);

// ─── 5. Paywall before subscribing ────────────────────────────────────
console.log('\nPaywall (no subscription) …');
const blocked = await api('POST', `/lessons/${paid.id}/complete`, {}, STUDENT);
must(blocked.status === 402, 'paid lesson → 402', `${blocked.status}`);
must(blocked.body?.reason === 'paywall', 'reason=paywall', JSON.stringify(blocked.body?.reason));
must(
  (blocked.body?.requiredPlans ?? []).some((p) => p.id === plan.id),
  '402 carries requiredPlans incl. plan',
  JSON.stringify(blocked.body?.requiredPlans?.map((p) => p.id)),
);
const acc1 = await api('GET', `/billing/access/lesson/${paid.id}`, null, STUDENT);
must(acc1.body?.granted === false && acc1.body?.reason === 'paywall', 'access query agrees (paywall)', JSON.stringify(acc1.body));

// ─── 6. Checkout session ──────────────────────────────────────────────
console.log('\nCheckout + dev completion …');
const checkout = await api(
  'POST',
  '/billing/checkout-session',
  { planPriceId: price.id, paymentMethod: 'card' },
  STUDENT,
);
must(checkout.status === 200, 'checkout-session 200', `${checkout.status}: ${checkout.raw}`);
must(checkout.body?.mode === 'dev', 'checkout mode=dev', JSON.stringify(checkout.body?.mode));
must(/session_id=/.test(checkout.body?.url ?? ''), 'checkout url has session_id', checkout.body?.url);

// ─── 7. Complete checkout (stands in for webhook) ─────────────────────
const completed = await api(
  'POST',
  '/billing/dev/complete-checkout',
  { sessionId: checkout.body.sessionId },
  STUDENT,
);
must(completed.status === 201, 'dev complete-checkout 201', `${completed.status}: ${completed.raw}`);
must(completed.body?.status === 'TRIALING', 'subscription TRIALING (7-day trial)', JSON.stringify(completed.body?.status));
must(completed.body?.grantsAccess === true, 'subscription grantsAccess', JSON.stringify(completed.body?.grantsAccess));

// ─── 8. My subscription ───────────────────────────────────────────────
const mine = await api('GET', '/billing/subscription', null, STUDENT);
must(
  (mine.body?.activePlanIds ?? []).includes(plan.id),
  'GET subscription → activePlanIds incl. plan',
  JSON.stringify(mine.body?.activePlanIds),
);

// ─── 9. Access granted now ────────────────────────────────────────────
console.log('\nAccess granted via subscription …');
const acc2 = await api('GET', `/billing/access/lesson/${paid.id}`, null, STUDENT);
must(acc2.body?.granted === true && acc2.body?.reason === 'subscription', 'access query → subscription', JSON.stringify(acc2.body));
const nowPaid = await api('POST', `/lessons/${paid.id}/complete`, {}, STUDENT);
must(nowPaid.status === 201, 'complete paid lesson → 201', `${nowPaid.status}: ${nowPaid.raw}`);
const nowFree = await api('POST', `/lessons/${free.id}/complete`, {}, STUDENT);
must(nowFree.status === 201, 'complete free lesson → 201', `${nowFree.status}`);
const replay = await api('POST', `/lessons/${paid.id}/complete`, {}, STUDENT);
must(replay.status === 409, 'replay paid lesson → 409 (idempotent)', `${replay.status}`);

// ─── 10. Category-change flips access ─────────────────────────────────
console.log('\nAdmin changes plan categories → access updates …');
const blockedB = await api('POST', `/lessons/${paidB.id}/complete`, {}, STUDENT);
must(blockedB.status === 402, 'course-B paid lesson still 402', `${blockedB.status}`);
const patched = await api('PATCH', `/plans/${plan.id}`, { categoryIds: [catA.id, catB.id] });
must(patched.status === 200, 'plan categories patched', `${patched.status}`);
const accB = await api('GET', `/billing/access/lesson/${paidB.id}`, null, STUDENT);
must(
  accB.body?.granted === true && accB.body?.reason === 'subscription',
  'course-B access flips to granted',
  JSON.stringify(accB.body),
);

// ─── Result ───────────────────────────────────────────────────────────
console.log(`\n${failures === 0 ? '✅ PASS' : `❌ ${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
