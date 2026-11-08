# 14 — Security

Threat model is consumer SaaS in Brazil + global. Highest-impact surfaces: code execution, billing, gamification ledger, admin actions, content access enforcement.

## 1. Authentication

- **Clerk** for all auth. JWT-based sessions, signed by Clerk, verified via JWKS in NestJS middleware.
- Methods enabled: email magic link, Google, Apple. Phone optional.
- MFA: required for `ADMIN` role; optional for others (encouraged in onboarding for paid users).
  - As built (`apps/api/src/app/auth/staff-session.ts`): for `ADMIN` **and `SUPPORT`** (SUPPORT can suspend, refund and read PII, so it gets the same bar; `TEACHER` stays optional) the API requires the Clerk session token's factor-verification-age claim `fva = [minutesSinceFirstFactor, minutesSinceSecondFactor]` to show a second factor verified in this session (`fva[1] ≥ 0`), else `403 { code: "MFA_REQUIRED" }`; a token without `fva` fails closed. Dev tokens (no claims) are exempt. `GET /me` and `GET /me/account-status` stay reachable so the admin app can identify the user; it then shows a translated re-authentication screen (`/reauth`). `STAFF_MFA_ROLES` (comma list, default `ADMIN,SUPPORT`; `none` = break-glass off) configures the roles.
- Session lifetime: 7 days rolling refresh; absolute max 30 days.
- Logout: client clears local state + Clerk's `signOut`; server invalidates via Clerk webhook on `session.removed`.

## 2. Authorization

- Server-enforced. Client UI gating is for UX only.
- Roles: `STUDENT` (default), `TEACHER`, `SUPPORT`, `ADMIN`.
- Each API endpoint declares minimum role + resource-ownership rules:
  - `TEACHER` can only edit own courses.
  - `SUPPORT` cannot grant > 1000 coins or refund > 1 month of subscription.
  - `ADMIN` can do anything; all admin actions audit-logged.
- `libs/domain/access` is the single source for content access decisions; used by API enforcement and client UI.

## 3. Input validation

- All API inputs validated with zod / class-validator at the controller boundary.
- Payloads rejected with 400 + structured RFC 7807 error before hitting service code.
- File uploads: MIME sniffed (not just declared); size capped per type; SVGs sanitized via DOMPurify before storage.
  - As built: SVG is rejected outright (`400 ASSET_TYPE_NOT_ALLOWED`, "SVG uploads are not accepted") instead of sanitized; this rule wins over the SVG sprites in docs/08. Allowed per kind (`apps/api/src/app/assets/asset-rules.ts`): IMAGE PNG/JPEG/WebP/GIF ≤ 5 MB, COVER PNG/JPEG/WebP ≤ 8 MB, SPRITE PNG/WebP ≤ 1 MB, OTHER PDF ≤ 10 MB; the bytes are sniffed on confirm.
- Block editor JSON validated against `lessonDocSchema` (zod).

## 4. Output safety

- API responses scoped to requesting user. Course `solutionCode` for exercises **never** sent to clients.
- Lesson `contentJson` never sent to a client without access.
- Errors never expose stack traces in prod.
- HTML responses (rare, e.g. webhook return pages) escaped.

## 5. CSRF, CORS, CSP

- API is JWT-bearer, not cookie-based → CSRF not relevant for API.
- Stripe Customer Portal callback flow uses state tokens.
- CORS: allowlist `codify.app`, `app.codify.app`, `admin.codify.app`, plus per-PR preview hosts on the dev/staging envs only.
- CSP on admin and student app:
  - `default-src 'self'`
  - `script-src 'self' https://*.clerk.accounts.dev https://js.stripe.com`
  - `connect-src 'self' https://api.codify.app https://*.clerk.accounts.dev https://api.stripe.com https://*.cloudflare.com https://o*.ingest.sentry.io`
  - `img-src 'self' https://cdn.codify.app data:`
  - `frame-src https://js.stripe.com`
  - `style-src 'self' 'unsafe-inline'` (Bootstrap inlines some; later tighten with nonces)
  - `base-uri 'self'`; `form-action 'self'`
- COEP/COOP set on the student app to enable performance APIs without compromise.

## 6. Webhook signature verification

- **Stripe**: `Stripe.webhooks.constructEvent(rawBody, sig, secret)` — required. Reject if invalid. Use raw body middleware.
- **Clerk**: verify via Svix headers and Clerk's secret. Reject mismatched.
- Both webhook endpoints live behind Cloudflare with rules to allow only the provider IPs / `User-Agent` hints (defense in depth, not primary).

## 7. Rate limiting

- Per-user + per-IP token buckets in Redis.
- Defaults:
  - Auth endpoints (Clerk-managed; minimal here): n/a.
  - General API: 60 req/min/user, 600/min/IP.
  - Reward-event endpoints (`lesson.complete`, `exercise.submit`, `quiz.submit`): 10/min/user.
  - AI-prompt grading: 5/min/user, 60/day/user.
  - Code submission: 1/3s/user, 200/day/user.
- Exceeded → 429 with `Retry-After`.
- As built: throttle groups stack per route (`@CodeSubmitThrottle()` = code + reward), so `POST /exercises/:id/submit` is limited by 1/3 s, 200/day **and** the shared 10/min reward bucket. A Judge0 backlog over `CODE_QUEUE_MAX_BACKLOG` answers `503 CODE_QUEUE_BUSY` + `Retry-After` (docs/12 §7).
- **Client IP** (`apps/api/src/app/common/client-ip.ts`, one function for rate-limit trackers, audit rows and the request context): production chain is client → Cloudflare → Coolify proxy → API. Express resolves `req.ip` through `TRUST_PROXY` (default in production: `loopback, linklocal, uniquelocal`, i.e. the Coolify proxy on the Docker network), which yields the Cloudflare edge; only when that address is inside the Cloudflare ranges (built-in list, `CLOUDFLARE_IP_RANGES` overrides) is `CF-Connecting-IP` used. A request that reaches the origin directly can't spoof its IP with the header. `TRUST_CLOUDFLARE=false` disables the header entirely. Logs never carry IPs (§17). The same check (`viaCloudflare`) gates `CF-IPCountry`, which fills `User.country` (`common/client-country.ts`: ISO alpha-2, `XX` / `T1` ignored, refreshed at most daily on the `lastSeenAt` write); in dev, `x-dev-country` stands in for it only with `ALLOW_DEV_AUTH`.

## 8. Idempotency

- Required `Idempotency-Key` header on:
  - Reward-event endpoints.
  - Billing checkout/portal-session creation.
  - Coin spend (item purchase, chest purchase).
- Stored in Redis (24h) + `IdempotencyRecord` (audit-ready).
- Replays return the original response.
- As built: no Redis store; Postgres unique constraints carry it. Lesson completion takes no key and is idempotent on `Progress (userId, lessonId)` (replay → `409 LESSON_ALREADY_COMPLETED`, nothing granted). Every ledger write has a unique `idempotencyKey` (e.g. `lesson_reward:<userId>:<lessonId>`). `Idempotency-Key` (8–128 chars of `[A-Za-z0-9_.:-]`) is honoured on `POST /exercises/:id/submit`, quiz attempts and scenario runs, stored as `Submission.idempotencyKey` or an `IdempotencyRecord`; a replay returns the original result. Checkout and item purchase don't read the header.

## 9. Sandboxing — see [12-code-execution.md](./12-code-execution.md)

- Judge0 isolated VPS, no network out from sandboxes.
- Resource caps per submission.
- Network ACL: only API host can reach Judge0.

## 10. Secrets

- No secrets in repo. `.env.example` only.
- CI: GitHub Encrypted Secrets.
- Runtime: Coolify env vars.
- Rotation:
  - Stripe webhook signing secret: yearly + on-incident.
  - Clerk: managed by Clerk.
  - DB credentials: quarterly.
  - SSH keys: per-developer; revoke on offboard immediately.
- 1Password vault mirrors current values for ops reference; access scoped per role.

## 11. Audit logging

- `AuditLog` table append-only.
- Logged actions:
  - User suspended/unsuspended/deleted.
  - Manual coin/XP grant.
  - Refund issued.
  - Role change.
  - Plan price change.
  - Multiplier created/edited/deleted.
  - Item created/edited/deleted.
  - Translation marked complete.
  - Stripe configuration sync.
- Includes actor, IP, user-agent, before/after diff (where applicable).
  - IP and user agent are stamped automatically on every `AuditService.record` call from the request context (`RequestContextMiddleware`, AsyncLocalStorage; UA truncated to 512 chars) — controllers don't pass them; jobs (no request) record none. `record(actor, { before, after })` stores them as `diff.before` / `diff.after`.
  - Item, multiplier and plan (and plan price) update / delete rows carry the row as loaded before the change in `diff.before` (updates also `diff.after`; creates `diff.after`), the stored columns only (no derived URLs, timestamps or `activeNow`).
  - The account purge (§13.1) nulls `ip` / `userAgent` on the purged user's own audit rows (`actorId` = user); staff rows about the user keep the staff member's IP.
- Read-only in admin UI; export to S3 for long-term retention.

## 12. PII & data minimization

- **PII collected**: email (required, via Clerk), display name, locale, timezone, optional payment method (held by Stripe), optional payment-related billing address (held by Stripe).
- **Not collected**: phone number (unless user opts in for MFA), full name beyond display name, address (Stripe handles for billing).
- **Avoided**: third-party advertising trackers; we do our own analytics.
- **Retention**: deleted users hard-deleted 30 days after `User.deletedAt`. Gamification ledger retained anonymized for accounting.

## 13. LGPD (Brazil) & GDPR (EU)

- **Privacy Policy** + **Terms** linked from sign-up and Settings.
- **Right to access**: user can export their data (profile, progress, transactions) as JSON via Settings → Data & Privacy.
- **Right to delete**: self-serve "Delete account" → soft-delete + 14-day grace period to restore + 30-day hard delete.

### 13.1 Implementation (account lifecycle)

| Endpoint                                                                         | Auth                                                 | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| -------------------------------------------------------------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /me/export`                                                                 | any signed-in                                        | JSON attachment (`codify-data-YYYY-MM-DD.json`, `formatVersion` 1): profile + streak, enrollments, progress, quiz attempts, exercise submissions (code + verdicts), AI submissions, scenario runs, XP events, coin transactions, items + equipped, badges, quests, league memberships, friends (id + display name only), subscriptions, payments, notifications + preferences, certificates, analytics events. Once per 10 min → `429 EXPORT_RATE_LIMITED` + `Retry-After` / `retryAfter`. Audited `user.data_export` (the audit row is the throttle record).                                                                                                                       |
| `POST /me/delete` `{ confirm: "DELETE" }`                                        | any signed-in except ADMIN (`403 ADMIN_SELF_DELETE`) | Stops auto-renewal of web (Stripe) subscriptions first (cancel at period end; a provider failure aborts before anything changes), then sets `deletionRequestedAt` + `deletedAt` and removes device tokens. Response = account status + `autoRenewStopped[]` + `storeSubscriptions[]` (App Store / Google Play: the user must cancel in the store). Audited `user.deleted`.                                                                                                                                                                                                                                                                                                          |
| `GET /me/account-status`                                                         | any signed-in, also deleted/suspended                | `{ status: active\|deleted\|suspended, deletedAt, deletionRequestedAt, restorableUntil, purgeAt, suspendedAt }`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `POST /me/restore`                                                               | deleted account                                      | Within 14 days of a self-service deletion: clears both fields (`409 RESTORE_WINDOW_PASSED` / `NOT_DELETED` otherwise). Auto-renewal is not resumed automatically. Audited `user.restored`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `POST /admin/users/:id/suspend` `{ reason }` / `POST /admin/users/:id/unsuspend` | ADMIN, SUPPORT                                       | SUPPORT may suspend STUDENT / TEACHER accounts only (`403 INSUFFICIENT_ROLE`); nobody can suspend themselves. Suspension drops device tokens. Audited `user.suspended` / `user.unsuspended` with before/after. With `CLERK_SECRET_KEY` set, the user is also banned / unbanned at Clerk (`POST https://api.clerk.com/v1/users/{clerkId}/ban` / `/unban`; skipped — debug log — without a key or for non-Clerk ids like `dev-*`). If Clerk fails the local change stands, `user.idp_sync_failed` (`diff: { op, error }`) is audited and the response adds `warning: { code: 'IDP_SYNC_FAILED', message }`. `GET /admin/users/:id/account-status` adds `suspendedReason`, `purgedAt`. |

Request-time enforcement (auth middleware): a soft-deleted account may only call `GET /me/account-status` and `POST /me/restore`; anything else is `403 { code: "ACCOUNT_DELETED", restorableUntil }` (`restorableUntil` null past 14 days or when the auth provider deleted the user). A suspended account may only call `GET /me/account-status`; anything else is `403 { code: "ACCOUNT_SUSPENDED" }` (suspension wins over deletion). The student app routes these to its restore / suspended screens.

Purge job (`AccountPurgeService`, daily 03:17 UTC, behind `JOBS_ENABLED`): accounts with `deletedAt` older than 30 days and no `purgedAt` are anonymised in one transaction each — email → `deleted+<id>@users.invalid`, `clerkId` → `purged:<id>` (a new sign-in gets a new account), display name, avatar, referral code, quiet hours and notification settings reset; device tokens, notifications + preferences, friendships / requests / nudges, analytics events and certificates deleted; exercise code / output / results and AI answers blanked. Ledger (XP / coins), payments, subscriptions, enrollments and progress are kept on the anonymised row. Sets `purgedAt`, audits `user.purged`; idempotent. A purged account is treated as unauthenticated.

### 13.2 Minors (launch decision 2026-11: 12+)

As built. The pure rules live in `libs/domain/src/lib/age.ts`. They count age on the user's own calendar day (`User.timezone`). `ageGroup(user)` is `'minor'` (12–17), `'adult'` (18+) or `null` (not given). Gates use `isKnownAdult` / `canReceiveMarketing`, never `!isMinor`. **Fail closed:** an account with no date of birth gets the minor defaults and no marketing. For database filters, `adultBirthDateCutoff(now)` uses the earliest local day on Earth (UTC−12), so a user who turns 18 today stays a minor for up to one more day, never the reverse. `apps/api/src/app/users/age-policy.ts` holds the Prisma filters (`knownAdultWhere`, `ageGroupWhere`) and the shared refusal.

| Endpoint                                                                        | Auth           | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PUT /me/birth-date` `{ birthDate: "YYYY-MM-DD" }`                              | any signed-in  | Set once (`409 BIRTH_DATE_ALREADY_SET`). Must be a real date, not in the future and ≤ 120 years (`400 BIRTH_DATE_INVALID`, `reason`: invalid / future / too_old). **Under 12:** `403 AGE_BELOW_MINIMUM` (`minimumAge`, `accountDeleted: true`); the account is removed at once (below). 12–17 turns `activityFeedOptIn` and `marketingEmailOptIn` off. Audited `user.birth_date_set` with `{ ageGroup }` only. It is a dedicated endpoint, not a PATCH /me field: it is set once, can delete the account, and must stay out of the `user.update_self` diff. |
| `POST /admin/users/:id/birth-date` `{ birthDate, confirm: "CORRECT", reason? }` | ADMIN, SUPPORT | Staff correction. SUPPORT may correct student / teacher accounts only. Nobody can correct their own date. Audited `user.birth_date_corrected` with `before.ageGroup` / `after.ageGroup` and the reason, never the dates. A date under 12 deletes the account (`after: { deleted: true }`). An ADMIN account is never deleted this way.                                                                                                                                                                                                                      |
| `GET /me`                                                                       | any signed-in  | Adds `birthDate` (the user's own data) and `ageGroup`. The staff views (`GET /users/:id`, `GET /users`) show `ageGroup` only. `GET /users?ageGroup=minor\|adult\|none` filters the list on the UTC day.                                                                                                                                                                                                                                                                                                                                                     |

**Under-12 removal** (`UnderAgeDeletionService`, account module): stop web auto-renewal (best effort), then mark the account deleted with no `deletionRequestedAt` (never restorable), then run `AccountPurgeService.purgeUser` at once, then delete the Clerk user (`DELETE /v1/users/{id}`; a 404 counts as done, a failure is logged, not thrown). An audit row `user.deleted_under_age` (`{ by, minimumAge }`) is written before the purge, which then strips its IP / UA. The purge now also clears `birthDate` and deletes `GuardianConsent` rows. What remains is what any purge keeps: the anonymised row (role, locale, time zone, totals), ledger, payments, subscriptions, enrollments, progress, blanked submissions and audit rows. Known limit: a still-valid Clerk JWT (up to its ~60 s lifetime) could provision a fresh, empty account if a request were made with it. The app ends the session before any further call.

**Minor defaults**, enforced by the API (the apps only follow):

- Public profile: `GET /users/:id/profile` returns 404 ("User not found", the same as an unknown id) unless the viewer is the user or a friend.
- Discovery: there is no student-facing user search or friend-suggestion surface, and the admin search is staff-only. League standings still list the display name, but each member carries `profileVisible` (false for minors who aren't the viewer's friend), so the app doesn't link them. Friend requests by exact email still work: they reveal nothing and the minor must accept. Certificate verification stays public by serial, because the holder chooses to share it.
- Friends activity feed: `PATCH /me { activityFeedOptIn: true }` returns 403 `AGE_RESTRICTED` (`setting`). The feed query only includes known adults, even if a minor opted in earlier.
- Marketing: `PATCH /me { marketingEmailOptIn: true }` returns 403 `AGE_RESTRICTED`. Promotional push and email go only to `canReceiveMarketing(user)` users (`@codify/domain`; the notifications code checks it, docs/10 §3).
- Turning 18 changes nothing automatically: settings stay as they were, and the user may change them from then on.
- Paid plans: guardian confirmation for web checkout (docs/09 "Guardian step").

- **Lawful basis**: contract for service delivery (most processing); consent for marketing email (opt-in).
- **DPO contact**: published in privacy policy.
- **Data residency**: BR DB primary; backups in same region; no cross-region transfer of PII without explicit consent flow (which we don't currently need).
- **Cookies**: minimal — auth + analytics. Banner on first visit (web only) with granular toggles.
  - _As built_ (`apps/student/src/app/components/consent-banner.component.ts`,
    `telemetry/consent.ts`): first web visit shows _Accept all_ / _Necessary
    only_ / _Customize_ (necessary — always on; product analytics; error
    reporting) with a link to `/privacy`; the choice is stored only in
    localStorage (`codify.consent.v1`, versioned). Until analytics is allowed
    `TelemetryService` drops events (nothing is buffered); Sentry is only
    initialised at start-up when error reporting is allowed (a later "allow"
    applies from the next launch). The same toggles live on Settings → Data &
    privacy. Native apps show no banner: analytics and diagnostics are declared
    in the App Store privacy details / Play Data safety form and are on.

## 14. Payment compliance

- We never store card numbers; Stripe holds them. PCI scope minimized to SAQ-A (we redirect to Stripe-hosted Checkout / Portal).
- Boleto / PIX QR codes generated by Stripe; we don't process raw bank data.
- Receipts emailed by Stripe; we mirror in our app.

## 15. App security

- **Capacitor**:
  - `webContentsDebuggingEnabled: false` in prod.
  - Cleartext traffic disabled.
  - Deep links validated against an allowlist.
  - WebView CSP enforced.
  - SSL pinning considered post-launch (operational cost vs gain).
- **Web (PWA / admin)**:
  - HSTS preload registered.
  - `X-Content-Type-Options: nosniff`.
  - `Referrer-Policy: strict-origin-when-cross-origin`.
  - `Permissions-Policy` disables unused features (camera, mic, geolocation by default).

## 16. Dependency hygiene

- Renovate (or Dependabot) PRs for minor/patch.
- Major upgrades manual, scheduled.
- `pnpm audit` in CI; high/critical fail the build.
- License check in CI; copyleft licenses (AGPL, etc.) blocked unless approved.
- SBOM generated on release.
- As built (`.github/workflows/ci.yml`): `node infra/ci/audit-check.mjs` runs `pnpm audit --prod` and fails on any high/critical advisory not accepted in `infra/ci/audit-allowlist.json` (each entry: reason + expiry ≤ 90 days; expired entries fail, fixed ones are reported as stale). The 2026-11-08 baseline (49 advisories: Angular 21.2 patches, the Express stack under `@nestjs/platform-express` incl. `proxy-addr`/`multer`/`body-parser`, `zod`, editor libs, build tooling pulled in by `@sentry/node` and `prisma`) needs dependency upgrades in the root `package.json`. `node infra/ci/licence-check.mjs` checks `pnpm licenses list --prod` against a permissive allow-list (MIT, ISC, Apache-2.0, BSD, 0BSD, BlueOak, Unlicense, CC0, CC-BY-4.0 data, …; `A OR B` passes if one side does); `sentry` (FSL-1.1-Apache-2.0, via `@sentry/node`) is the one approved exception.

## 17. Logging & sensitive data

- Never log: passwords (we don't have any), tokens, full card numbers (we never see), PII beyond user id.
- Structured logs at INFO; DEBUG only in non-prod or with feature flag.
- Sentry breadcrumbs scrubbed for PII via `beforeSend`.

## 18. Admin protections

- Strong recommendation: admin login restricted by IP allowlist when feasible. Initial: standard Clerk-protected with mandatory MFA for `ADMIN`.
- Admin actions on user data display warning + require typed confirmation for destructive ops ("Type the user email to confirm deletion").
- Admin sessions: 12-hour absolute timeout (vs 7-day for students).
  - As built: the same check refuses ADMIN / SUPPORT sessions whose first factor was verified more than `STAFF_SESSION_MAX_HOURS` (default 12) ago — `fva[0]` — with `403 { code: "SESSION_TOO_OLD", maxSessionHours }`; signing in again (or Clerk step-up reverification) resets it. Also set the Clerk instance's session maximum lifetime so idle tokens can't be refreshed indefinitely.
- Role changes: `PATCH /api/admin/users/:id/role` (ADMIN only, never your own account), audited `user.role_changed` with before/after (docs/04 §10).

## 19. Disclosure & incident response

- **security@codify.app** mailbox monitored.
- Public security policy at `/.well-known/security.txt`.
  - As built: RFC 9116 file (Contact `mailto:security@codify.app`, Expires, Preferred-Languages, Canonical) served by the API at `https://api.codify.app/.well-known/security.txt` (outside the `/api` prefix; Canonical from `API_PUBLIC_URL`) and shipped as `apps/student|admin/public/.well-known/security.txt`. Marked as a draft like the legal pages: confirm the mailbox before launch. A unit test (`common/security-txt.spec.ts`) keeps the three in sync and fails 30 days before `Expires`, forcing a yearly renewal.
- IR runbook in repo (`docs/runbooks/incident-response.md`, written when incident protocol matures).
- Bug bounty: not at launch; consider after stable.

## 20. Periodic reviews

- Quarterly: review IAM, access logs, dependency CVEs, key rotation calendar.
- Semi-annually: pen test (third party), SOC-2-style internal review (not for cert; for hygiene).
- Yearly: full threat-model refresh.

## 21. Out of scope (initial)

- SOC2 / ISO27001 certification.
- Enterprise SSO (SAML).
- Customer-managed encryption keys.
- HIPAA / financial-services-grade isolation.
- On-prem deployment.
