# 13 — Deployment

VPS-based stack: DigitalOcean São Paulo for low Brazilian latency, Coolify for Heroku-like deploy DX, Cloudflare in front for DNS/CDN/WAF/TLS, DO Managed Postgres for the database.

## 1. Hosts & roles

| Host | Sizing (start) | Role | Hardening |
|---|---|---|---|
| `vps-app-01` (DO Droplet, SP) | 4 vCPU / 8 GB / 80 GB | API (NestJS), Redis, BullMQ workers, Coolify control plane | UFW; SSH key only; fail2ban |
| `vps-judge0-01` (DO Droplet, SP) | 4 vCPU / 8 GB / 80 GB | Judge0 server + isolate workers + internal Postgres + internal Redis | UFW: only `vps-app-01` allowed inbound; SSH key only; isolated VPC |
| `do-pg-prod` (Managed Postgres, SP) | 1 vCPU / 1 GB → scale | Primary database | Trusted sources = `vps-app-01` only |
| `vps-app-staging` (DO Droplet, SP) | 2 vCPU / 4 GB | API + Redis (staging env) | – |
| `do-pg-staging` (Managed Postgres) | smallest tier | Staging DB | – |

VPC peering between API host and Judge0 host so traffic never traverses the public internet.

## 2. Coolify

Installed on `vps-app-01` (and on staging host). Coolify gives us:
- Git-push deploys per service (API, workers).
- Environment variable management with audit.
- Per-service Docker builds.
- Automatic Let's Encrypt for hosts (we'll proxy via Cloudflare anyway).
- Backups for managed services Coolify provisions (we use DO Managed for Postgres, so this is moot).
- Healthchecks + auto-restart.

Coolify config is committed under `infra/coolify/` as YAML where supported, otherwise documented in `infra/coolify/README.md` for manual setup steps.

## 3. Static frontends

Admin and Student PWA build outputs go to **Cloudflare Pages**:
- Admin: `admin.codify.app` → branch `main`.
- Student PWA: `codify.app` (root) and `app.codify.app` (alias).
- Preview deployments per PR: `pr-123-admin.codify.dev`, `pr-123-app.codify.dev`.
- CI builds and deploys via `cloudflare/wrangler-action`.

Static assets cached aggressively via Cloudflare. App-shell HTML cached short (1 min) with stale-while-revalidate.

## 4. Capacitor builds (mobile)

- iOS and Android builds run in CI (GitHub Actions macOS + Ubuntu runners) on tag push.
- Code-signing: Fastlane match for iOS; keystore stored in GitHub secrets for Android.
- Builds uploaded to TestFlight / Play Internal Testing automatically.
- Production submission triggered manually after QA.

## 5. DNS

| Host | Type | Target |
|---|---|---|
| `codify.app` | A / AAAA | Cloudflare Pages |
| `app.codify.app` | CNAME | `codify.app` |
| `admin.codify.app` | CNAME | Cloudflare Pages (admin project) |
| `api.codify.app` | A | DO Droplet IP (proxied via Cloudflare) |
| `staging.codify.app`, `admin.staging`, `api.staging` | – | Same pattern, separate origin |
| `cdn.codify.app` | CNAME | R2 custom domain |
| MX, SPF, DKIM | – | Postmark / Resend per provider |

## 6. TLS

- Cloudflare-issued for edge (free).
- Origin: Cloudflare Origin Certificate installed on Coolify reverse-proxy. SSL mode `Full (strict)`.
- HSTS: `max-age=15552000; includeSubDomains; preload`.

## 7. Cloudflare config

- WAF: managed ruleset on default + custom rate limits on auth and submission endpoints.
- Bot fight mode: on (basic).
- Cache: HTML short-TTL, static assets long-TTL with `Cache-Control: public, max-age=31536000, immutable`.
- Image Resizing: enabled for `cdn.codify.app/img/*` (server origin = R2).
- Page Rules: `/api/*` bypass cache; `/admin/api/*` bypass cache.
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

GitHub Actions, organized as:

| Workflow | Trigger | Steps |
|---|---|---|
| `ci.yml` | Every PR | Install · lint · type-check · unit tests · build all apps · run E2E (smoke) · upload Storybook artifact |
| `preview.yml` | Every PR | Deploy admin + student to Cloudflare Pages preview |
| `staging.yml` | Push `main` | Build + push API Docker image · trigger Coolify deploy on staging · run Prisma `migrate deploy` · smoke E2E |
| `release.yml` | Push tag `v*` | Build + push prod Docker image · run migrations against prod (gated approval) · trigger Coolify deploy on prod · post release notes to Slack |
| `mobile.yml` | Push tag `mobile-v*` | Build iOS via Fastlane · upload to TestFlight; build Android · upload to Play Internal |
| `nightly.yml` | Cron | Run the gamification drift check · regenerate weekly leagues if stuck · backup health report |

Required checks on `main`: CI green, code review by 1+, no failing migration plan.

## 10. Migrations

- Prisma migrations generated locally and committed.
- Staging applies on every deploy.
- Prod applies on `release.yml` after manual approval gate (a GitHub environment with required reviewers).
- Backwards-compatible discipline:
  - Add column → deploy app reading old schema → backfill → deploy app reading new column → drop old column (if applicable) in a later migration.
  - Never drop a column in the same release that depends on the new column being present.

## 11. Backups

- **Postgres**: DO Managed daily snapshots + 7-day PITR.
- **R2 assets**: versioned bucket; lifecycle rule prunes old versions after 90 days.
- **Long-term DB dumps**: weekly `pg_dump` to R2 cold storage, 90-day retention. Encrypted with `age` using a public key whose private key lives in 1Password.

Restore drill: quarterly. Restore latest dump to a throwaway DB, run `prisma db pull` and basic queries to verify.

## 12. Monitoring & observability

- **Logs**: Loki via Grafana Cloud free tier. Structured JSON logs from Nest (Pino), shipped via Vector daemon on each VPS.
- **Metrics**: Prometheus exporters; scraped by Grafana Cloud.
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
- Postgres 16
- Redis 7
- Judge0 (server + worker + internal pg + internal redis)
- Mailpit for local SMTP

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
- **Total infra**: ~$160/mo at start; scales linearly. Revisit at 5k WAU.

Free at the start: Cloudflare WAF/CDN, Sentry dev tier, Grafana Cloud free tier. Stripe takes a % of revenue, no platform fee. Operational specifics live in `infra/coolify/README.md` and may drift faster than this doc.
