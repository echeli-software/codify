#!/usr/bin/env node
/**
 * Phase 6e probe — Stripe webhook handling (dev provider) + idempotency.
 *
 * The dev BillingProvider trusts parsed JSON (no signature), so we POST
 * synthetic Stripe events to /api/webhooks/stripe and assert our
 * Subscription mirror + access reconcile correctly:
 *
 *   1. Seed: category A, course-A (paid lesson), publish; plan unlocking A.
 *   2. GET /api/me (student) → resolve the student's userId for event metadata.
 *   3. Paid lesson with no sub → 402 (baseline).
 *   4. POST webhook `customer.subscription.created` (metadata.userId/planId)
 *      → 200; access query for the paid lesson flips to granted/subscription.
 *   5. Re-POST the SAME event id → 200 with duplicate=true (idempotent; no
 *      second row / no state churn).
 *   6. POST webhook `customer.subscription.deleted` with currentPeriodEnd in
 *      the past → 200; access flips back to paywall (CANCELED + expired).
 *   7. Unknown event type → 200 handled=false (ignored, still acked).
 *
 * Per memory/feedback_phase_verification.md: behavioural assertions.
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
const must = (cond, label, ctx = '') => (cond ? ok(label) : fail(`${label} — ${ctx}`));

async function api(method, path, body, auth = ADMIN) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(auth ? { authorization: auth } : {}),
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

// Webhook posts are unauthenticated (Public), no idempotency-key header.
async function webhook(event) {
  const res = await fetch(`${API}/webhooks/stripe`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(event),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* ignore */
  }
  return { status: res.status, body: json, raw: text };
}

const daysFromNow = (n) => Math.floor(Date.now() / 1000) + n * 86400;

console.log(`Phase 6e probe — tag ${tag}\n`);

// ─── 1. Seed ──────────────────────────────────────────────────────────
console.log('Seeding …');
const cat = (await api('POST', '/categories', { slug: `p6e-${tag}`, name: 'A' })).body;
const course = (
  await api('POST', '/courses', { slug: `p6e-c-${tag}`, title: 'C', categoryIds: [cat.id] })
).body;
const mod = (await api('POST', `/courses/${course.id}/modules`, { title: 'M' })).body;
const paid = (
  await api('POST', `/modules/${mod.id}/lessons`, { title: 'Paid', type: 'READING', isFree: false })
).body;
await api('POST', `/courses/${course.id}/publish`, {});
const plan = (
  await api('POST', '/plans', {
    slug: `p6e-plan-${tag}`,
    name: 'P6e Plan',
    categoryIds: [cat.id],
    prices: [{ currency: 'BRL', amountCents: 1990, period: 'MONTHLY' }],
  })
).body;
must(cat?.id && course?.id && paid?.id && plan?.id, 'seed', JSON.stringify({ plan: plan?.id }));

// ─── 2. Resolve student userId ────────────────────────────────────────
const me = await api('GET', '/me', null, STUDENT);
const userId = me.body?.id;
must(!!userId, 'resolved student userId via /api/me', me.raw);

// ─── 3. Baseline paywall ──────────────────────────────────────────────
const base = await api('GET', `/billing/access/lesson/${paid.id}`, null, STUDENT);
must(base.body?.granted === false, 'baseline: paid lesson paywalled', JSON.stringify(base.body));

// ─── 4. subscription.created webhook ──────────────────────────────────
console.log('\nWebhook: customer.subscription.created …');
const subId = `sub_test_${tag}`;
const createdEvt = {
  id: `evt_created_${tag}`,
  type: 'customer.subscription.created',
  data: {
    object: {
      id: subId,
      customer: `cus_test_${tag}`,
      status: 'active',
      current_period_start: daysFromNow(0),
      current_period_end: daysFromNow(30),
      cancel_at_period_end: false,
      metadata: { userId, planId: plan.id },
    },
  },
};
const w1 = await webhook(createdEvt);
must(w1.status === 200 && w1.body?.handled === true, 'created event handled', `${w1.status}: ${w1.raw}`);

const acc1 = await api('GET', `/billing/access/lesson/${paid.id}`, null, STUDENT);
must(
  acc1.body?.granted === true && acc1.body?.reason === 'subscription',
  'access granted after subscription.created',
  JSON.stringify(acc1.body),
);

// ─── 5. Idempotent replay ─────────────────────────────────────────────
console.log('\nWebhook: idempotent replay …');
const w1dup = await webhook(createdEvt);
must(w1dup.status === 200 && w1dup.body?.duplicate === true, 'replay → duplicate=true', JSON.stringify(w1dup.body));
const subs = await api('GET', '/billing/subscription', null, STUDENT);
const planSubs = (subs.body?.subscriptions ?? []).filter((s) => s.planId === plan.id);
must(planSubs.length === 1, 'still exactly one subscription for plan (no dupe row)', JSON.stringify(planSubs.length));

// ─── 6. subscription.deleted (expired) revokes access ─────────────────
console.log('\nWebhook: customer.subscription.deleted …');
const deletedEvt = {
  id: `evt_deleted_${tag}`,
  type: 'customer.subscription.deleted',
  data: {
    object: {
      id: subId,
      status: 'canceled',
      current_period_end: daysFromNow(-1),
      canceled_at: daysFromNow(-1),
      metadata: { userId, planId: plan.id },
    },
  },
};
const w2 = await webhook(deletedEvt);
must(w2.status === 200 && w2.body?.handled === true, 'deleted event handled', `${w2.status}: ${w2.raw}`);
const acc2 = await api('GET', `/billing/access/lesson/${paid.id}`, null, STUDENT);
must(acc2.body?.granted === false && acc2.body?.reason === 'paywall', 'access revoked after deletion', JSON.stringify(acc2.body));

// ─── 7. Unknown event acked but not handled ───────────────────────────
const w3 = await webhook({ id: `evt_unknown_${tag}`, type: 'customer.updated', data: { object: {} } });
must(w3.status === 200 && w3.body?.handled === false, 'unknown event acked, handled=false', JSON.stringify(w3.body));

console.log(`\n${failures === 0 ? '✅ PASS' : `❌ ${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
