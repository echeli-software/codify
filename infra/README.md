# Codify infrastructure runbook

Everything needed to stand up Codify's hosting from zero, in order. The
design is in [docs/13-deployment.md](../docs/13-deployment.md); this is the
operational checklist.

```
infra/
├── terraform/      DigitalOcean (VPC, 3 droplets, firewalls, 2 managed Postgres) + Cloudflare (DNS, TLS, WAF, rate limits, Pages)
├── judge0/         docker-compose + judge0.conf template + egress lockdown for vps-judge0-01
├── coolify/        compose resource (api + worker + redis) + env var reference
├── observability/  Grafana Alloy agent (logs + metrics → Grafana Cloud), Sentry + uptime notes
├── deploy/         scripts the workflows call: remote-migrate.sh, coolify-deploy.sh, smoke.sh
├── docker/         api-runtime-manifest.mjs (used by apps/api/Dockerfile and CI)
├── web/            build-frontend.sh, security-headers.mjs (CSP/caching for Pages + nginx), nginx/default.conf
└── storybook/      default axe hooks for the Storybook test-runner
```

## 0. Accounts & tools

- DigitalOcean team, Cloudflare account with the `codify.app` zone active,
  GitHub org admin, Grafana Cloud stack, Sentry org, Apple Developer + App
  Store Connect, Google Play Console, Clerk, Stripe, RevenueCat, Anthropic,
  Firebase.
- Local: `terraform >= 1.6`, `doctl`, `gh`, `jq`, `openssl`, Docker.

## 1. Terraform state bucket

Create a private DO Spaces bucket (e.g. `codify-tfstate`) + Spaces access key,
then `infra/terraform/backend.hcl` (git-ignored):

```hcl
bucket   = "codify-tfstate"
endpoints = { s3 = "https://<region>.digitaloceanspaces.com" }
access_key = "<spaces key>"
secret_key = "<spaces secret>"
```

## 2. Provision (Terraform)

```bash
cd infra/terraform
cp terraform.tfvars.example terraform.tfvars   # fill in; see the variable table below
export TF_VAR_do_token=… TF_VAR_cloudflare_api_token=…
terraform init -backend-config=backend.hcl
terraform providers lock -platform=linux_amd64 -platform=darwin_arm64   # commit .terraform.lock.hcl
terraform plan -out tfplan && terraform apply tfplan
```

Creates: VPC; `vps-app-01`, `vps-judge0-01`, `vps-staging-01` (Ubuntu 24.04,
cloud-init hardening: `deploy` user, key-only SSH, fail2ban, UFW, Docker);
cloud firewalls (SSH + Coolify from `admin_ssh_cidrs` only; 80/443 from
Cloudflare edge IPs only; Judge0 :2358 from the app droplet(s) only, egress
DNS/NTP/HTTP(S)); `do-pg-prod` + `do-pg-staging` (PG 16, private network,
trusted source = the matching app droplet, `codify` db + `codify_app` user);
Cloudflare DNS per docs/13 §5, SSL Full (strict) + HSTS + TLS 1.2+, Bot Fight
Mode, managed WAF (Pro+), webhook allowlists + POST-only rule, per-IP rate
limit on `/api/webhooks/*`, API cache bypass, an Advanced Certificate pack for
`*.staging.codify.app`, and six Pages projects (student, admin, their
`-staging` twins, two Storybooks) with custom domains.

| Terraform variable                             | Where the value comes from                                                                           |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `TF_VAR_do_token` (env)                        | DO → API → Tokens (read/write)                                                                       |
| `TF_VAR_cloudflare_api_token` (env)            | Cloudflare → API Tokens: Zone DNS/Settings/Firewall/WAF/SSL edit on the zone + Account Pages edit    |
| `cloudflare_account_id`                        | Cloudflare dashboard sidebar                                                                         |
| `region`                                       | `doctl compute region list` — docs/13 wants São Paulo; confirm availability (incl. Managed Postgres) |
| `ssh_key_fingerprints`                         | `doctl compute ssh-key list`                                                                         |
| `admin_ssh_cidrs`                              | operator / VPN egress IPs                                                                            |
| `stripe_webhook_ips`, `revenuecat_webhook_ips` | provider docs (optional; empty = no allowlist)                                                       |
| `cloudflare_plan_has_managed_waf`              | `true` only on Pro+                                                                                  |
| `email_dns_records`, `cdn_r2_target`           | email provider; R2 custom domain (see step 9)                                                        |

Grant the app user DDL rights once (as `doadmin`, from the app droplet):

```bash
psql "$(terraform output -raw database_url_prod | sed 's/codify_app:[^@]*@/doadmin:<doadmin-password>@/')" \
  -c 'ALTER DATABASE codify OWNER TO codify_app; ALTER SCHEMA public OWNER TO codify_app;'
```

(same for staging). Prisma migrations then run as `codify_app`.

## 3. Judge0 host

Follow [judge0/README.md](./judge0/README.md): cgroup v1 boot flag, render
`judge0.conf`, egress lockdown, `docker compose up -d` bound to the VPC IP,
then the hostile-submission checks.

## 4. Coolify (prod + staging)

Follow [coolify/README.md](./coolify/README.md): install, origin certificate,
GHCR login (root **and** `deploy`), compose resource, runtime env vars,
pre-deployment command `prisma migrate deploy`, deploy webhook + API token.

## 5. Observability

[observability/README.md](./observability/README.md): Alloy on all three
droplets, Sentry projects, uptime monitors, Grafana alerts.

## 6. GitHub configuration

**Environments** (Settings → Environments):

- `staging` — no reviewers; deployment branch rule: default branch.
- `production` — **required reviewers** (this is the manual approval gate);
  deployment rule: tags `v*`.

**Secrets** (Settings → Secrets and variables → Actions):

| Secret                                                                     | Scope                              | Value                                                                              | Used by                              |
| -------------------------------------------------------------------------- | ---------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------ |
| `CLOUDFLARE_API_TOKEN`                                                     | repository                         | Cloudflare token with _Account → Cloudflare Pages → Edit_                          | preview, staging, release, storybook |
| `COOLIFY_TOKEN`                                                            | env `staging` **and** `production` | Coolify API token (deploy scope) of that environment's Coolify                     | staging, release                     |
| `STAGING_DATABASE_URL`                                                     | env `staging`                      | `terraform output -raw database_url_staging`                                       | staging (migrations)                 |
| `STAGING_SSH_HOST`                                                         | env `staging`                      | `vps-staging-01` public IP                                                         | staging (migrations)                 |
| `STAGING_SSH_PRIVATE_KEY`                                                  | env `staging`                      | dedicated deploy key (ed25519) whose public key is in `deploy`'s `authorized_keys` | staging                              |
| `STAGING_SSH_KNOWN_HOSTS`                                                  | env `staging`                      | `ssh-keyscan -t ed25519 <ip>` output                                               | staging                              |
| `STAGING_COOLIFY_WEBHOOK_URL`                                              | env `staging`                      | Coolify deploy webhook (api + worker uuids)                                        | staging                              |
| `PROD_DATABASE_URL`                                                        | env `production`                   | `terraform output -raw database_url_prod`                                          | release (migrations)                 |
| `PROD_SSH_HOST` / `PROD_SSH_PRIVATE_KEY` / `PROD_SSH_KNOWN_HOSTS`          | env `production`                   | as above for `vps-app-01`                                                          | release                              |
| `PROD_COOLIFY_WEBHOOK_URL`                                                 | env `production`                   | Coolify deploy webhook                                                             | release                              |
| `SENTRY_AUTH_TOKEN`                                                        | repository (optional)              | Sentry internal integration token (project:releases)                               | release (source maps)                |
| `SLACK_RELEASE_WEBHOOK_URL`                                                | repository (optional)              | Slack incoming webhook                                                             | release                              |
| `ANDROID_KEYSTORE_BASE64`                                                  | repository                         | `base64 -w0 upload.keystore` (Play App Signing upload key)                         | mobile                               |
| `ANDROID_KEYSTORE_PASSWORD` / `ANDROID_KEY_ALIAS` / `ANDROID_KEY_PASSWORD` | repository                         | keystore credentials                                                               | mobile                               |
| `PLAY_SERVICE_ACCOUNT_JSON`                                                | repository                         | Play Console → API access → service account JSON (release manager on the app)      | mobile                               |
| `MATCH_GIT_URL` / `MATCH_PASSWORD` / `MATCH_GIT_BASIC_AUTHORIZATION`       | repository                         | fastlane match certificates repo, passphrase, `base64("user:token")`               | mobile                               |
| `ASC_KEY_ID` / `ASC_ISSUER_ID` / `ASC_KEY_P8_BASE64`                       | repository                         | App Store Connect API key (App Manager), `.p8` base64                              | mobile                               |

`GITHUB_TOKEN` (automatic) pushes images to GHCR and creates releases.

**Variables** (repository level unless noted):

| Variable                                                        | Default when unset                                | Purpose                                                |
| --------------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------ |
| `CLOUDFLARE_ACCOUNT_ID`                                         | — (required for Pages)                            | wrangler                                               |
| `STAGING_API_URL`                                               | `https://api.staging.codify.app/api`              | staging smoke + staging/preview frontend builds        |
| `PREVIEW_API_URL`                                               | `https://api.staging.codify.app/api`              | PR preview builds                                      |
| `PROD_API_URL`                                                  | `https://api.codify.app/api`                      | release smoke, prod + mobile frontend builds           |
| `STAGING_CLERK_PUBLISHABLE_KEY`                                 | `pk_test_…` (public)                              | staging + preview frontend builds; unset = dev login   |
| `PROD_CLERK_PUBLISHABLE_KEY`                                    | `pk_live_…` (public)                              | prod + mobile frontend builds (Clerk sign-in)          |
| `PAGES_PROJECT_STUDENT` / `PAGES_PROJECT_ADMIN`                 | `codify-student` / `codify-admin`                 | prod Pages projects                                    |
| `PAGES_PROJECT_STUDENT_STAGING` / `PAGES_PROJECT_ADMIN_STAGING` | `codify-student-staging` / `codify-admin-staging` | staging + PR previews                                  |
| `PAGES_PRODUCTION_BRANCH`                                       | `main`                                            | branch name that makes a Pages deployment "production" |
| `STAGING_SSH_USER` / `PROD_SSH_USER`                            | `deploy`                                          | SSH user for migrations                                |
| `SENTRY_ORG`                                                    | —                                                 | source-map upload                                      |
| `APPLE_TEAM_ID`                                                 | — (required for iOS)                              | fastlane                                               |
| `APP_IDENTIFIER` / `ANDROID_PACKAGE_NAME`                       | `app.codify.student`                              | fastlane                                               |

**Branch protection** on the default branch: require `CI / ci` and
`CI / images (api)`, 1 review, linear history.

Every workflow checks its secrets first and **skips with a job summary** when
they are missing, so forks and partially configured repos stay green.

## 7. First deploys (Phase 0 acceptance)

1. Open a PR → `Preview` comments two URLs (`pr-<n>.codify-student-staging.pages.dev`, `…admin…`).
2. Merge → `Staging`: image → migrate on `vps-staging-01` → Coolify → smoke → Pages.
3. `git tag v0.0.1 && git push origin v0.0.1` → `Release` waits for approval in
   the `production` environment → migrate on `vps-app-01` → `:production` →
   Coolify → smoke → Pages → GitHub release.

## 8. Mobile (Phase 11)

- Android: create the app in Play Console, enroll in Play App Signing, upload
  the first AAB **manually** (the API can't create an app), then CI uploads
  every `mobile-v*` tag to internal testing.
- iOS: create the App ID `app.codify.student` + App Store Connect record; on a
  Mac run `cd apps/student && fastlane match appstore` once to populate the
  certificates repo; add the API key secrets. CI then signs with
  `match --readonly`, builds with gym and uploads to TestFlight.
- Native projects: `mobile.yml` runs `npx cap add android|ios` when
  `apps/student/android|ios` aren't committed. Once native customisation is
  needed (icons, push entitlements, `GoogleService-Info.plist`), commit them.
- Promotion to production stays manual: `fastlane android promote` / App Store Connect.

## 9. Remaining manual Cloudflare steps

- **R2:** create buckets `codify-prod-assets` / `codify-staging-assets`
  (versioning on, lifecycle: delete noncurrent versions after 90 days), attach
  the custom domain `cdn.codify.app`, enable Image Resizing for
  `cdn.codify.app/img/*`. (Provider 4.x has no R2 custom-domain resource.)
- **Email:** add the provider's MX/SPF/DKIM via `email_dns_records`.
- **HSTS preload:** submit `codify.app` at hstspreload.org once HTTPS is stable everywhere.

## 10. Backups & drills

- Managed Postgres: daily snapshots + 7-day PITR (DO default).
- Weekly encrypted dump to R2 (docs/13 §11) — cron on `vps-app-01`:
  `pg_dump "$DATABASE_URL" | age -r <pubkey> | rclone rcat r2:codify-backups/db-$(date +%F).sql.age`.
- Quarterly restore drill: restore into a throwaway cluster, run
  `DATABASE_URL=… node tools/scripts/drift-check.mjs`, spot-check queries.
