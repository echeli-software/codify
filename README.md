# Codify

> **Codify** (working title) is a gamified, multi-language learning platform for programming, AI usage in software development, IT career skills, and related soft skills. Mobile-first via Ionic + Capacitor, with a separate Bootstrap-based web admin for teachers and ops.

## Documentation index

Specs live under [`docs/`](./docs). Read in order on first pass; cross-references are absolute paths from the repo root.

| # | File | Purpose |
|---|------|---------|
| 00 | [Vision & Goals](./docs/00-vision.md) | Mission, audience, success metrics, non-goals |
| 01 | [Architecture](./docs/01-architecture.md) | Monorepo layout, tech stack, system topology |
| 02 | [Data Model](./docs/02-data-model.md) | Prisma schema and entity descriptions |
| 03 | [Shared Libraries](./docs/03-shared-libraries.md) | Atomic component inventory, all libs |
| 04 | [Admin App](./docs/04-admin-app.md) | Admin (Bootstrap) screens, flows, permissions |
| 05 | [Student App](./docs/05-student-app.md) | Student (Ionic) screens, responsive layout |
| 06 | [Content Authoring](./docs/06-content-authoring.md) | Tiptap block schema, lesson rendering |
| 07 | [Gamification](./docs/07-gamification.md) | XP, coins, multipliers, streaks, badges, leagues |
| 08 | [Avatar & Shop](./docs/08-avatar-and-shop.md) | 2D avatar system, items, dressing room |
| 09 | [Billing](./docs/09-billing.md) | Stripe, plans, categories, access control |
| 10 | [Engagement](./docs/10-engagement.md) | Onboarding, notifications, animations, anti-patterns |
| 11 | [i18n](./docs/11-i18n.md) | Localization, content translation, RTL |
| 12 | [Code Execution](./docs/12-code-execution.md) | Self-hosted Judge0, exercise runner |
| 13 | [Deployment](./docs/13-deployment.md) | VPS, Coolify, Cloudflare, CI/CD |
| 14 | [Security](./docs/14-security.md) | Auth, sandboxing, secrets, compliance |
| 15 | [Roadmap](./docs/15-roadmap.md) | Phased plan with deliverables |
| 16 | [Offline & Sync](./docs/16-offline.md) | Download, asset caching, conflict resolution, token semantics |

## Quick reference

- **Stack**: Nx monorepo · Angular 18+ · Ionic 8 · Capacitor 6 · NestJS · Prisma · PostgreSQL · Redis · Clerk · Stripe · Judge0 · Tiptap
- **UI**: Bootstrap (ng-bootstrap) for admin · Ionic for student · shared SCSS tokens
- **Hosting**: DigitalOcean (São Paulo) + Coolify · Cloudflare in front · DO Managed Postgres
- **Initial locales**: pt-BR, en-US (architecture supports more)
- **Initial content**: text + image (video pipeline deferred)
