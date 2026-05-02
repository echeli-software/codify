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
│   ├── api-client/                Generated from OpenAPI
│   ├── auth/                      Clerk wrappers + guards
│   ├── i18n/                      ngx-translate setup + shared keys
│   ├── billing/                   BillingProvider abstraction + Stripe impl
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
| Component | Choice | Notes |
|---|---|---|
| Framework | Angular 18+ standalone components | Signals-first |
| Mobile shell | Ionic 8 + Capacitor 6 | iOS, Android, PWA |
| Admin UI | ng-bootstrap 17+ + Bootstrap 5.3 | SCSS theme via tokens |
| Student UI | Ionic components | CSS vars themed via tokens |
| Block editor | Tiptap 2 | Headless, custom node views |
| Code editor | Monaco | Used inside ExerciseRunner |
| Animations | Angular Animations + GSAP 3 + Lottie | RewardOrchestrator coordinates |
| Forms | Angular Reactive Forms + zod | One schema, two consumers (FE + API DTO) |
| State | Angular Signals + ngrx-signals | Avoid full NgRx unless we need it |
| HTTP | HttpClient + generated `api-client` | Interceptors for auth + i18n + retries |
| i18n | ngx-translate | Per-route lazy chunks |
| Avatar render | SVG composite component | Custom, framework-agnostic |

### Backend
| Component | Choice | Notes |
|---|---|---|
| Framework | NestJS 10 | Modular monolith |
| ORM | Prisma 5+ | With `prisma-erd` for diagrams |
| DB | PostgreSQL 16 | DO Managed |
| Cache / queue | Redis 7 | BullMQ for jobs |
| Jobs | BullMQ | Webhooks, notifications, leaderboard rollups |
| Auth | Clerk | JWT verification middleware |
| Payments | Stripe | Brazilian methods enabled |
| Code exec | Judge0 (self-hosted) | Separate VPS, network-isolated |
| Search | Postgres full-text first; Meilisearch later | Don't add complexity early |
| Object storage | Cloudflare R2 | S3-compatible |
| Email | Postmark or Resend | Transactional |
| Push | Capacitor Push + FCM/APNs | Server-sent via FCM HTTP v1 |
| Observability | OpenTelemetry → Grafana Cloud (free tier) | Logs + traces + metrics |
| Errors | Sentry | Both apps + API |

### DevOps
| Component | Choice |
|---|---|
| Monorepo | Nx 19+ |
| Package manager | pnpm |
| CI | GitHub Actions |
| CD | Coolify (auto-deploy on `main`) |
| IaC | docker-compose for local; Coolify YAML for prod |
| Secrets | Doppler or 1Password CLI in CI; Coolify env vars in prod |

## 4. Environments

| Env | URL pattern | DB | Purpose |
|---|---|---|---|
| `local` | localhost ports | Docker Postgres | Devs |
| `preview` | `pr-<n>.codify.dev` | Ephemeral schema in shared dev DB | Per-PR previews of admin + student |
| `staging` | `staging.codify.app`, `admin.staging.codify.app`, `api.staging.codify.app` | DO managed (small) | QA, stakeholder review |
| `prod` | `codify.app`, `admin.codify.app`, `api.codify.app` | DO managed (HA) | Live |

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
- REST + OpenAPI spec emitted at build time → consumed by `libs/api-client` codegen
- Webhook endpoints: Stripe, Clerk
- Background workers as separate Nest processes consuming BullMQ queues

## 6. Data flow patterns

### Auth (every request)
1. Client gets Clerk session JWT.
2. Sends `Authorization: Bearer <jwt>` to API.
3. NestJS `AuthGuard` verifies JWT signature + claims via Clerk JWKS.
4. Loads `User` row (cached in Redis 60s) and attaches to request.

### Reward (canonical example: lesson complete)
1. Student client posts `POST /lessons/:id/complete` with idempotency key.
2. API verifies access (subscription/free/enrollment).
3. `GamificationService.grantReward({ source, userId })` resolves multipliers (premium × course-promo × streak-bonus), writes `XpEvent` + `CoinTransaction` in one transaction, evaluates badge triggers (queued).
4. API returns `{ xpAwarded, coinsAwarded, levelUp?, badgesUnlocked? }`.
5. Client `RewardOrchestrator` plays the sequence (animation + haptic + sound) and updates local UI optimistically against the returned canonical totals.

### Translations
- Chrome strings: ngx-translate JSON, served from CDN.
- Content strings: `ContentTranslation` table, fetched alongside the entity (`?locale=pt-BR&fallback=en-US`), embedded in the same response payload.

## 7. API conventions

- Base path: `/api/v1`. Versioning by URL prefix; major bumps only on breaking changes.
- All responses JSON, snake_case forbidden — camelCase throughout.
- Errors: RFC 7807 problem+json shape: `{ type, title, status, detail, errors? }`.
- Pagination: cursor-based (`?cursor=<opaque>&limit=20`). Never offset.
- Idempotency: clients send `Idempotency-Key` header on any mutating call that affects gamification or billing. API stores keys for 24h in Redis.
- Rate limits: per-user + per-IP via Redis token bucket. Limits documented per endpoint.

## 8. Trust boundaries

- **Client → API**: never trusted. All access checks, multipliers, and ledger writes happen server-side.
- **API → Judge0**: signed payload + per-request resource limits.
- **Webhooks → API**: signature verification (Stripe-Signature, Clerk-Signature) before any side effect.
- **Admin app → API**: role checked on every request; admin-only endpoints behind a separate guard.

## 9. Performance budgets

| Metric | Target |
|---|---|
| Student app first contentful paint (4G mobile) | < 2s |
| Time to interactive on lesson page | < 3s |
| API p95 read latency (SP region) | < 150ms |
| API p95 write latency | < 300ms |
| Reward animation start delay after API response | < 50ms |
| Bundle: student initial route | < 250KB gzipped |
| Bundle: admin initial route | < 400KB gzipped (acceptable, internal users) |

## 10. Background jobs (BullMQ)

Single inventory of all queues. Workers are separate Nest processes consuming from Redis.

| Queue | Schedule / trigger | Owner module | On failure |
|---|---|---|---|
| `submission.run` | On submit | `exercises` | Retry x3, then mark `WORKER_LOST`; reconciliation job recovers |
| `badge.evaluate` | Post-event (lesson/exercise/quest) | `gamification` | Retry x5; alert on >5 dead-letters/hr |
| `quest.assign-daily` | Cron 00:00 user-local (sharded) | `gamification` | Retry x3; alert on miss |
| `streak.reminder` | Cron per user reminder slot | `notifications` | Retry x2; drop on persistent fail |
| `notification.send-push` | On scheduled time | `notifications` | Retry x3 with backoff |
| `notification.send-email` | On scheduled time | `notifications` | Retry x5 with backoff |
| `league.rollover` | Cron Mon 00:05 UTC | `gamification` | Idempotent via `LeagueMembership.rewardedAt`; retry x3 |
| `stripe.webhook` | On webhook | `billing` | Retry x5; dead-letter logged |
| `pix.renewal-reminder` | 7 days before subscription renewal | `billing` | Retry x3 |
| `reactivation.day-7/14/30` | Daily scan | `engagement` | Skip if user reactivated |
| `coin-ledger.drift-check` | Cron nightly | `gamification` | Alert on mismatch |
| `download.eviction-report` | Cron weekly | `analytics` | – |
| `r2.orphan-asset-sweep` | Cron weekly | `assets` | – |

Failure handling: Redis-backed `bull-board` UI accessible to admins; PagerDuty alert on dead-letter queue depth > N.

## 11. Observability

- **Tracing**: every request gets a trace ID; client sends `X-Request-Id` if known.
- **Logs**: structured JSON, single log per request with duration + status + user role.
- **Metrics**: per-endpoint latency histograms; gamification events as counters; subscription conversion as gauge.
- **Dashboards**: API health, gamification ledger drift, Stripe webhook lag, reward latency, league rollup duration.
- **Alerts**: error budget burn, webhook backlog, DB CPU, Judge0 queue depth.

See [13-deployment.md](./13-deployment.md) for the actual stack (Grafana Cloud free tier + Sentry).
