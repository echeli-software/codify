# 13 — Deployment

VPS-based stack: DigitalOcean São Paulo for low Brazilian latency, Coolify for Heroku-like deploy DX, Cloudflare in front for DNS/CDN/WAF/TLS, DO Managed Postgres for the database.

## 1. Hosts & roles

| Host                                | Sizing (start)        | Role                                                                 | Hardening                                                          |
| ----------------------------------- | --------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `vps-app-01` (DO Droplet, SP)       | 4 vCPU / 8 GB / 80 GB | API (NestJS), Redis, BullMQ workers, Coolify control plane           | UFW; SSH key only; fail2ban                                        |
| `vps-judge0-01` (DO Droplet, SP)    | 4 vCPU / 8 GB / 80 GB | Judge0 server + isolate workers + internal Postgres + internal Redis | UFW: only `vps-app-01` allowed inbound; SSH key only; isolated VPC |
| `do-pg-prod` (Managed Postgres, SP) | 1 vCPU / 1 GB → scale | Primary database                                                     | Trusted sources = `vps-app-01` only                                |
| `vps-staging-01` (DO Droplet, SP)   | 2 vCPU / 4 GB         | API + Redis (staging env)                                            | Same baseline; trusted source of `do-pg-staging`                   |
| `do-pg-staging` (Managed Postgres)  | smallest tier         | Staging DB                                                           | Trusted sources = `vps-staging-01` only                            |

All five live in one DO VPC so app ↔ Judge0 ↔ Postgres traffic never traverses the public internet. Everything above is Terraform in `infra/terraform` (see §16). The region is a variable: confirm DigitalOcean offers droplets **and** Managed Postgres in São Paulo (`doctl compute region list`) before applying.

## 2. Coolify

Installed on `vps-app-01` (and on staging host). Coolify gives us:

- Git-push deploys per service (API, workers).
- Environment variable management with audit.
- Per-service Docker builds.
- Automatic Let's Encrypt for hosts (we'll proxy via Cloudflare anyway).
- Backups for managed services Coolify provisions (we use DO Managed for Postgres, so this is moot).
- Healthchecks + auto-restart.

Coolify config is committed under `infra/coolify/`: `docker-compose.yml` (api + worker + redis, one resource per environment) and `README.md` (install, origin certificate, env vars, pre-deployment command `prisma migrate deploy`, deploy webhook).

## 3. Static frontends

Admin and Student PWA build outputs go to **Cloudflare Pages** (direct upload from Actions, Terraform-managed projects):

- Admin: `admin.codify.app` → project `codify-admin`, production branch `main`.
- Student PWA: `codify.app` (root) and `app.codify.app` (alias) → project `codify-student`.
- Staging: `staging.codify.app` / `admin.staging.codify.app` → projects `codify-student-staging` / `codify-admin-staging`.
- Preview deployments per PR: branch `pr-<n>` of the staging projects → `https://pr-<n>.codify-student-staging.pages.dev`, `https://pr-<n>.codify-admin-staging.pages.dev` (the `*.codify.dev` vanity hosts from the original plan would need a second zone; `pages.dev` aliases are stable per PR).
- CI builds and deploys via `cloudflare/wrangler-action` (`infra/web/build-frontend.sh` injects the API URL with Angular `define` → `CODIFY_API_URL`).
- Security + caching headers come from one generator (`infra/web/security-headers.mjs`) rendered as Pages `_headers` (or an nginx snippet for the optional `apps/{admin,student}/Dockerfile` images). It implements docs/14 §5 with three necessary corrections, documented in its header: `o*.ingest.sentry.io` is not a valid CSP source (→ `*.ingest.sentry.io`), R2 presigned uploads need `*.r2.cloudflarestorage.com`, and `worker-src 'self' blob:` for the service worker / Monaco. The student app also sends `Cross-Origin-Embedder-Policy: credentialless` + `Cross-Origin-Opener-Policy: same-origin`.

Static assets cached aggressively via Cloudflare. App-shell HTML cached short (1 min) with stale-while-revalidate.

## 4. Capacitor builds (mobile)

- iOS and Android builds run in CI (`mobile.yml`: macOS + Ubuntu runners) on `mobile-v*` tags or manual dispatch.
- Code-signing: Fastlane match (readonly) for iOS; upload keystore stored base64 in GitHub secrets for Android (injected via `android.injected.signing.*`, never written to the repo).
- Builds uploaded to TestFlight (`fastlane ios beta`: match → gym → pilot) / Play Internal Testing (`fastlane android internal`: supply) automatically. Lanes live in `apps/student/fastlane/`.
- Production submission triggered manually after QA (`fastlane android promote`, App Store Connect).

## 5. DNS

| Host                                                 | Type      | Target                                                                                                                                                                              |
| ---------------------------------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `codify.app`                                         | A / AAAA  | Cloudflare Pages                                                                                                                                                                    |
| `app.codify.app`                                     | CNAME     | `codify.app`                                                                                                                                                                        |
| `admin.codify.app`                                   | CNAME     | Cloudflare Pages (admin project)                                                                                                                                                    |
| `api.codify.app`                                     | A         | DO Droplet IP (proxied via Cloudflare)                                                                                                                                              |
| `staging.codify.app`, `admin.staging`, `api.staging` | CNAME / A | Same pattern, separate origin (`vps-staging-01`). Two-level names need an Advanced Certificate (`*.staging.codify.app`) — Universal SSL only covers one level; Terraform orders it. |
| `cdn.codify.app`                                     | CNAME     | R2 custom domain                                                                                                                                                                    |
| MX, SPF, DKIM                                        | –         | Postmark / Resend per provider                                                                                                                                                      |

## 6. TLS

- Cloudflare-issued for edge (free).
- Origin: Cloudflare Origin Certificate installed on Coolify reverse-proxy. SSL mode `Full (strict)`.
- HSTS: `max-age=15552000; includeSubDomains; preload`.

## 7. Cloudflare config

- WAF: managed ruleset on default (Cloudflare Managed + OWASP on Pro+; the free managed ruleset otherwise) + per-IP rate limit on `/api/webhooks/*` (free plans allow one rate-limit rule; per-user limits for auth/submissions are enforced in the API) + optional provider-IP allowlists and a POST-only rule for webhooks (docs/14 §6).
- Bot fight mode: on (basic).
- Cache: HTML short-TTL, static assets long-TTL with `Cache-Control: public, max-age=31536000, immutable`.
- Image Resizing: enabled for `cdn.codify.app/img/*` (server origin = R2).
- Cache rules (Rulesets, not legacy Page Rules): API hosts bypass cache entirely.
- Origins accept 80/443 only from Cloudflare's published edge ranges (DO cloud firewall), so the WAF can't be bypassed by hitting the droplet IP.
- Firewall: block known-malicious ASNs, geofence as needed (start permissive).

## 8. Secrets

- **CI**: GitHub Encrypted Secrets for build-time tokens (Cloudflare API token, Stripe restricted key for OpenAPI gen, etc.).
- **Runtime**: Coolify env vars per environment. Mirror in 1Password Vault for human reference; no raw secrets in repo.
- **Rotation policy**:
  - Stripe webhook signing secret: rotate yearly, on any leak.
  - Clerk JWT verification key: managed by Clerk, refreshed via JWKS automatically.
  - DB credentials: rotated quarterly via DO console.
  - SSH keys: per-developer, removed on offboard.
- **Never commit `.env`**. Provide `.env.example` with placeholder values.

## 9. CI/CD

GitHub Actions (`.github/workflows/`), as built. Every job that needs a secret checks for it first and **skips with a job summary** when it is absent, so forks and partially configured repos stay green. Actions are pinned to major versions; each workflow declares least-privilege `permissions:`.

| Workflow        | Trigger                      | Steps                                                                                                                                                                                                                                                                                                                                                                                   |
| --------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ci.yml`        | PR + push to default branch  | Postgres 16 + Redis 7 services · install · `prisma generate` · format check · `nx affected -t lint test typecheck build` · **API smoke**: build bundle → runtime manifest → hoisted prod install (exactly the Docker runtime stage) → `prisma migrate deploy` → boot → `GET /api/health` must be `ok`/`up` · `images` job builds the API Dockerfile (all three on push) without pushing |
| `preview.yml`   | PR                           | Build admin + student against the staging API → `wrangler pages deploy` to the staging projects as branch `pr-<n>` → sticky PR comment with both URLs                                                                                                                                                                                                                                   |
| `staging.yml`   | Push to default branch       | Build + push `ghcr.io/<owner>/codify-api:{sha-…,staging}` → **migrate** (`prisma migrate deploy` from that image, run on `vps-staging-01` over SSH — the only host the staging DB trusts) → Coolify deploy webhook (waits for completion) → smoke `/api/health` → admin + student to the staging Pages projects                                                                         |
| `release.yml`   | Tag `v*`                     | Build + push `:{X.Y.Z, X.Y, sha-…}` with SBOM + provenance → ⏸ **`production` environment approval** → migrate on `vps-app-01` → promote image to `:production` → Coolify deploy → smoke → Pages production → GitHub release with generated notes (+ optional Slack, Sentry source maps)                                                                                                |
| `storybook.yml` | PR / push touching `libs/**` | Build both Storybooks → test-runner over every story with **axe** (`infra/storybook/test-runner.ts` unless a lib ships its own) → publish to Pages (`codify-storybook-admin`, `codify-storybook-student`; PRs as `pr-<n>`) + artifact                                                                                                                                                   |
| `mobile.yml`    | Tag `mobile-v*` / manual     | Student production build → Android: `cap sync`, `bundleRelease` signed from secrets, `fastlane android internal` (Play internal testing) · iOS (macOS): `cap sync`, `fastlane ios beta` (match → gym → pilot to TestFlight)                                                                                                                                                             |

The nightly drift check runs **inside the API** as a scheduled job (platform workstream) rather than as `nightly.yml`, so it uses the same DB connection and alerting as the app; `tools/scripts/drift-check.mjs` is the on-demand equivalent (`DATABASE_URL=… node tools/scripts/drift-check.mjs`, exit 1 on drift). League rollover is likewise an in-app cron.

Required checks on the default branch: `CI / ci`, `CI / images (api)`, code review by 1+. Migrations are validated on every PR by `prisma migrate deploy` against a fresh database in `ci.yml`.

Images: `apps/api/Dockerfile` (multi-stage: `pnpm fetch` + offline install from the lockfile → `prisma generate` → `nx build api` → `infra/docker/api-runtime-manifest.mjs` writes a production `package.json` + pruned `pnpm-lock.yaml` from the Nx project graph and cross-checks it against the bundle's `require()`s → hoisted prod install + `prisma generate` → `node:22-slim`, non-root `node` user, tini, `HEALTHCHECK` on `/api/health`, `CMD node main.js`; target `migrate` runs `prisma migrate deploy`). `apps/admin/Dockerfile` / `apps/student/Dockerfile` are optional nginx (unprivileged) images with SPA fallback, gzip, immutable hashed assets and the same CSP as Pages.

## 10. Migrations

- Prisma migrations generated locally and committed.
- Staging applies on every deploy (`staging.yml`, before the Coolify deploy).
- Prod applies on `release.yml` after manual approval gate (a GitHub environment with required reviewers), before the image is promoted to `:production`.
- Mechanism: `infra/deploy/remote-migrate.sh` SSHes to the environment's app droplet and runs `docker run --rm --env DATABASE_URL <image@digest> prisma migrate deploy`; the URL travels over SSH stdin. CI never needs network access to the database. Coolify's pre-deployment command (`prisma migrate deploy`) covers manual redeploys and is a no-op otherwise.
- Backwards-compatible discipline:
  - Add column → deploy app reading old schema → backfill → deploy app reading new column → drop old column (if applicable) in a later migration.
  - Never drop a column in the same release that depends on the new column being present.

## 11. Backups

- **Postgres**: DO Managed daily snapshots + 7-day PITR.
- **R2 assets**: versioned bucket; lifecycle rule prunes old versions after 90 days.
- **Long-term DB dumps**: weekly `pg_dump` to R2 cold storage, 90-day retention. Encrypted with `age` using a public key whose private key lives in 1Password.

Restore drill: quarterly. Restore latest dump to a throwaway DB, run `prisma db pull` and basic queries to verify.

## 12. Monitoring & observability

- **Logs**: Loki via Grafana Cloud free tier. Structured JSON logs from Nest (Pino), shipped by a **Grafana Alloy** agent on each VPS (`infra/observability`; Alloy replaced Vector so one agent does logs + metrics). pino's numeric level becomes the `level` label; `/api/health` lines are dropped.
- **Metrics**: Alloy's built-in node + cAdvisor exporters, remote-written to Grafana Cloud Prometheus.
- **Tracing**: OpenTelemetry SDK in Nest; spans exported to Grafana Cloud.
- **Errors**: Sentry for both apps + API. Source maps uploaded on build.
- **Uptime**: BetterStack or UptimeRobot for external probes (API health, admin login, student PWA load).
- **Dashboards**:
  - API health (RED metrics).
  - Gamification ledger drift (delta vs computed).
  - Stripe webhook lag.
  - Reward orchestration latency.
  - Judge0 queue depth + average runtime.
  - Push delivery success rate.

### Alerts (PagerDuty / Slack)

- API p99 > 1s for 5 min.
- 5xx error rate > 1% for 5 min.
- Stripe webhook lag > 10 min.
- Push delivery < 95% for 30 min.
- Judge0 queue depth > 100.
- DB CPU > 80% for 10 min.
- Free disk on any VPS < 15%.

## 13. Local dev

`docker-compose.dev.yml` brings up:

- Postgres 16 (host port 55432)
- Redis 7 (host port 56379)

Opt-in profiles: `--profile mail` adds Mailpit (SMTP :1025, UI :8025); `--profile judge0` adds Judge0 server + workers + internal pg/redis on :2358 (needs a Linux Docker host with cgroup v1). Without them the API uses its in-process dev executor and dev email/push providers (every integration falls back to a dev implementation outside production). The production Judge0 stack is `infra/judge0/`.

Each app runs via Nx (`pnpm nx serve api|admin|student`). Clerk uses dev tenant; Stripe uses test mode with `stripe listen` forwarding webhooks.

## 14. Disaster recovery

- **Region failure (DO SP)**: Postgres failover to a replica we provision once we're past launch (HA tier). API host: cold spare in another region with image baked weekly.
- **Compromise of API host**: revoke Stripe restricted keys, rotate Clerk JWKS, rebuild from scratch via Coolify.
- **Compromise of Judge0 host**: same; the host is stateless beyond its internal Postgres which we treat as ephemeral (no persistent data of value).
- **Data corruption**: PITR to last clean point; replay business events from logs where possible.

## 15. Cost projection (rough)

Monthly USD:

- DO Droplet 4/8 (API): $48
- DO Droplet 4/8 (Judge0): $48
- DO Droplet 2/4 (staging): $24
- DO Managed Postgres (prod / staging): ~$22 combined
- Cloudflare R2 + email: ~$15
- Cloudflare Advanced Certificate Manager (two-level `*.staging` hosts): $10
- **Total infra**: ~$170/mo at start; scales linearly. Revisit at 5k WAU.

Free at the start: Cloudflare WAF/CDN, Sentry dev tier, Grafana Cloud free tier. Stripe takes a % of revenue, no platform fee. Operational specifics live in `infra/coolify/README.md` and may drift faster than this doc.

## 16. Configuration reference (as built)

The ordered setup runbook is [`infra/README.md`](../infra/README.md). Where each value lives:

### Terraform (`infra/terraform`, `TF_VAR_*` / `terraform.tfvars`)

| Variable                                                                                                | Purpose                                              |
| ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `do_token`, `cloudflare_api_token` (env, secret)                                                        | provider credentials                                 |
| `cloudflare_account_id`, `zone_name`                                                                    | Cloudflare account + zone                            |
| `region`                                                                                                | DO region for droplets, VPC and both PG clusters     |
| `ssh_key_fingerprints`, `admin_ssh_cidrs`                                                               | key-only SSH; SSH + Coolify UI only from these CIDRs |
| `app_droplet_size`, `judge0_droplet_size`, `staging_droplet_size`, `droplet_backups`                    | §1 sizing                                            |
| `pg_version`, `pg_prod_size`, `pg_prod_node_count`, `pg_staging_size`                                   | Managed Postgres                                     |
| `judge0_allow_staging`                                                                                  | let the staging droplet use the prod Judge0 host     |
| `cloudflare_plan_has_managed_waf`, `webhook_rate_limit`, `stripe_webhook_ips`, `revenuecat_webhook_ips` | §7 WAF / rate limits / webhook allowlists            |
| `enable_staging_edge_cert`                                                                              | ACM pack for `*.staging.codify.app`                  |
| `email_dns_records`, `cdn_r2_target`                                                                    | MX/SPF/DKIM, `cdn` CNAME                             |

Outputs feed the next steps: `database_url_prod` / `database_url_staging` (→ Coolify + GitHub env secrets), `judge0_private_url` (→ `JUDGE0_URL`), droplet IPs (→ SSH secrets), Pages subdomains.

### GitHub Actions

| Name                                                                                                                                              | Kind               | Scope                                 | Used by                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ | ------------------------------------- | ------------------------------------------------ |
| `CLOUDFLARE_API_TOKEN`                                                                                                                            | secret             | repo                                  | preview, staging, release, storybook             |
| `CLOUDFLARE_ACCOUNT_ID`                                                                                                                           | variable           | repo                                  | same                                             |
| `STAGING_DATABASE_URL`, `STAGING_SSH_HOST`, `STAGING_SSH_PRIVATE_KEY`, `STAGING_SSH_KNOWN_HOSTS`, `STAGING_COOLIFY_WEBHOOK_URL`, `COOLIFY_TOKEN`  | secrets            | env `staging`                         | staging                                          |
| `PROD_DATABASE_URL`, `PROD_SSH_HOST`, `PROD_SSH_PRIVATE_KEY`, `PROD_SSH_KNOWN_HOSTS`, `PROD_COOLIFY_WEBHOOK_URL`, `COOLIFY_TOKEN`                 | secrets            | env `production` (required reviewers) | release                                          |
| `STAGING_API_URL`, `PREVIEW_API_URL`, `PROD_API_URL`                                                                                              | variables          | repo                                  | smoke tests + frontend builds (`CODIFY_API_URL`) |
| `PAGES_PROJECT_*`, `PAGES_PRODUCTION_BRANCH`, `STAGING_SSH_USER`, `PROD_SSH_USER`                                                                 | variables          | repo                                  | optional overrides                               |
| `SENTRY_AUTH_TOKEN` + `SENTRY_ORG`, `SLACK_RELEASE_WEBHOOK_URL`                                                                                   | secret / variable  | repo                                  | optional release extras                          |
| `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`, `PLAY_SERVICE_ACCOUNT_JSON`                  | secrets            | repo                                  | mobile (Android)                                 |
| `MATCH_GIT_URL`, `MATCH_PASSWORD`, `MATCH_GIT_BASIC_AUTHORIZATION`, `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_P8_BASE64` + variable `APPLE_TEAM_ID` | secrets / variable | repo                                  | mobile (iOS)                                     |

### Runtime (Coolify, per environment)

`NODE_ENV`, `PORT`, `DATABASE_URL`, `REDIS_PASSWORD` (→ `REDIS_URL`), `JOBS_ENABLED`, `CORS_ORIGINS`, `STUDENT_APP_URL`, `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY`, `CLERK_JWT_KEY`, `CLERK_WEBHOOK_SECRET`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `REVENUECAT_WEBHOOK_AUTH`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `R2_PUBLIC_URL`, `JUDGE0_URL`, `JUDGE0_AUTH_TOKEN`, `ANTHROPIC_API_KEY`, `FCM_SERVICE_ACCOUNT`, `SENTRY_DSN`, `SENTRY_ENVIRONMENT`, `LOG_LEVEL`; `ALLOW_DEV_AUTH` unset. Table with sources: [`infra/coolify/README.md`](../infra/coolify/README.md). `.env.example` is the authority for names.

### Build time (frontends)

| Define           | Set by                                                           | Default                                                        |
| ---------------- | ---------------------------------------------------------------- | -------------------------------------------------------------- |
| `CODIFY_API_URL` | `infra/web/build-frontend.sh <app> <api-url>` (Angular `define`) | `http://localhost:3000/api` (`apps/*/src/app/api-base-url.ts`) |

CSP `connect-src` is derived from the same API URL; `CDN_ORIGIN` / `CLERK_ORIGIN` (env of `build-frontend.sh`) extend it for the CDN and a Clerk production custom domain.

### Judge0 host / observability agents

`infra/judge0/judge0.conf.template` (`JUDGE0_AUTHN_TOKEN`, `JUDGE0_AUTHZ_TOKEN`, `JUDGE0_DB_PASSWORD`, `JUDGE0_REDIS_PASSWORD`, `JUDGE0_BIND_ADDR`); `infra/observability/.env.example` (`CODIFY_ENV`, `GRAFANA_LOKI_URL`, `GRAFANA_LOKI_USER`, `GRAFANA_PROM_URL`, `GRAFANA_PROM_USER`, `GRAFANA_CLOUD_API_KEY`).

## 17. Verification

Load scripts live in `tools/load/` (plain Node 22 `fetch` + a concurrency pool, no dependencies; `API_URL` selects the target). They seed the free "Codify Demo" course via `tools/scripts/seed-demo-course.mjs` if it is missing.

### Phase 9 — league cohort sharding at 1k synthetic users

`API_URL=http://localhost:3107/api node tools/load/league-sharding.mjs --users=1000 --concurrency=25`, run 2026-10-07 against a local production build of the API (`NODE_ENV=development` for dev tokens) on the shared dev Postgres. 1,000 new students (`dev-token-student500000…500999`) each completed the free reading lesson concurrently; the reward path lazily placed them into weekly cohorts:

```
Completions in 32.9s — status counts: {"201":1000}
POST /lessons/:id/complete latency p50=641ms p95=1838ms p99=2348ms

Synthetic users placed: 1000/1000 (league read errors: 0)
Cohorts touched: 34 across tier(s) BRONZE
Cohort size: min=29 max=30 mean=29.97 · full(30)=33 partial=1
Distribution (cohort size → count):
    30 │ ████████████████████████████████████████ 33
    29 │ █ 1

✅ PASS — every cohort ≤ 30; 33 full cohorts + 1 filling; mean 29.97
```

(34 cohorts because the run first topped up a partially filled cohort left by earlier runs on the shared database.) The first run of this script **failed**: 27 of 32 cohorts held 31–35 members because concurrent first-time placements all read the same open-cohort count. `LeagueAccumulatorService.ensureMembership` now takes a transaction-scoped advisory lock per (tier, week) before choosing a cohort (unit-tested in `league-accumulator.service.spec.ts`); the run above is after that fix.

### Phase 10 / 12 — submission and AI-grading latency

Both ran against the same local API, i.e. the **in-process dev executor** and the **deterministic dev grader** — they measure the API path (auth, access checks, persistence, reward transaction), not Judge0 or an LLM. Re-run them against staging with `JUDGE0_URL` / `ANTHROPIC_API_KEY` configured for the real acceptance numbers.

| Script                                                | Load                                           | Result                                                                           | Target                    |
| ----------------------------------------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------- |
| `submissions-p95.mjs --requests=200 --concurrency=10` | 200 submits from 200 users, 30 % wrong answers | 200/200 completed (140 PASS / 60 FAIL), p50 234 ms · **p95 370 ms** · p99 598 ms | p50 < 1.5 s, p95 < 4 s ✅ |
| `ai-grading-p95.mjs --requests=100 --concurrency=10`  | 100 unique responses (cache defeated)          | 100/100 graded (HEURISTIC), p50 211 ms · **p95 327 ms** · p99 354 ms             | p95 < 3 s ✅              |

### API image

No Docker daemon was available while building this pipeline, so the Dockerfile's steps were executed by hand: `nx build api` → `api-runtime-manifest.mjs` (14 runtime deps, pruned lockfile) → `pnpm install --prod --frozen-lockfile --config.node-linker=hoisted` → `prisma generate` → `prisma migrate status` against Postgres → `NODE_ENV=development node main.js` → `/api/health` = `{"status":"ok","database":"up"}`. The same sequence is the `ci.yml` smoke test, and `ci.yml`'s `images` job builds the real Dockerfile on every PR.
