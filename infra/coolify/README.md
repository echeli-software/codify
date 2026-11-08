# Coolify — API, worker, Redis

Coolify runs on `vps-app-01` (prod) and `vps-staging-01` (staging), each
managing one **Docker Compose** resource built from
[`docker-compose.yml`](./docker-compose.yml):

| Service  | Image / command                                     | Exposed                                    | Notes                                                     |
| -------- | --------------------------------------------------- | ------------------------------------------ | --------------------------------------------------------- |
| `api`    | `ghcr.io/<owner>/codify-api:<env>` → `node main.js` | `api.codify.app` → :3000 via Coolify proxy | `JOBS_ENABLED=false`: HTTP only                           |
| `worker` | same image → `node main.js`                         | not exposed                                | `JOBS_ENABLED=true`: BullMQ consumers + `@Cron` jobs      |
| `redis`  | `redis:7.4-alpine`, AOF on, `noeviction`            | internal                                   | BullMQ needs `noeviction`; password from `REDIS_PASSWORD` |

The image tag is **mutable per environment** (`:staging`, `:production`).
`staging.yml` / `release.yml` push it, run migrations on the droplet, move the
tag, then call the Coolify deploy webhook — Coolify pulls and restarts.
Immutable tags (`:sha-<commit>`, `:X.Y.Z`) stay in GHCR for rollbacks.

> `JOBS_ENABLED` is the API's switch for queue consumers / schedulers: the
> `api` container runs with `false` (HTTP only), the `worker` with `true`.
> Keep the worker's replica count at 1.

## One-time setup (per environment)

1. **Install Coolify** on the droplet (as root):
   `curl -fsSL https://cdn.coollabs.io/coolify/install.sh | bash`, then open
   `http://<droplet-ip>:8000` from an `admin_ssh_cidrs` address and create the
   admin account. Enable 2FA.
2. **Origin TLS:** Cloudflare → SSL/TLS → Origin Server → create a 15-year
   Origin Certificate for `api.codify.app` (or `*.codify.app`, `*.staging.codify.app`).
   In Coolify → Servers → Proxy → add it as a custom certificate. SSL mode is
   `Full (strict)` (Terraform), so the proxy must present this cert.
3. **Registry:** Coolify → Servers → (server) → _Docker Registries_ (or
   `docker login ghcr.io` as root and as `deploy`) with a GitHub PAT that has
   `read:packages`. The `deploy` login is used by the workflows' migration step.
4. **Resource:** Project `codify` → Environment `production` / `staging` →
   _+ New → Docker Compose Empty_ → paste `docker-compose.yml`.
   - Domain for `api`: `https://api.codify.app:3000` (staging: `https://api.staging.codify.app:3000`).
   - Environment variables: the table below (mark secrets as _secret_/locked).
   - **Pre-deployment command** (service `api`): `prisma migrate deploy`.
     The workflows already migrate before calling the webhook, so this is a
     no-op in CI-driven deploys; it covers manual "Redeploy" clicks.
   - Health check: the compose healthcheck (`/api/health` must report `ok`).
5. **Deploy webhook:** resource → _Webhooks_ → copy the _Deploy Webhook_ URL
   (`…/api/v1/deploy?uuid=<uuid>&force=false`). Store it as
   `STAGING_COOLIFY_WEBHOOK_URL` / `PROD_COOLIFY_WEBHOOK_URL`. Create an API
   token (Keys & Tokens → API tokens, scope _deploy_) → `COOLIFY_TOKEN`.
6. **Observability agent** (outside Coolify): `infra/observability/README.md`.

## Runtime environment variables

Set on the Coolify resource (shared by `api` and `worker`). **Prod rule
(docs/14, worker brief §4): every integration throws at boot in
`NODE_ENV=production` when its variables are missing**, so a missing value
fails the deploy's healthcheck instead of silently degrading. The authority
for names is the code — `apps/api/src/app/config/env.schema.ts` plus each
integration's factory — and `apps/api/src/app/config/env-docs.spec.ts`
fails CI when this table, docs/13 §16 or `.env.example` drift from it.

**Required in production** (boot fails without them — except `JUDGE0_AUTH_TOKEN`, which the Judge0 host enforces instead):

| Variable                                                      | Secret | Example / source                                                                                                                                                                          | Used by                                   |
| ------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| `NODE_ENV`                                                    |        | `production` (compose sets it)                                                                                                                                                            | everything                                |
| `DATABASE_URL`                                                | ✔      | `terraform output -raw database_url_prod` (private host, `sslmode=require`)                                                                                                               | Prisma                                    |
| `REDIS_PASSWORD`                                              | ✔      | `openssl rand -hex 32`; compose builds `REDIS_URL` from it                                                                                                                                | Redis, BullMQ, rate limits                |
| `CORS_ORIGINS`                                                |        | `https://codify.app,https://app.codify.app,https://admin.codify.app` (staging adds `https://*.codify-student-staging.pages.dev,https://*.codify-admin-staging.pages.dev` for PR previews) | CORS allowlist (docs/14 §5)               |
| `CLERK_SECRET_KEY`                                            | ✔      | Clerk dashboard (prod instance)                                                                                                                                                           | auth (JWT verification, user lookup, ban) |
| `CLERK_AUTHORIZED_PARTIES`                                    |        | same origins as the apps: `https://codify.app,https://app.codify.app,https://admin.codify.app`                                                                                            | `azp` claim check                         |
| `CLERK_WEBHOOK_SIGNING_SECRET`                                | ✔      | Clerk → Webhooks → endpoint `https://api.codify.app/api/webhooks/clerk` → signing secret (Svix)                                                                                           | `/api/webhooks/clerk`                     |
| `FIREBASE_SERVICE_ACCOUNT_JSON`                               | ✔      | Firebase service-account JSON, **base64-encoded** (`base64 -w0 sa.json`)                                                                                                                  | push (FCM)                                |
| `STRIPE_SECRET_KEY`                                           | ✔      | Stripe restricted key                                                                                                                                                                     | billing                                   |
| `STRIPE_WEBHOOK_SECRET`                                       | ✔      | Stripe → Webhooks → endpoint `https://api.codify.app/api/webhooks/stripe`                                                                                                                 | billing                                   |
| `REVENUECAT_WEBHOOK_AUTH`                                     | ✔      | value configured as the RevenueCat webhook Authorization header                                                                                                                           | `/api/webhooks/revenuecat`                |
| `R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | ✔      | Cloudflare R2 API token (object read/write on the bucket)                                                                                                                                 | uploads                                   |
| `R2_BUCKET_NAME`                                              |        | `codify-prod-assets` / `codify-staging-assets`                                                                                                                                            | uploads                                   |
| `R2_PUBLIC_URL`                                               |        | `https://cdn.codify.app`                                                                                                                                                                  | asset URLs                                |
| `JUDGE0_URL`                                                  |        | `terraform output -raw judge0_private_url`                                                                                                                                                | code execution                            |
| `JUDGE0_AUTH_TOKEN`                                           | ✔      | `JUDGE0_AUTHN_TOKEN` from infra/judge0 (the Judge0 host refuses requests without it)                                                                                                      | code execution                            |
| `ANTHROPIC_API_KEY`                                           | ✔      | Anthropic console                                                                                                                                                                         | AI grading                                |
| `RESEND_API_KEY`                                              | ✔      | Resend → API keys (sending access, `codify.app` domain verified)                                                                                                                          | transactional email                       |
| `EMAIL_FROM`                                                  |        | `Codify <hello@codify.app>`                                                                                                                                                               | transactional email                       |
| `EMAIL_UNSUBSCRIBE_SECRET`                                    | ✔      | `openssl rand -hex 32` (rotating it breaks links in sent emails)                                                                                                                          | signed unsubscribe links                  |

**Recommended / optional:**

| Variable                                                                                  | Secret | Example / default                                                       | Used by                                           |
| ----------------------------------------------------------------------------------------- | ------ | ----------------------------------------------------------------------- | ------------------------------------------------- |
| `PORT`                                                                                    |        | `3000` api / `3001` worker (compose sets it; `API_PORT` also honoured)  | HTTP listener                                     |
| `JOBS_ENABLED`                                                                            |        | compose sets `false` (api) / `true` (worker)                            | queue consumers + crons                           |
| `STUDENT_APP_URL`                                                                         |        | `https://codify.app`                                                    | links in emails, checkout returns, referral links |
| `API_PUBLIC_URL`                                                                          |        | `https://api.codify.app/api`                                            | email unsubscribe links, receipts, security.txt   |
| `CLERK_JWT_KEY`                                                                           | ✔      | Clerk → API keys → JWT public key (networkless verification)            | auth                                              |
| `CLERK_PUBLISHABLE_KEY`                                                                   |        | Clerk dashboard                                                         | auth                                              |
| `TRUST_PROXY` / `TRUST_CLOUDFLARE` / `CLOUDFLARE_IP_RANGES`                               |        | defaults: private networks / `true` / built-in list (docs/14 §7)        | client IP for rate limits + audit                 |
| `STAFF_MFA_ROLES` / `STAFF_SESSION_MAX_HOURS`                                             |        | `ADMIN,SUPPORT` / `12` (docs/14 §1, §18)                                | staff MFA + session age                           |
| `JUDGE0_LANGUAGE_IDS`                                                                     |        | default `javascript:222,typescript:223,python:312` (infra/judge0/image) | code execution                                    |
| `JUDGE0_MAX_CPU_TIME_LIMIT` / `JUDGE0_MAX_MEMORY_LIMIT` / `JUDGE0_MAX_WALL_TIME_LIMIT`    |        | `5` / `256000` / `5` — only for a Judge0 host with other MAX\_\* values | code execution                                    |
| `CODE_QUEUE_MAX_BACKLOG`                                                                  |        | `100` (`0` disables)                                                    | Judge0 backlog throttle                           |
| `AI_GRADER_MODEL` / `AI_GRADER_TIMEOUT_MS`                                                |        | defaults in `ai-grading.provider.ts` / `8000`                           | AI grading                                        |
| `ASSET_SWEEP_UNCONFIRMED_HOURS` / `ASSET_SWEEP_UNREFERENCED_DAYS` / `ASSET_SWEEP_DRY_RUN` |        | `24` / `30` / `false` in production                                     | orphan-asset sweep                                |
| `SENTRY_DSN` / `SENTRY_ENVIRONMENT` / `SENTRY_RELEASE`                                    |        | Sentry project `codify-api`; `production` / `staging`                   | errors                                            |
| `LOG_LEVEL`                                                                               |        | `info`                                                                  | pino                                              |
| `ALLOW_DEV_AUTH`                                                                          |        | **unset / `false`** in both environments (production refuses `true`)    | dev tokens must never work outside local dev      |

`.env.example` lists every variable with its comment; the frontends' build
time values (Clerk publishable key, Sentry DSN per app, app version) are in
docs/13 §16 "Build time".

## Operations

- **Rollback:** `docker buildx imagetools create -t ghcr.io/<owner>/codify-api:production ghcr.io/<owner>/codify-api:<previous X.Y.Z>`,
  then _Redeploy_ in Coolify. Migrations are forward-only and backwards
  compatible (docs/13 §10), so the previous image runs on the newer schema.
- **Logs:** Coolify UI for a quick look; Grafana Cloud (Loki) for search.
- **Restart storms:** the healthcheck reports `degraded` when Postgres is
  unreachable — check `do-pg-prod` trusted sources and the DO status page first.
