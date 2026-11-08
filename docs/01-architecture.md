# 01 — Architecture

## 1. System topology

```
                        ┌────────────────────────────┐
                        │         Cloudflare         │
                        │  CDN · DNS · WAF · TLS · R2│
                        └──────────┬─────────────────┘
                                   │
        ┌──────────────────────────┼──────────────────────────┐
        │                          │                          │
        ▼                          ▼                          ▼
 ┌────────────┐            ┌────────────┐            ┌──────────────┐
 │ Admin SPA  │            │ Student PWA│            │ Capacitor    │
 │ (Bootstrap)│            │  (Ionic)   │            │ iOS / Android│
 │ CF Pages   │            │ CF Pages   │            │ App stores   │
 └─────┬──────┘            └─────┬──────┘            └──────┬───────┘
       │                         │                          │
       │   HTTPS / Clerk session JWT                        │
       └─────────────┬───────────┴──────────────────────────┘
                     │
                     ▼
          ┌────────────────────────┐
          │  api.codify.app        │
          │  NestJS · Coolify VPS  │
          │  (DO São Paulo)        │
          └──┬─────┬─────┬──────┬──┘
             │     │     │      │
             ▼     ▼     ▼      ▼
        ┌────────┐┌─────┐┌──────┐┌──────────────┐
        │Postgres││Redis││Judge0││ Stripe / Clerk│
        │ (DO MD)││ VPS ││ VPS  ││   webhooks    │
        └────────┘└─────┘└──────┘└──────────────┘
```

- All client traffic flows through Cloudflare (WAF, DDoS, caching).
- API is a single NestJS service; modular monolith, not microservices.
- Postgres is **DO Managed Database** (backups + PITR included).
- Redis is self-hosted via Coolify (sessions are not in Redis — Clerk handles them).
- Judge0 sits on its own VPS — code execution is the only thing on that machine.
- Static frontends ship to Cloudflare Pages from CI.

## 2. Monorepo layout (Nx)

```
codify/
├── apps/
│   ├── admin/                     Angular 18 SPA · ng-bootstrap
│   ├── student/                   Ionic 8 + Angular 18 + Capacitor 6
│   └── api/                       NestJS 10
├── libs/
│   ├── ui-tokens/                 SCSS tokens (no TS)
│   ├── ui-core/                   Framework-agnostic TS utils
│   ├── ui-bootstrap/              Admin component library
│   ├── ui-ionic/                  Student component library
│   ├── gamification-engine/       Reward orchestrator + services
│   ├── lesson-schema/             Tiptap schema + types + renderer contract
│   ├── api-client/                Hand-written typed clients + interceptors
│   ├── auth/                      Clerk wrappers + guards
│   ├── i18n/                      ngx-translate setup + shared keys
│   ├── billing/                   Price / installment formatting (provider in apps/api)
│   └── domain/                    Pure business logic (access, plan resolution, level math)
├── tools/
│   ├── nx-generators/             Custom code generators (component, lib)
│   └── scripts/                   One-off scripts (asset processing, content seeding)
├── prisma/
│   ├── schema.prisma
│   ├── migrations/
│   └── seed.ts
├── docs/                          This directory
├── .env.example
├── nx.json
├── package.json
├── tsconfig.base.json
└── docker-compose.dev.yml         Local Postgres + Redis + Judge0
```

## 3. Tech stack (versions are minimums)

### Frontend

| Component     | Choice                                 | Notes                                                |
| ------------- | -------------------------------------- | ---------------------------------------------------- |
| Framework     | Angular 18+ standalone components      | Signals-first                                        |
| Mobile shell  | Ionic 8 + Capacitor 6                  | iOS, Android, PWA                                    |
| Admin UI      | ng-bootstrap 17+ + Bootstrap 5.3       | SCSS theme via tokens                                |
| Student UI    | Ionic components                       | CSS vars themed via tokens                           |
| Block editor  | Tiptap 2                               | Headless, custom node views                          |
| Code editor   | Monaco                                 | Used inside ExerciseRunner                           |
| Animations    | Angular Animations + GSAP 3 + Lottie   | RewardOrchestrator coordinates                       |
| Forms         | Angular forms (mostly template-driven) | As built: no shared zod form adapter; see docs/04 §5 |
| State         | Angular Signals + ngrx-signals         | Avoid full NgRx unless we need it                    |
| HTTP          | HttpClient + hand-written `api-client` | Interceptors for auth + i18n + retries               |
| i18n          | ngx-translate                          | Per-route lazy chunks                                |
| Avatar render | SVG composite component                | Custom, framework-agnostic                           |

### Backend

| Component      | Choice                                                | Notes                                                                                  |
| -------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Framework      | NestJS 10                                             | Modular monolith                                                                       |
| ORM            | Prisma 5+                                             | With `prisma-erd` for diagrams                                                         |
| DB             | PostgreSQL 16                                         | DO Managed                                                                             |
| Cache / queue  | Redis 7                                               | BullMQ for jobs                                                                        |
| Jobs           | `@nestjs/schedule` crons + BullMQ                     | Crons in-process; BullMQ for code submissions, billing webhooks, deferred pushes (§10) |
| Auth           | Clerk                                                 | JWT verification middleware                                                            |
| Payments       | Stripe                                                | Brazilian methods enabled                                                              |
| Code exec      | Judge0 (self-hosted)                                  | Separate VPS, network-isolated                                                         |
| Search         | Postgres full-text first; Meilisearch later           | Don't add complexity early                                                             |
| Object storage | Cloudflare R2                                         | S3-compatible                                                                          |
| Email          | Postmark or Resend                                    | Transactional                                                                          |
| Push           | Capacitor Push + FCM/APNs                             | Server-sent via FCM HTTP v1                                                            |
| Observability  | Pino logs + Alloy metrics → Grafana Cloud (free tier) | As built: no OpenTelemetry yet (§11)                                                   |
| Errors         | Sentry                                                | Both apps + API                                                                        |

### DevOps

| Component       | Choice                                                   |
| --------------- | -------------------------------------------------------- |
| Monorepo        | Nx 19+                                                   |
| Package manager | pnpm                                                     |
| CI              | GitHub Actions                                           |
| CD              | Coolify (auto-deploy on `main`)                          |
| IaC             | docker-compose for local; Coolify YAML for prod          |
| Secrets         | Doppler or 1Password CLI in CI; Coolify env vars in prod |

## 4. Environments

| Env       | URL pattern                                                                | DB                                | Purpose                            |
| --------- | -------------------------------------------------------------------------- | --------------------------------- | ---------------------------------- |
| `local`   | localhost ports                                                            | Docker Postgres                   | Devs                               |
| `preview` | `pr-<n>.codify.dev`                                                        | Ephemeral schema in shared dev DB | Per-PR previews of admin + student |
| `staging` | `staging.codify.app`, `admin.staging.codify.app`, `api.staging.codify.app` | DO managed (small)                | QA, stakeholder review             |
| `prod`    | `codify.app`, `admin.codify.app`, `api.codify.app`                         | DO managed (HA)                   | Live                               |

Promotion: `main` auto-deploys to staging. Tagged release (`v*`) deploys to prod. No direct prod commits.

## 5. Service / app responsibilities

### `apps/admin`

- Course / lesson authoring (Tiptap)
- Category, plan, item shop management
- User admin (suspend, refund, manual coin/XP grant with audit)
- Translation workspace
- Analytics dashboards
- **Roles**: `admin`, `teacher`, `support`. No student access here.

### `apps/student`

- Onboarding, learning loop, gamification UI, social features, billing UI
- Capacitor wrappers for haptics, push, IAP (later), in-app browser
- Offline-first lesson reading (service worker + IndexedDB cache)
- **Role**: `student` only.

### `apps/api`

- Single NestJS app, modular by domain (`auth`, `courses`, `lessons`, `progress`, `gamification`, `billing`, `shop`, `social`, `admin`)
- REST, no OpenAPI spec: `libs/api-client` is hand-written (one `*.client.ts` per area, types next to their client)
- Webhook endpoints: Stripe, Clerk
- Background work in the same Nest app: `@Cron` jobs and BullMQ consumers (§10); production runs the image twice, `api` (`JOBS_ENABLED=false`) and `worker` (`JOBS_ENABLED=true`)

## 6. Data flow patterns

### Auth (every request)

1. Client gets Clerk session JWT.
2. Sends `Authorization: Bearer <jwt>` to API.
3. NestJS `AuthGuard` verifies JWT signature + claims via Clerk JWKS.
4. Loads `User` row (cached in Redis 60s) and attaches to request.

### Reward (canonical example: lesson complete)

1. Student client posts `POST /lessons/:id/complete` (as built: no `Idempotency-Key`; the `Progress (userId, lessonId)` unique constraint makes it idempotent, a replay answers `409 LESSON_ALREADY_COMPLETED`).
2. API verifies access (subscription/free/enrollment).
3. `GamificationService.grantReward({ source, userId })` resolves multipliers (premium × course-promo × streak-bonus), writes `XpEvent` + `CoinTransaction` in one transaction, evaluates badge triggers (queued).
4. API returns `{ xpAwarded, coinsAwarded, levelUp?, badgesUnlocked? }`.
5. Client `RewardOrchestrator` plays the sequence (animation + haptic + sound) and updates local UI optimistically against the returned canonical totals.

### Translations

- Chrome strings: ngx-translate JSON, served from CDN.
- Content strings: `ContentTranslation` table, fetched alongside the entity (`?locale=pt-BR&fallback=en-US`), embedded in the same response payload.

## 7. API conventions

- Base path: `/api` (as built: `app.setGlobalPrefix('api')` in `apps/api/src/main.ts`, no version segment; only `/.well-known/security.txt` sits outside it).
- All responses JSON, snake_case forbidden — camelCase throughout.
- Errors: RFC 7807 problem+json shape: `{ type, title, status, detail, errors? }`.
- Pagination: cursor-based (`?cursor=<opaque>&limit=20`) for feeds and logs. As built: the admin audit log (`GET /admin/audit`, keyset cursor over `(createdAt, id)`, docs/04), user ledger (`GET /admin/users/:id/ledger`), inbox (`GET /me/notifications`) and media library (`GET /admin/assets`) use cursors; bounded admin/catalog lists use offset `?skip&take` with `{ items, total }`: `GET /courses`, `GET /categories`, `GET /users`, `GET /courses/:id/enrollments`, `GET /billing/payments`, `GET /billing/admin/users/:userId/payments`.
- Idempotency: clients send `Idempotency-Key` header on any mutating call that affects gamification or billing. API stores keys for 24h in Redis.
  - As built: no Redis key store. Rewards are idempotent through Postgres unique constraints: `Progress (userId, lessonId)` for lesson completion and the ledger's unique `idempotencyKey` on `XpEvent` / `CoinTransaction`. `Idempotency-Key` is read on exercise / quiz / scenario submissions and stored in Postgres (`Submission.idempotencyKey`, `IdempotencyRecord`), see docs/14 §8.
- Rate limits: per-user + per-IP via Redis token bucket. Limits documented per endpoint.

## 8. Trust boundaries

- **Client → API**: never trusted. All access checks, multipliers, and ledger writes happen server-side.
- **API → Judge0**: signed payload + per-request resource limits.
- **Webhooks → API**: signature verification (Stripe-Signature, Clerk-Signature) before any side effect.
- **Admin app → API**: role checked on every request; admin-only endpoints behind a separate guard.

## 9. Performance budgets

| Metric                                          | Target                                       |
| ----------------------------------------------- | -------------------------------------------- |
| Student app first contentful paint (4G mobile)  | < 2s                                         |
| Time to interactive on lesson page              | < 3s                                         |
| API p95 read latency (SP region)                | < 150ms                                      |
| API p95 write latency                           | < 300ms                                      |
| Reward animation start delay after API response | < 50ms                                       |
| Bundle: student initial route                   | < 250KB gzipped                              |
| Bundle: admin initial route                     | < 400KB gzipped (acceptable, internal users) |

Enforced for the student app by the Angular `initial` budget in
`apps/student/project.json` (warning 600 kB, **error 1 MB raw**). Angular
budgets measure minified bytes, not gzip; the measured ratio of the initial
chunks is ≈ 4 : 1 (447 kB raw ≈ 113 kB transfer, Nov 2026), so 1 MB raw is the
250 kB-gzipped line and `nx build` (CI) fails above it. Heavy features stay in
lazy chunks (Monaco: `monaco-setup` + `editor-worker`, Clerk, Ionic).

## 10. Background jobs (BullMQ)

Single inventory of all queues. Workers are separate Nest processes consuming from Redis.

**As built.** Scheduled work runs in-process as `@nestjs/schedule` `@Cron` jobs (UTC; league rollover, quest pre-assignment, streak settle / reminders, weekly bonus, referral rewards, drop and promo announcements, engagement sweeps, billing sweeper / PIX reminders, ledger drift check, asset sweep, account purge), each idempotent and switched off with `JOBS_ENABLED=false`. BullMQ (`@nestjs/bullmq`, one root connection in `QueueModule`) is used for three queues only: `code-submissions` (Judge0 runs), `billing-webhooks` (Stripe / RevenueCat events) and `push-deferred` (pushes held for quiet hours). Their consumers start only where `JOBS_ENABLED` is on (`autorun: jobsEnabled()`), i.e. the `worker` container; HTTP-only `api` replicas just enqueue. Badge evaluation runs inside the reward transaction, not on a queue. There is no `bull-board`: queue job failures are logged, cron failures are logged and reported to Sentry. The table below is the original plan.

| Queue                      | Schedule / trigger                                                                                                                    | Owner module    | On failure                                                                   |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | --------------- | ---------------------------------------------------------------------------- |
| `submission.run`           | On submit                                                                                                                             | `exercises`     | Retry x3, then mark `WORKER_LOST`; reconciliation job recovers               |
| `badge.evaluate`           | Post-event (lesson/exercise/quest)                                                                                                    | `gamification`  | Retry x5; alert on >5 dead-letters/hr                                        |
| `quest.assign-daily`       | Cron 00:00 user-local (sharded)                                                                                                       | `gamification`  | Retry x3; alert on miss                                                      |
| `streak.reminder`          | Cron per user reminder slot (as built: hourly, users whose local time is 20:00–22:00, docs/10 §3)                                     | `notifications` | Retry x2; drop on persistent fail                                            |
| `notification.send-push`   | On scheduled time                                                                                                                     | `notifications` | Retry x3 with backoff                                                        |
| `notification.send-email`  | On scheduled time                                                                                                                     | `notifications` | Retry x5 with backoff                                                        |
| `league.rollover`          | Cron Mon 00:05 UTC                                                                                                                    | `gamification`  | Idempotent via `LeagueMembership.rewardedAt`; retry x3                       |
| `stripe.webhook`           | On webhook                                                                                                                            | `billing`       | Retry x5; dead-letter logged                                                 |
| `pix.renewal-reminder`     | Daily; once per PIX/Boleto annual prepay in the 7 days before it ends                                                                 | `billing`       | Retry x3                                                                     |
| `reactivation.day-7/14/30` | Daily scan                                                                                                                            | `engagement`    | Skip if user reactivated                                                     |
| `coin-ledger.drift-check`  | Cron nightly                                                                                                                          | `gamification`  | Alert on mismatch                                                            |
| `download.eviction-report` | Cron weekly                                                                                                                           | `analytics`     | –                                                                            |
| `r2.orphan-asset-sweep`    | Cron daily 04:41 UTC (`@Cron`, `JOBS_ENABLED`) — as built: `AssetSweepService`; manual `POST /api/admin/assets/sweep?dryRun=` (ADMIN) | `assets`        | Storage delete failure keeps the row for the next run; audited `asset.swept` |

Failure handling (planned, not built): Redis-backed `bull-board` UI accessible to admins; PagerDuty alert on dead-letter queue depth > N.

Orphan-asset sweep (as built, `apps/api/src/app/assets/asset-sweep.service.ts`): deletes (storage object, then row) **abandoned uploads** — `confirmed = false` older than `ASSET_SWEEP_UNCONFIRMED_HOURS` (24) — and **unreferenced assets** — confirmed, older than `ASSET_SWEEP_UNREFERENCED_DAYS` (30), whose id appears nowhere. "Referenced" is deliberately broad: `Course.coverAssetId`, `Badge.iconAssetId`, `Item.spriteAssetId` / `thumbnailAssetId` (soft-deleted / inactive rows included), and the id anywhere in the text of `Lesson.contentJson` (soft-deleted lessons too; asset URLs and keys embed the id), every `ContentTranslation.value`, `Scenario.graphJson`, AI-prompt texts and `GamificationConfig.value`. `ASSET_SWEEP_DRY_RUN` (default true outside production) only logs; at most `ASSET_SWEEP_MAX_DELETES` (500) per run.

## 11. Observability

As built: no OpenTelemetry yet. The API logs structured JSON with pino (`nestjs-pino`), one line per request carrying the request id (inbound `X-Request-Id` if safe, else a UUID, echoed back and put in problem+json bodies) and the user id; errors go to Sentry (API + both apps). Traces and per-endpoint metrics wait for an OpenTelemetry backend, which needs a Grafana Cloud account (docs/runbooks/release-checklist.md §1).

- **Tracing**: every request gets a trace ID; client sends `X-Request-Id` if known.
- **Logs**: structured JSON, single log per request with duration + status + user role.
- **Metrics**: per-endpoint latency histograms; gamification events as counters; subscription conversion as gauge.
- **Dashboards**: API health, gamification ledger drift, Stripe webhook lag, reward latency, league rollup duration.
- **Alerts**: error budget burn, webhook backlog, DB CPU, Judge0 queue depth.

See [13-deployment.md](./13-deployment.md) for the actual stack (Grafana Cloud free tier + Sentry).
