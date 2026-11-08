# 09 — Billing

Stripe is the payment provider. Brazilian payment methods first-class: card (with installments), PIX, Boleto. Subscription model with category-bundled plans.

## 1. Concepts

| Concept                                              | Storage                           | Stripe analogue                        |
| ---------------------------------------------------- | --------------------------------- | -------------------------------------- |
| Plan (e.g. "Frontend Premium")                       | `Plan`                            | `Product`                              |
| Plan price (BRL monthly, BRL annual, USD monthly...) | `PlanPrice`                       | `Price`                                |
| What a plan unlocks                                  | `PlanCategory` ↔ `CourseCategory` | (our concept; Stripe doesn't model it) |
| User's active plan                                   | `Subscription`                    | `Subscription`                         |
| One-off charge (chest, future)                       | (later)                           | `PaymentIntent`                        |

## 2. Plan ↔ category model

- A `Plan` has 0..N `PlanCategory` rows linking to `Category`.
- A `Course` has 0..N `CourseCategory` rows linking to `Category`.
- A user with an active `Subscription(planId=P)` has access to every `Course` with at least one `Category` shared with `P`'s `PlanCategory` set.
- `Plan.isAllAccess = true`: bypasses category check, grants access to all published courses.

This is the **simple, predictable rule** the user spec requires:

> "subscription plan for frontend + mobile" = a single Plan with both `frontend` and `mobile` PlanCategory rows.
> "everything" plan = `isAllAccess: true`.

### "Plans including this course" resolution

```ts
function plansIncludingCourse(courseId): Plan[] {
  const cats = courseCategoriesOf(courseId).map((c) => c.id);
  return plans.filter(
    (p) =>
      p.isAllAccess || p.categories.some((pc) => cats.includes(pc.categoryId)),
  );
}
```

Cached per course (Redis, 5min TTL); invalidated when:

- A course's category set changes.
- A plan's category set changes.
- A plan's `isAllAccess` flag changes.
- A plan is activated/deactivated.

The student's course-detail page renders this list as chips (each linking to the plan's checkout).

## 3. Free preview & access logic

`libs/domain/access.canUserAccessLesson(user, lesson, course, subs, enrollments)` returns:

- `granted: true | false`
- `reason: 'subscription' | 'free_lesson' | 'free_course' | 'enrollment' | 'paywall'`
- `requiredPlans?: Plan[]` (when paywalled)

Order of evaluation:

1. `lesson.isFree` → granted (`free_lesson`).
2. Course is fully free (every lesson `isFree`) → granted (`free_course`).
3. Active `Enrollment` of source `GIFT` or `PROMO` → granted (`enrollment`). As built the sources are `SELF | PROMO | ADMIN_GRANT`: `PROMO` and `ADMIN_GRANT` grant access until `accessUntil` (null = no expiry); `SELF` (student enrolled themselves) never grants paid access (`enrollmentGrantsAccess` in `@codify/domain`).
4. **Access-granting subscription** (see status table below) whose plan includes one of the course's categories → granted (`subscription`).
5. Otherwise → not granted with `requiredPlans`.

Same function used by API enforcement and client UI gating. UI renders the paywall sheet with `requiredPlans` chips.

### What "active" means — `SubscriptionStatus` × access

| Status               | Grants access                | Notes                                                                                                                                           |
| -------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `TRIALING`           | ✅                           | Counts as active during trial window.                                                                                                           |
| `ACTIVE`             | ✅                           | Normal paid state.                                                                                                                              |
| `PAST_DUE`           | ✅ for first 3 days, then ❌ | Stripe retries during this window; we keep access for 3 days then revoke. Configurable via `GamificationConfig` key `billing.pastDueGraceDays`. |
| `INCOMPLETE`         | ❌                           | Initial payment hasn't succeeded yet.                                                                                                           |
| `INCOMPLETE_EXPIRED` | ❌                           | Payment timed out.                                                                                                                              |
| `UNPAID`             | ❌                           | All retries exhausted.                                                                                                                          |
| `PAUSED`             | ❌                           | Access revoked while paused.                                                                                                                    |
| `CANCELED`           | ❌                           | Access ends at `currentPeriodEnd`; `cancelAtPeriodEnd` flag determines whether we're still in the paid window.                                  |

Free preview ([04-admin-app.md §3](./04-admin-app.md) "Bulk: mark first N lessons free") is implemented by setting `lesson.isFree = true` on the chosen lessons. There is no separate "preview window" field; gating is uniformly `lesson.isFree` checked in step 1 above.

## 4. Stripe configuration

### Account setup

- Stripe account in **BRL primary**, additional currencies enabled (USD secondary).
- Brazilian payment methods activated: cards, PIX, Boleto.
- Tax: enable Stripe Tax for non-BR customers; for BR, charge inclusive of taxes (we set prices accordingly; Brazilian SaaS typically does not add tax line items).
- Statement descriptor: "CODIFY" (8 chars max effective).
- Webhook endpoint: `https://api.codify.app/api/webhooks/stripe`, signing secret stored as env var.

### Products & prices

- One **Stripe Product** per `Plan`.
- Multiple **Stripe Prices** per Product:
  - BRL monthly recurring
  - BRL annual recurring (with discount, e.g. 20%)
  - (Optional) USD monthly / annual
- Annual prices: configure as `interval=year`. Display per-month equivalent + annual savings ("R$ 39,90/mo, billed R$ 478,80/year — save 20%").

### Installments (parcelamento)

Stripe BR supports installments on credit card. We enable up to 12 parcelas, **without interest** (we eat the discount cost), for annual plans only. Monthly plans don't get installments (recurring already monthly). Configured per-price via `payment_method_options.card.installments`.

UI shows: "R$ 478,80 ou em até 12x de R$ 39,90 sem juros".

### PIX & subscriptions

- **One-shot PIX**: full support — checkout returns a QR code; webhook confirms payment within seconds (typically) or minutes.
- **Recurring PIX**: not auto-charging in Stripe today. Two patterns we support:
  - **PIX manual renewal**: user opts in; on each renewal we send PIX QR via push + email; if not paid by grace day, subscription enters `PAST_DUE`.
  - **PIX → card upgrade**: user pays first month with PIX, optionally adds a card for auto-renew.
- Default subscription path on the student app pushes card-first; PIX presented as alternative with the renewal caveat shown clearly.

**As built.** PIX (and Boleto) are offered only on the **BRL annual** price:
`POST /api/billing/checkout-session` refuses them on any other price
("PIX and Boleto are only available for the BRL annual plan"). Checkout
runs in `payment` mode; on `checkout.session.completed` /
`async_payment_succeeded` the webhook creates a one-year, non-renewing
subscription (`cancelAtPeriodEnd: true`, keyed by the Checkout Session id
`cs_…`). Renewal is manual: the daily billing job
(`sendRenewalReminders`) sends one `BILLING` push ("renew with PIX") in the
7 days before `currentPeriodEnd`, skipped when the user already holds a
later-ending subscription (renewed, or moved to card). Renewing is a new
checkout; an unpaid prepay simply ends at period end (no `PAST_DUE`).
Monthly PIX with a QR per renewal and the "first month by PIX, then card"
flow are not built (roadmap risk table: revisit recurring PIX later).

**Measuring the monthly-PIX drop-off (Phase 14).** Launch is annual-only for
PIX; Pix Automático is revisited with this data. The student subscription
page tags each visit with a `visitId` and sends
`checkout_method_unavailable { period: MONTHLY, currency: BRL, method: pix }`
when a BRL monthly checkout sheet shows card only, `visitId` + `currency` on
`checkout_start`, and `subscription_page_exit` when the visit ends without a
checkout (docs/10 §14). The admin Analytics overview's "Monthly BRL
checkouts: card only" card (`monthlyPix` in
`GET /api/admin/reports/overview`) classifies the last 30 days' card-only
visits by the first checkout started afterwards: monthly card checkout,
switched to annual (and how many of those paid by PIX / Boleto), or left.
Web events are sent only after analytics consent, so the counts are a
lower bound.

### Boleto

- Available as one-shot for full-year prepayment. Slow confirmation (1–3 business days). Not used for recurring.

## 5. Lifecycle

### New subscription (card path)

1. Student taps "Subscribe" on a plan.
2. Client calls `POST /api/billing/checkout-session` with `{ planPriceId, paymentMethod: 'card' }`.
3. API verifies user, creates Stripe Checkout Session (with `customer` lookup or creation), returns `url`.
4. Client opens Stripe Checkout (Capacitor: in-app browser; web: hosted page).
5. Stripe processes payment, redirects to `https://codify.app/billing/success?session_id=...`.
6. Webhook `checkout.session.completed` and `customer.subscription.created` arrive — we mirror to `Subscription` table (status `ACTIVE`).
7. Webhook `invoice.paid` arrives — emit "Welcome to [Plan]" email, grant first-month bonus coins (configurable promo).

### New subscription (PIX path)

1. As above, with `paymentMethod: 'pix'` on the BRL annual price (other prices are refused).
2. Checkout session shows QR + key.
3. Webhook `checkout.session.async_payment_succeeded` confirms (usually < 5 min).
4. Subscription created `ACTIVE` for one year, not renewing (`cancelAtPeriodEnd`); the renewal reminder below prompts the next PIX payment.

### Guardian step (minors, launch decision 2026-11)

**As built.** Users aged 12–17 (docs/14 §13.2) need a parent or guardian's confirmation before a **web** checkout:

1. `GET /api/billing/guardian-consent?planPriceId=` returns `{ required, ageGroup, consent }` for the subscription page.
2. `POST /api/billing/guardian-consent` `{ planPriceId, guardianName, guardianEmail, confirmed: true }` (STUDENT). The tick box reads "I am 18 or older and this user's parent or guardian". The API stores a `GuardianConsent` row (`purpose: web_checkout`, plan price, client IP from `clientIp()`, user agent) and emails the guardian a one-off notice in the student's locale (`EmailService.sendNotice`, `billing/guardian-consent-email.ts`). The notice names the student, plan and price, and says how to object; it has no unsubscribe link because the guardian is not a subscriber. Refusals: 409 `GUARDIAN_CONSENT_NOT_NEEDED` (adult), 403 `BIRTH_DATE_REQUIRED`, 400 `GUARDIAN_EMAIL_IS_STUDENT`, 429 `GUARDIAN_CONSENT_RATE_LIMITED` (5 per day, since each one emails someone). Audited `billing.guardian_consent` (no name / email in the audit row).
3. `POST /api/billing/checkout-session` lets adults through. A minor needs a confirmation **for that plan price** from the last 24 h (403 `GUARDIAN_CONSENT_REQUIRED`). An account with no date of birth gets 403 `BIRTH_DATE_REQUIRED`.

Store purchases (App Store / Google Play) don't come through here: the native app shows minors an "ask a parent" note, and the stores' family controls apply. The confirmations are part of the data export, and the purge deletes them.

### Renewal

- Card: Stripe auto-charges; on success → `invoice.paid` → continue. On fail → `invoice.payment_failed` → status `PAST_DUE`; Stripe smart retries; we email + push.
- PIX / Boleto (annual prepay): once in the 7 days before the period ends we push a "renew with PIX" reminder; renewing is a new checkout. If not renewed, the subscription ends at period end (no `PAST_DUE`).
- Recovery: once paid, status returns to `ACTIVE`.

### Plan change

- Upgrade: prorated immediately. Webhook `customer.subscription.updated`. Access to new categories is immediate.
- Downgrade: takes effect at period end (configurable). Show clear copy: "You'll keep current access until [date]; new plan starts then."

### Cancellation

- Self-serve via Stripe Customer Portal (linked from app settings).
- Default: cancel at period end. User keeps access until then.
- Status: `cancelAtPeriodEnd = true`. At period end → `CANCELED`.
- We do not have a "win-back" dark-pattern modal. Single confirm screen. Optional one-question survey (skippable).

### Refunds

- Self-serve refund window (e.g. 7 days from purchase) configurable in admin.
- Beyond window: support-tier (capped) and admin-tier (unlimited).
- Refund triggers `charge.refunded` → we update internal records and possibly revert recent gamification grants from a "first-month bonus" if abuse signal present.

**Implementation** (`billing/refunds.service.ts`): refunds are issued at the provider (`BillingProvider.refundPayment` — Stripe Refunds API on the invoice's PaymentIntent, the prepay Checkout Session's PaymentIntent, or the charge; Stripe idempotency key `refund:<paymentId>:<refundedCents>:<amount>`). The Payment row, the access change and the first-payment-bonus claw-back are applied only by the `charge.refunded` webhook path (§6), so they are idempotent; the dev provider returns the simulated `charge.refunded` event and it is processed inline through the same path.

| Method + path                                                               | Auth           | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --------------------------------------------------------------------------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /billing/refund-eligibility`                                           | STUDENT        | `{ eligible, reason: NO_PAYMENT\|STORE_PURCHASE\|WINDOW_PASSED\|ALREADY_USED\|ALREADY_REFUNDED\|null, windowDays, payment: { id, amountCents, currency, paidAt, planName } \| null, deadline }`. The self-serve refund covers the user's **first** web payment within `billing.refundWindowDays` (GamificationConfig, default 7) of paying, once per account.                                                                                                                                                                                                                                                                    |
| `POST /billing/refund` `{ confirm: "REFUND", reason? }`                     | STUDENT        | Full refund of that payment; the subscription ends now (canceled at Stripe too). `409 REFUND_NOT_ELIGIBLE { reason }`, `400 STORE_REFUND` (App Store / Google Play purchases are refunded by Apple / Google). Audited `billing.refund.self_serve` with before/after.                                                                                                                                                                                                                                                                                                                                                             |
| `POST /billing/admin/payments/:paymentId/refund` `{ amountCents?, reason }` | SUPPORT, ADMIN | Default = everything not yet refunded. SUPPORT: cumulative refunds on the payment ≤ one month of the plan (MONTHLY price in the payment currency, else ANNUAL ÷ 12) → `403 REFUND_CAP_EXCEEDED { capCents, requiredRole: "ADMIN" }`. `409 ALREADY_REFUNDED` / `REFUND_IN_PROGRESS` (one refund per payment state at a time), `400 REFUND_EXCEEDS_REMAINING` / `STORE_REFUND` / `REFUND_FAILED`. Response `{ paymentId, refund: { id, status, amountCents, currency }, before, after: { status, refundedCents }, accessEnded, capCents }` (with Stripe, `after` changes when the webhook lands). Audited `billing.refund.issued`. |

Dev checkouts (`POST /billing/dev/complete-checkout`) now log the Payment Stripe would (no row for a trial start), so the refund flows can be exercised locally.

## 6. Webhook handling

Endpoint: `POST /api/webhooks/stripe`.

Steps:

1. Read raw body (Express raw middleware so signature verification works).
2. `Stripe.webhooks.constructEvent(rawBody, sigHeader, webhookSecret)` — throws if invalid.
3. Idempotency check on `event.id` (`IdempotencyRecord` scope `stripe_webhook`). If seen, 200 OK.
4. Enqueue handler job in BullMQ for the event type. Return 200 immediately to Stripe.
5. Worker processes:
   - `customer.subscription.created/updated/deleted` → upsert `Subscription`.
   - `invoice.paid` → log payment, send transactional email, grant bonus if applicable.
   - `invoice.payment_failed` → status update, send recovery email/push.
   - `checkout.session.async_payment_succeeded` (PIX) → confirm subscription.
   - `charge.refunded` → record refund, optionally revert grants.

Failure handling: failed jobs retry with exponential backoff (BullMQ standard); after 5 fails, alert.

**Payment ledger** (`Payment`, upsert on `externalId` inside the event's transaction):

- `invoice.paid` → PAID (`externalId` = invoice id, `amount_paid`, currency, `method` card/pix/boleto read from the charge / expanded PaymentIntent when the event carries it, `receiptUrl` = `hosted_invoice_url`, `paidAt` = `status_transitions.paid_at`). $0 invoices (trial starts) are not logged. Owner = the mirrored subscription's user, else any subscription with the invoice's customer.
- `invoice.payment_failed` → FAILED (`amount_due`); never downgrades an invoice already PAID.
- `charge.refunded` → `refundedCents` = cumulative `amount_refunded` (only grows), status REFUNDED / PARTIALLY_REFUNDED; creates the row from the charge when the refund arrives first. PIX / Boleto prepay checkouts are logged under the Checkout Session id, and their refunds resolve to it.
- RevenueCat `INITIAL_PURCHASE` / `RENEWAL` / `NON_RENEWING_PURCHASE` → PAID store payments (APPLE / GOOGLE, `externalId` = store `transaction_id`, `method` "store"); `CANCELLATION` with `cancel_reason: CUSTOMER_SUPPORT` marks that transaction REFUNDED. Web purchases relayed by RevenueCat are left to the Stripe webhook.

**Ordering guard**: `Subscription.lastStripeEventAt` holds the `created` time of the newest event applied to the row. A subscription update from an older event is ignored (cancellation is terminal and always applies; refunds are definitive and also always apply). Payments are logged regardless of ordering.

**Read endpoints**: `GET /billing/payments?skip&take` (own, newest first, `{ items, total }`), `GET /billing/admin/users/:userId/payments` (SUPPORT/ADMIN; adds `externalId`), `GET /billing/admin/stripe-status` (ADMIN; `{ mode, secretKeyConfigured, webhookSecretConfigured, revenueCatWebhookConfigured, webhookPath, revenueCatWebhookPath, webhookUrl }` — booleans and paths only, never secrets).

## 7. Customer Portal

Stripe-hosted portal handles:

- Update payment method.
- Download invoices.
- Cancel subscription.
- View / change plan (we configure allowed price upgrades/downgrades).

Linked from `Settings → Subscription`. Opens in:

- Web: new tab.
- Capacitor iOS: in-app Safari View Controller.
- Capacitor Android: Custom Tabs.

Return URL: deep-link back to `Settings → Subscription`.

## 8. Pricing display

`libs/billing/formatPrice(price, locale, opts)` returns canonical strings:

| Locale                      | Output                                                     |
| --------------------------- | ---------------------------------------------------------- |
| pt-BR monthly               | `R$ 39,90/mês`                                             |
| pt-BR annual                | `R$ 478,80/ano · R$ 39,90/mês equivalente · economize 20%` |
| pt-BR annual + installments | `R$ 478,80/ano ou em até 12x de R$ 39,90 sem juros`        |
| en-US monthly               | `$9.99/mo`                                                 |
| en-US annual                | `$99.90/yr · $8.33/mo equivalent · save 17%`               |

Symbols and decimal/thousands separators per locale (Intl.NumberFormat).

## 9. Free trial

- Configurable per-plan: `trialDays` (default 7).
- Stripe `trial_period_days` on Checkout.
- Status `TRIALING` until `trialEndsAt`.
- Push reminder 2 days before trial ends.
  Implementation: a BILLING notice (inbox + push + email) once per subscription per trial end
  (`IdempotencyRecord billing_trial_reminder:<subscription>:<trialEndsAt>`), only while auto-renew is on.
  `customer.subscription.trial_will_end` (Stripe sends it 3 days ahead) mirrors the subscription and
  sends the reminder at once only when the trial ends within 2 days; otherwise — and for trials with no such
  event (store trials) — the hourly `billing-trial-reminders` job (:29, behind `JOBS_ENABLED`) sends it at
  the 2-day mark.
- Cancel during trial → no charge; access revoked at trial end.

## 10. Promo codes

Stripe coupons:

- Percentage-off or fixed-amount.
- Specific plans / first N months / forever.
- Usable on Checkout via Stripe-hosted promo input (we pass `allow_promotion_codes: true`).

App-issued promo codes (later):

- Internal table `PromoCode { code, planId?, validFrom, validTo, maxUses }` — for codes given out via influencers/marketing where we want analytics beyond Stripe's report.

## 11. Coin top-ups (later)

Not in initial scope. When added: one-time charges via Stripe Payment Intents, BR methods supported, mapped to `CoinTransaction` source `PROMO_CODE` or new `COIN_PURCHASE` (would require tax handling for digital currency in some jurisdictions; defer).

## 12. Edge cases

- **Refund after item purchase with bonus coins**: revert the gamification grant if it falls within a configurable window (e.g. 24h). Otherwise, accept the loss.
- **User downgrades to a plan that doesn't include their currently-being-watched course**: access remains until period end of the higher plan; client warns at downgrade time.
- **User in two simultaneous active subs (rare, edge case from upgrade timing)**: access is the union of both plans' categories.
- **Subscription paused** (`PAUSED`): access revoked; resume restores.
- **Family / shared accounts**: out of scope; Stripe doesn't really do this pattern. Future product decision.

## 13. Reporting

Admin dashboard pulls (precomputed nightly):

- MRR (BRL, USD), broken down by plan.
- New subs / churned / net new this week.
- Trial → paid conversion %.
- Average revenue per paying user (ARPPU).
- Refund rate.

Implementation: `GET /admin/reports/overview` (ADMIN) → `billing { mrr { currency: BRL, amountCents, byPlan[{ planId, planName, amountCents, subscriptions, excluded }] }, weeks[8]{ weekStart, newPaid, churned, netNew }, trialToPaid { trialsEnded, converted, rate }, arppu[{ currency, revenueCents, payingUsers, arppuCents }], refunds[{ currency, paidCents, refundedCents, payments, refundedPayments, rate }] }` — computed from Subscription / Payment / PlanPrice (MRR uses the dashboard's `computeMrr`; "new" = first non-failed payment of a subscription that week; "churned" = a subscription with a payment whose access ended that week; trial→paid = trials ended in the last 90 days with a payment after the trial; ARPPU over 30 days net of refunds; refund rate over 90 days). Cached 10 minutes per instance (`?fresh=1` recomputes) instead of a nightly precompute. The admin Analytics page renders it (docs/04).

### Win-back offer at checkout (docs/10 §13)

`GET /billing/offers` (STUDENT) → `{ winback: { offer: "winback", eligible, reason: NO_OFFER\|SUBSCRIBED\|USED\|NOT_CONFIGURED\|null, percentOff, appliesTo: "ANNUAL", expiresAt } }`. Eligible when the day-30 reactivation message was sent (REACTIVATION inbox row, `data.type = "winback"`) within `WINBACK_OFFER_DAYS` (14), the user has no live subscription, and has never redeemed it. `POST /billing/checkout-session` takes `offer: "winback"` (annual prices only — `400 OFFER_NOT_APPLICABLE`; `409 OFFER_NOT_AVAILABLE { reason }`): Stripe Checkout gets `discounts: [{ coupon: STRIPE_WINBACK_COUPON }]` (or `promotion_code: STRIPE_WINBACK_PROMOTION_CODE`) instead of `allow_promotion_codes`, and `metadata.offer = "winback"`; the dev provider charges `WINBACK_PERCENT_OFF` (20) less. Usage is recorded once per user (`IdempotencyRecord winback_offer:<userId>`) when the discounted checkout becomes a subscription (webhook create / prepay, or the dev completion).

## 14. Out of scope (initial)

- Apple In-App Purchases (deferred to mobile launch via RevenueCat — see [05-student-app.md §8](./05-student-app.md)).
- Google Play Billing (same).
- Multi-tenant / B2B billing.
- Custom enterprise contracts.
- Affiliate revenue share.
