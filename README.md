# Codify

> **Codify** (working title) is a gamified, multi-language learning platform for programming, AI usage in software development, IT career skills, and related soft skills. Mobile-first via Ionic + Capacitor, with a separate Bootstrap-based web admin for teachers and ops.

## Documentation index

Specs live under [`docs/`](./docs). Read in order on first pass; cross-references are absolute paths from the repo root.

| #   | File                                                | Purpose                                                       |
| --- | --------------------------------------------------- | ------------------------------------------------------------- |
| 00  | [Vision & Goals](./docs/00-vision.md)               | Mission, audience, success metrics, non-goals                 |
| 01  | [Architecture](./docs/01-architecture.md)           | Monorepo layout, tech stack, system topology                  |
| 02  | [Data Model](./docs/02-data-model.md)               | Prisma schema and entity descriptions                         |
| 03  | [Shared Libraries](./docs/03-shared-libraries.md)   | Atomic component inventory, all libs                          |
| 04  | [Admin App](./docs/04-admin-app.md)                 | Admin (Bootstrap) screens, flows, permissions                 |
| 05  | [Student App](./docs/05-student-app.md)             | Student (Ionic) screens, responsive layout                    |
| 06  | [Content Authoring](./docs/06-content-authoring.md) | Tiptap block schema, lesson rendering                         |
| 07  | [Gamification](./docs/07-gamification.md)           | XP, coins, multipliers, streaks, badges, leagues              |
| 08  | [Avatar & Shop](./docs/08-avatar-and-shop.md)       | 2D avatar system, items, dressing room                        |
| 09  | [Billing](./docs/09-billing.md)                     | Stripe, plans, categories, access control                     |
| 10  | [Engagement](./docs/10-engagement.md)               | Onboarding, notifications, animations, anti-patterns          |
| 11  | [i18n](./docs/11-i18n.md)                           | Localization, content translation, RTL                        |
| 12  | [Code Execution](./docs/12-code-execution.md)       | Self-hosted Judge0, exercise runner                           |
| 13  | [Deployment](./docs/13-deployment.md)               | VPS, Coolify, Cloudflare, CI/CD                               |
| 14  | [Security](./docs/14-security.md)                   | Auth, sandboxing, secrets, compliance                         |
| 15  | [Roadmap](./docs/15-roadmap.md)                     | Phased plan with deliverables                                 |
| 16  | [Offline & Sync](./docs/16-offline.md)              | Download, asset caching, conflict resolution, token semantics |

## Quick reference

- **Stack**: Nx monorepo · Angular 21 · Ionic (TBD) · Capacitor (TBD) · NestJS 11 · Prisma · PostgreSQL · Redis · Clerk · Stripe · Judge0 · Tiptap
- **UI**: Bootstrap (ng-bootstrap) for admin · Ionic for student · shared SCSS tokens
- **Hosting**: DigitalOcean (São Paulo) + Coolify · Cloudflare in front · DO Managed Postgres
- **Initial locales**: pt-BR, en-US (architecture supports more)
- **Initial content**: text + image (video pipeline deferred)

## Local dev

Prerequisites: Node 22+, pnpm 10+, Docker.

```bash
pnpm install               # Install workspace deps
pnpm db:up                 # Start Postgres + Redis (docker-compose.dev.yml)
cp .env.example .env       # Fill in Clerk / Stripe / R2 keys later
pnpm prisma:migrate        # Apply migrations to local DB
pnpm build                 # Build all 13 projects
pnpm nx serve api          # Run the NestJS API (http://localhost:3000)
pnpm nx serve admin        # Run the admin app
pnpm nx serve student      # Run the student app
```

Workspace layout:

```
apps/{admin,student,api}    Angular admin · Angular student · NestJS api
libs/                       Shared libs per docs/03-shared-libraries.md
prisma/                     Schema + migrations
docs/                       Specs (see index above)
```

### Typecheck notes

`pnpm nx run-many -t typecheck` runs `tsc --build --emitDeclarationOnly` per project, including the Angular ones. Two conventions keep it working alongside the Angular CLI build:

- Each project's `tsconfig.spec.json` uses `moduleResolution: bundler` with the `dom` lib and references its `tsconfig.lib.json` / `tsconfig.app.json`, so specs resolve `@angular/core/testing` and lib imports go through built declarations rather than re-compiling lib sources.
- Every project emits declarations into its own `dist/` (never a shared `dist/out-tsc`), otherwise `ui-bootstrap` and `ui-ionic` overwrite each other's `index.d.ts`.

Storybook configs (`.storybook/tsconfig.json`) are not composite projects and are intentionally left out of the `tsc --build` graph; stories are still linted and compiled by the Storybook build.

## Deploy & operations

Hosting, pipelines and runbooks are specified in [docs/13-deployment.md](./docs/13-deployment.md) (§9 CI/CD, §16 configuration reference, §17 verification) and set up step by step in [`infra/README.md`](./infra/README.md). Component/library ownership and review rules: [docs/19-component-ownership.md](./docs/19-component-ownership.md).

| Event                    | Workflow                                 | Result                                                                                                                                                 |
| ------------------------ | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Pull request             | `ci.yml`, `preview.yml`, `storybook.yml` | lint/test/typecheck/build, migrations + API smoke on Postgres, image build; preview URLs for both apps commented on the PR; Storybooks tested with axe |
| Push to default branch   | `staging.yml`                            | API image → migrate staging → Coolify → smoke; admin + student to staging Pages                                                                        |
| Tag `v*`                 | `release.yml`                            | approval in the `production` environment → migrate prod → Coolify → smoke → Pages → GitHub release                                                     |
| Tag `mobile-v*` / manual | `mobile.yml`                             | signed Android bundle → Play internal testing; iOS → TestFlight                                                                                        |

Workflows skip (with a job summary) whenever their secrets aren't configured, so forks stay green.

Common operations:

```bash
# API container (repo root as context)
docker build -f apps/api/Dockerfile -t codify-api .
docker run --rm -e DATABASE_URL=... codify-api prisma migrate deploy   # migrations
docker run --rm -p 3000:3000 -e DATABASE_URL=... codify-api            # server (/api/health)

# Frontend production build for a given API (+ Cloudflare Pages _headers)
bash infra/web/build-frontend.sh student https://api.staging.codify.app/api pages

# Ledger drift check against any database
DATABASE_URL=postgresql://... node tools/scripts/drift-check.mjs

# Load checks (API must be running; dev tokens → non-production API)
API_URL=http://localhost:3000/api node tools/load/league-sharding.mjs --users=1000
API_URL=http://localhost:3000/api node tools/load/submissions-p95.mjs
API_URL=http://localhost:3000/api node tools/load/ai-grading-p95.mjs
```

Infrastructure as code: `infra/terraform` (DigitalOcean droplets, firewalls, Managed Postgres; Cloudflare DNS, TLS, WAF, rate limits, Pages), `infra/judge0` (sandbox host), `infra/coolify` (api + worker + redis), `infra/observability` (Grafana Alloy, Sentry, uptime). Dependency updates: Renovate (`renovate.json`, weekly, grouped).
