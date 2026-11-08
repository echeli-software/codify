# Release checklist (first production release)

What has to be true before tagging the first `v*` release. Each item has a
check box, an owner role and the place in the repo that says _how_.
Provisioning steps live in [`infra/README.md`](../../infra/README.md); this
list is the gate, not the procedure.

**Status when this was written:** code complete and CI green on `master`
(lint, typecheck, unit tests, Storybook a11y, production builds, API runtime
smoke, image builds). Nothing has been deployed; every external service has
only been exercised against mocks and dev providers.

Owners: **Eng** (engineering), **Ops** (infrastructure), **Legal**,
**Product**, **Content**, **Mobile**.

---

## 1. Accounts and provisioning — Ops

Follow `infra/README.md` §0–5.

- [ ] Accounts exist: DigitalOcean, Cloudflare (`codify.app` zone), Grafana
      Cloud, Sentry, Clerk, Stripe, RevenueCat, Anthropic, Resend, Firebase,
      Apple Developer / App Store Connect, Google Play Console.
- [ ] Terraform state bucket + `terraform apply` (VPC, `vps-app-01`,
      `vps-judge0-01`, `vps-staging-01`, managed Postgres prod + staging,
      Cloudflare DNS/WAF/Pages) — §1–2.
- [ ] Judge0 host up with egress locked down — §3.
- [ ] Judge0 sandbox image built on the Judge0 host from `infra/judge0/image`
      (adds Python and the TypeScript/JavaScript runtimes the exercises use;
      `infra/judge0/README.md` step 5).
- [ ] Coolify on prod and staging with the API, worker and Redis resources — §4.
- [ ] Observability agent shipping logs + metrics — §5.
- [ ] R2 buckets `codify-staging-assets` / `codify-prod-assets` with public
      URLs and CORS — §9.

## 2. Configuration — Ops + Eng

- [ ] GitHub environments: `staging` (default branch) and `production`
      (**required reviewers**, tags `v*`) with every secret and variable in
      `infra/README.md` §6.
- [ ] API environment per environment, from `.env.example`. Production
      refuses to boot unless the required ones are set (see
      `apps/api/src/app/config/env.schema.ts`): Clerk (`CLERK_SECRET_KEY`,
      `CLERK_JWT_KEY`, `CLERK_WEBHOOK_SIGNING_SECRET`,
      `CLERK_AUTHORIZED_PARTIES`), Stripe (`STRIPE_SECRET_KEY`,
      `STRIPE_WEBHOOK_SECRET`), `REVENUECAT_WEBHOOK_AUTH`, Judge0
      (`JUDGE0_URL`, `JUDGE0_AUTH_TOKEN`), `ANTHROPIC_API_KEY`, R2
      (`R2_*`), Resend (`RESEND_API_KEY`, `EMAIL_FROM`,
      `EMAIL_UNSUBSCRIBE_SECRET`), `FIREBASE_SERVICE_ACCOUNT_JSON`,
      `REDIS_URL`, `CORS_ORIGINS`, `STUDENT_APP_URL`, `API_PUBLIC_URL`,
      `SENTRY_DSN`.
- [ ] Production values are unique to production (no key shared with
      staging); `ALLOW_DEV_AUTH` unset and `THROTTLE_ENABLED` on (the boot
      guard enforces both).
- [ ] Frontend build variables: `STAGING_/PROD_API_URL`,
      `STAGING_/PROD_CLERK_PUBLISHABLE_KEY`, Pages project names,
      `SENTRY_DSN_STUDENT` / `SENTRY_DSN_ADMIN`.
- [ ] Clerk: MFA available, and the session token carries the `fva`
      claim. Without it every `ADMIN` / `SUPPORT` request fails closed with
      `MFA_REQUIRED` (docs/14 §1; `STAFF_MFA_ROLES`,
      `STAFF_SESSION_MAX_HOURS`). Set the instance's session maximum
      lifetime too.
- [ ] Web push keys: generate a VAPID key pair once per environment
      (`npx web-push generate-vapid-keys`) and set `VAPID_PUBLIC_KEY`,
      `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` (a `mailto:` or site URL).
- [ ] Stripe win-back coupon (and promotion code) created;
      `STRIPE_WINBACK_COUPON` / `STRIPE_WINBACK_PROMOTION_CODE` set and
      `WINBACK_PERCENT_OFF` equal to the coupon's percentage (the app shows
      that number).

## 3. Staging deploy — Ops

- [ ] Push to `master` → **Staging** workflow green end to end: image →
      `prisma migrate deploy` on `vps-staging-01` → Coolify → smoke
      `/api/health` → Pages (infra/README §7).
- [ ] A PR shows **Preview** URLs for both apps.
- [ ] `https://api.staging.codify.app/api/health` reports database and
      Redis `up`.

## 4. Real integrations on staging (test / sandbox mode) — Eng

Each one has only run against mocks so far. Do one full round trip and
note the result here.

| Service             | Verify                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Clerk**           | Sign up and sign in on both apps; `user.created` webhook creates the user; WELCOME email arrives; admin suspension shows as a ban in Clerk and unsuspend lifts it.                                                                                                                                                                                                                                            |
| **Stripe**          | Admin "Stripe sync" creates products/prices; card checkout **with installments on the annual plans** (docs/09 §Installments; still unverified that Stripe applies them in subscription mode); PIX async success and failure; Boleto; Customer Portal; cancel/resume; `invoice.paid` writes a `Payment` row and sends the email; a refund marks the payment refunded; webhook signature failures are rejected. |
| **RevenueCat**      | Sandbox purchase on iOS and Android → webhook → subscription + `Payment`; restore purchases.                                                                                                                                                                                                                                                                                                                  |
| **Judge0**          | JavaScript, TypeScript and **Python** exercises return correct verdicts; hidden tests stay anonymised until a pass; the sandbox has no outbound network.                                                                                                                                                                                                                                                      |
| **Anthropic**       | AI-graded prompt returns a rubric grade; repeat answers hit the cache; the heuristic fallback is used when the API is unreachable.                                                                                                                                                                                                                                                                            |
| **Resend**          | Sending domain verified (SPF, DKIM, DMARC); WELCOME, billing, weekly recap and reactivation emails render in pt-BR and en-US; unsubscribe link shows the confirm page and the one-click header works.                                                                                                                                                                                                         |
| **Firebase / APNs** | Push reaches a real iOS and Android device; tapping opens the deep link and marks the inbox entry read.                                                                                                                                                                                                                                                                                                       |
| **R2**              | Admin image and sprite uploads land in the bucket and render in both apps (CSP allows the public URL).                                                                                                                                                                                                                                                                                                        |
| **Sentry**          | A test error from the API and from each app shows up with source maps and the release name.                                                                                                                                                                                                                                                                                                                   |

## 5. End-to-end QA on staging — Product + Eng

Run on a phone (390 px) and a desktop, in pt-BR and en-US.

- [ ] Student: onboarding → enroll → reading, quiz, exercise, AI prompt,
      scenario and capstone lessons → rewards, streak, quests → league →
      friends + nudge → shop + avatar → subscription purchase, cancel,
      resume → notifications inbox and settings → offline download and
      replay → data export → delete account and restore.
- [ ] Admin (each role: ADMIN, TEACHER, SUPPORT): course + lesson authoring
      with autosave, translations, plans + Stripe sync, items + sprites,
      gamification config, promotions, users (grant, suspend, inventory,
      ledger), audit + CSV export, dashboard, Cmd/Ctrl-K search, feature
      flags.
- [ ] PWA install and update prompt; certificate claim and public verify
      page.

## 6. Performance and resilience — Eng + Ops

- [ ] Load tests against staging (`tools/load/`):
      `submissions-p95.mjs` (p95 < 4 s, docs/12 §10),
      `ai-grading-p95.mjs` (p95 < 3 s, docs/17),
      `league-sharding.mjs` (1k users → ~30-person cohorts, docs/07).
- [ ] Ledger drift check clean after the load tests
      (`tools/scripts/drift-check.mjs`).
- [ ] Backups enabled and **one restore drill done** before launch
      (infra/README §10, docs/13 §11).
- [ ] Redis restart does not lose queued work (submissions, billing
      webhooks, deferred pushes) and the API recovers.
- [ ] **Rollback procedure defined and rehearsed on staging.** docs/13
      covers backward-compatible migrations (§10) and disaster recovery
      (§14) but has no app rollback step. Proposal: redeploy the previous
      version's image (images are tagged per version and sha) through
      Coolify; the §10 expand/contract rule keeps the previous image working
      against the new schema.

## 7. Security — Eng + Ops

- [ ] Cloudflare WAF, bot protection and the webhook rate limits active
      (infra/README §2, §9).
- [ ] `pnpm audit --prod` reviewed; no known critical vulnerabilities in
      runtime dependencies.
- [ ] Admin accounts: only the people who need them, each with the right
      role; Clerk MFA enforced for `ADMIN` and `SUPPORT` (docs/14).
- [ ] Secrets stored only in GitHub environments / Coolify, never in the
      repo; rotation owner named.

## 8. Legal and compliance — Legal + Product

The Privacy Policy (`/privacy`) and Terms of Use (`/terms`) exist as
**drafts** (`libs/i18n/src/strings/*/student.json` → `student.legal`), linked
from the public footer, the sign-in screen and Settings.

- [ ] Legal review of both texts in pt-BR and en-US; fill every `[…]`
      placeholder (legal name, CNPJ, address, DPO e-mail, minimum age, venue,
      log retention, transfer mechanisms).
- [ ] Remove the draft banner: delete the `legal-draft-notice` paragraph in
      `apps/student/src/app/pages/legal.page.ts` and `student.legal.draftNotice`
      from both string files; set `student.legal.updated` to the real date.
- [ ] DPO named and contact published (LGPD art. 41).
- [ ] Data processing agreements in place with every processor the policy
      lists (Clerk, Stripe, RevenueCat, Anthropic, Resend, Firebase,
      DigitalOcean, Cloudflare, Sentry).
- [ ] Minimum age is **12** (decided 2026-11). Legal confirms the duties for
      12–17 users (LGPD art. 14 best interest and the newer Brazilian rules
      for online services used by minors) and the minor defaults in docs/15
      Phase 14, including the guardian confirmation before a minor's paid
      plan.
- [ ] The privacy policy also covers the date of birth, the IP-derived
      country, web push and promotional email (all added in Phase 14).
- [ ] App Store privacy labels and Google Play data-safety form match the
      policy.

## 9. Content, pricing and configuration — Content + Product

- [ ] Launch courses authored, translated and published; demo/seed and QA
      data removed from production.
- [ ] Plans and prices final in the admin and synced to Stripe; store
      product ids set for iOS/Android.
- [ ] Gamification defaults, quest templates, badges and shop catalog
      reviewed.
- [ ] Feature flags set for launch (`leagues.enabled`, `friends.enabled`,
      `shop.enabled`, any experiments).
- [ ] Open product decisions settled or explicitly deferred: PROMO
      notifications, web push, user country field.

## 10. Mobile — Mobile

Follow `infra/README.md` §8 and `docs/17-mobile.md`.

- [ ] `GoogleService-Info.plist` / `google-services.json` and the APNs key
      configured; never committed.
- [ ] iOS project builds on macOS (`pod install`), Android release build
      signed.
- [ ] Internal testing / TestFlight builds pass the §5 journeys on devices.
- [ ] Store listings, screenshots and review submissions.

## 11. Monitoring and on-call — Ops

- [ ] Uptime probes: API health, admin login page, student PWA load
      (docs/13 §12).
- [ ] Alerts routed to a person (error rate, 5xx, queue backlog, Judge0
      down, payment webhook failures, ledger drift).
- [ ] Named on-call for launch week and an incident contact list.

## 12. Release day — Eng + Ops

1. Confirm sections 1–11 are checked (or explicitly waived with a name and
   reason).
2. `git tag vX.Y.Z && git push origin vX.Y.Z`.
3. Approve the `production` environment in the **Release** workflow; watch
   migrate → image promotion → Coolify deploy → smoke → Pages.
4. Smoke by hand: sign up, complete a free lesson, buy the cheapest plan
   with a real card and refund it, receive a push.
5. Watch Sentry, logs and uptime for the first hours; keep the rollback
   procedure (section 6) ready.
