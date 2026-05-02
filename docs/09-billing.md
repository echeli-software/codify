# 09 — Billing

Stripe is the payment provider. Brazilian payment methods first-class: card (with installments), PIX, Boleto. Subscription model with category-bundled plans.

## 1. Concepts

| Concept | Storage | Stripe analogue |
|---|---|---|
| Plan (e.g. "Frontend Premium") | `Plan` | `Product` |
| Plan price (BRL monthly, BRL annual, USD monthly...) | `PlanPrice` | `Price` |
| What a plan unlocks | `PlanCategory` ↔ `CourseCategory` | (our concept; Stripe doesn't model it) |
| User's active plan | `Subscription` | `Subscription` |
| One-off charge (chest, future) | (later) | `PaymentIntent` |

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
  const cats = courseCategoriesOf(courseId).map(c => c.id);
  return plans.filter(p =>
    p.isAllAccess ||
    p.categories.some(pc => cats.includes(pc.categoryId))
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
3. Active `Enrollment` of source `GIFT` or `PROMO` → granted (`enrollment`).
4. **Access-granting subscription** (see status table below) whose plan includes one of the course's categories → granted (`subscription`).
5. Otherwise → not granted with `requiredPlans`.

Same function used by API enforcement and client UI gating. UI renders the paywall sheet with `requiredPlans` chips.

### What "active" means — `SubscriptionStatus` × access

| Status | Grants access | Notes |
|---|---|---|
| `TRIALING` | ✅ | Counts as active during trial window. |
| `ACTIVE` | ✅ | Normal paid state. |
| `PAST_DUE` | ✅ for first 3 days, then ❌ | Stripe retries during this window; we keep access for 3 days then revoke. Configurable via `GamificationConfig` key `billing.pastDueGraceDays`. |
| `INCOMPLETE` | ❌ | Initial payment hasn't succeeded yet. |
| `INCOMPLETE_EXPIRED` | ❌ | Payment timed out. |
| `UNPAID` | ❌ | All retries exhausted. |
| `PAUSED` | ❌ | Access revoked while paused. |
| `CANCELED` | ❌ | Access ends at `currentPeriodEnd`; `cancelAtPeriodEnd` flag determines whether we're still in the paid window. |

Free preview ([04-admin-app.md §3](./04-admin-app.md) "Bulk: mark first N lessons free") is implemented by setting `lesson.isFree = true` on the chosen lessons. There is no separate "preview window" field; gating is uniformly `lesson.isFree` checked in step 1 above.

## 4. Stripe configuration

### Account setup
- Stripe account in **BRL primary**, additional currencies enabled (USD secondary).
- Brazilian payment methods activated: cards, PIX, Boleto.
- Tax: enable Stripe Tax for non-BR customers; for BR, charge inclusive of taxes (we set prices accordingly; Brazilian SaaS typically does not add tax line items).
- Statement descriptor: "CODIFY" (8 chars max effective).
- Webhook endpoint: `https://api.codify.app/v1/webhooks/stripe`, signing secret stored as env var.

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

### Boleto

- Available as one-shot for full-year prepayment. Slow confirmation (1–3 business days). Not used for recurring.

## 5. Lifecycle

### New subscription (card path)
1. Student taps "Subscribe" on a plan.
2. Client calls `POST /v1/billing/checkout-session` with `{ planPriceId, paymentMethod: 'card' }`.
3. API verifies user, creates Stripe Checkout Session (with `customer` lookup or creation), returns `url`.
4. Client opens Stripe Checkout (Capacitor: in-app browser; web: hosted page).
5. Stripe processes payment, redirects to `https://codify.app/billing/success?session_id=...`.
6. Webhook `checkout.session.completed` and `customer.subscription.created` arrive — we mirror to `Subscription` table (status `ACTIVE`).
7. Webhook `invoice.paid` arrives — emit "Welcome to [Plan]" email, grant first-month bonus coins (configurable promo).

### New subscription (PIX path)
1. As above, with `paymentMethod: 'pix'`.
2. Checkout session shows QR + key.
3. Webhook `checkout.session.async_payment_succeeded` confirms (usually < 5 min).
4. Subscription created `ACTIVE`. We schedule a `BILLING` notification for renewal day prompting next PIX.

### Renewal
- Card: Stripe auto-charges; on success → `invoice.paid` → continue. On fail → `invoice.payment_failed` → status `PAST_DUE`; Stripe smart retries; we email + push.
- PIX: 7 days before renewal we send PIX QR notification. If unpaid by renewal day, subscription `PAST_DUE`.
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

## 6. Webhook handling

Endpoint: `POST /v1/webhooks/stripe`.

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

| Locale | Output |
|---|---|
| pt-BR monthly | `R$ 39,90/mês` |
| pt-BR annual | `R$ 478,80/ano · R$ 39,90/mês equivalente · economize 20%` |
| pt-BR annual + installments | `R$ 478,80/ano ou em até 12x de R$ 39,90 sem juros` |
| en-US monthly | `$9.99/mo` |
| en-US annual | `$99.90/yr · $8.33/mo equivalent · save 17%` |

Symbols and decimal/thousands separators per locale (Intl.NumberFormat).

## 9. Free trial

- Configurable per-plan: `trialDays` (default 7).
- Stripe `trial_period_days` on Checkout.
- Status `TRIALING` until `trialEndsAt`.
- Push reminder 2 days before trial ends.
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

## 14. Out of scope (initial)

- Apple In-App Purchases (deferred to mobile launch via RevenueCat — see [05-student-app.md §8](./05-student-app.md)).
- Google Play Billing (same).
- Multi-tenant / B2B billing.
- Custom enterprise contracts.
- Affiliate revenue share.
