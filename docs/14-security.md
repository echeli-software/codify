# 14 — Security

Threat model is consumer SaaS in Brazil + global. Highest-impact surfaces: code execution, billing, gamification ledger, admin actions, content access enforcement.

## 1. Authentication

- **Clerk** for all auth. JWT-based sessions, signed by Clerk, verified via JWKS in NestJS middleware.
- Methods enabled: email magic link, Google, Apple. Phone optional.
- MFA: required for `ADMIN` role; optional for others (encouraged in onboarding for paid users).
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

## 8. Idempotency

- Required `Idempotency-Key` header on:
  - Reward-event endpoints.
  - Billing checkout/portal-session creation.
  - Coin spend (item purchase, chest purchase).
- Stored in Redis (24h) + `IdempotencyRecord` (audit-ready).
- Replays return the original response.

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
- **Lawful basis**: contract for service delivery (most processing); consent for marketing email (opt-in).
- **DPO contact**: published in privacy policy.
- **Data residency**: BR DB primary; backups in same region; no cross-region transfer of PII without explicit consent flow (which we don't currently need).
- **Cookies**: minimal — auth + analytics. Banner on first visit (web only) with granular toggles.

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

## 17. Logging & sensitive data

- Never log: passwords (we don't have any), tokens, full card numbers (we never see), PII beyond user id.
- Structured logs at INFO; DEBUG only in non-prod or with feature flag.
- Sentry breadcrumbs scrubbed for PII via `beforeSend`.

## 18. Admin protections

- Strong recommendation: admin login restricted by IP allowlist when feasible. Initial: standard Clerk-protected with mandatory MFA for `ADMIN`.
- Admin actions on user data display warning + require typed confirmation for destructive ops ("Type the user email to confirm deletion").
- Admin sessions: 12-hour absolute timeout (vs 7-day for students).

## 19. Disclosure & incident response

- **security@codify.app** mailbox monitored.
- Public security policy at `/.well-known/security.txt`.
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
