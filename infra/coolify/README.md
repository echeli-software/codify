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

> `JOBS_ENABLED` is the API's switch for queue consumers / schedulers (the
> platform workstream owns it). Until it exists, both containers run the same
> process; that is safe because jobs are idempotent, but set the worker's
> replica count to 1.

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
fails the deploy's healthcheck instead of silently degrading.

| Variable                                                      | Secret | Example / source                                                                                                                                                                          | Used by                                      |
| ------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| `NODE_ENV`                                                    |        | `production` (compose sets it)                                                                                                                                                            | everything                                   |
| `PORT`                                                        |        | `3000` api / `3001` worker (compose sets it)                                                                                                                                              | HTTP listener (`API_PORT` also honoured)     |
| `DATABASE_URL`                                                | ✔      | `terraform output -raw database_url_prod` (private host, `sslmode=require`)                                                                                                               | Prisma                                       |
| `REDIS_PASSWORD`                                              | ✔      | `openssl rand -hex 32`; compose builds `REDIS_URL` from it                                                                                                                                | Redis, BullMQ, rate limits                   |
| `JOBS_ENABLED`                                                |        | compose sets `false`/`true`                                                                                                                                                               | queue consumers + crons                      |
| `CORS_ORIGINS`                                                |        | `https://codify.app,https://app.codify.app,https://admin.codify.app` (staging adds `https://*.codify-student-staging.pages.dev,https://*.codify-admin-staging.pages.dev` for PR previews) | CORS allowlist (docs/14 §5)                  |
| `STUDENT_APP_URL`                                             |        | `https://codify.app`                                                                                                                                                                      | links in emails/checkout returns             |
| `CLERK_SECRET_KEY`                                            | ✔      | Clerk dashboard (prod instance)                                                                                                                                                           | auth                                         |
| `CLERK_PUBLISHABLE_KEY`                                       |        | Clerk dashboard                                                                                                                                                                           | auth                                         |
| `CLERK_JWT_KEY`                                               | ✔      | Clerk → API keys → JWT public key (networkless verification)                                                                                                                              | auth                                         |
| `CLERK_WEBHOOK_SECRET`                                        | ✔      | Clerk → Webhooks → signing secret (Svix)                                                                                                                                                  | `/api/webhooks/clerk`                        |
| `STRIPE_SECRET_KEY`                                           | ✔      | Stripe restricted key                                                                                                                                                                     | billing                                      |
| `STRIPE_WEBHOOK_SECRET`                                       | ✔      | Stripe → Webhooks → endpoint `https://api.codify.app/api/webhooks/stripe`                                                                                                                 | billing                                      |
| `REVENUECAT_WEBHOOK_AUTH`                                     | ✔      | value configured as the RevenueCat webhook Authorization header                                                                                                                           | `/api/webhooks/revenuecat`                   |
| `R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | ✔      | Cloudflare R2 API token (object read/write on the bucket)                                                                                                                                 | uploads                                      |
| `R2_BUCKET_NAME`                                              |        | `codify-prod-assets` / `codify-staging-assets`                                                                                                                                            | uploads                                      |
| `R2_PUBLIC_URL`                                               |        | `https://cdn.codify.app`                                                                                                                                                                  | asset URLs                                   |
| `JUDGE0_URL`                                                  |        | `terraform output -raw judge0_private_url`                                                                                                                                                | code execution                               |
| `JUDGE0_AUTH_TOKEN`                                           | ✔      | `JUDGE0_AUTHN_TOKEN` from infra/judge0                                                                                                                                                    | code execution                               |
| `ANTHROPIC_API_KEY`                                           | ✔      | Anthropic console                                                                                                                                                                         | AI grading                                   |
| `FCM_SERVICE_ACCOUNT`                                         | ✔      | Firebase service-account JSON (one line)                                                                                                                                                  | push                                         |
| `SENTRY_DSN`                                                  |        | Sentry project `codify-api`                                                                                                                                                               | errors                                       |
| `SENTRY_ENVIRONMENT`                                          |        | `production` / `staging`                                                                                                                                                                  | errors                                       |
| `LOG_LEVEL`                                                   |        | `info`                                                                                                                                                                                    | pino                                         |
| `ALLOW_DEV_AUTH`                                              |        | **unset / `false`** in both environments                                                                                                                                                  | dev tokens must never work outside local dev |

Names other than `DATABASE_URL`, `REDIS_URL`, `API_PORT`/`PORT`,
`STUDENT_APP_URL`, `STRIPE_SECRET_KEY`, `JUDGE0_URL`, `ANTHROPIC_API_KEY` and
`REVENUECAT_WEBHOOK_AUTH` (read by the API today) come from `.env.example` and
the roadmap workstreams; after merging, `.env.example` is the authority —
diff it against this table whenever it changes.

## Operations

- **Rollback:** `docker buildx imagetools create -t ghcr.io/<owner>/codify-api:production ghcr.io/<owner>/codify-api:<previous X.Y.Z>`,
  then _Redeploy_ in Coolify. Migrations are forward-only and backwards
  compatible (docs/13 §10), so the previous image runs on the newer schema.
- **Logs:** Coolify UI for a quick look; Grafana Cloud (Loki) for search.
- **Restart storms:** the healthcheck reports `degraded` when Postgres is
  unreachable — check `do-pg-prod` trusted sources and the DO status page first.
