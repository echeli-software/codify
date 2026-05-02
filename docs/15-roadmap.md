# 15 — Roadmap

Phases are sequenced for **dependency safety** and **engagement integrity** — atomic-design libraries before features, gamification before billing UX, server authority before client surfaces.

Estimates assume 2 senior full-stack engineers + 1 designer + 1 PM-ish role (the operator). Adjust to team reality.

## Phase 0 — Foundations (2–3 weeks)

**Goal**: a reproducible, deployable skeleton.

Deliverables:
- Nx monorepo created with empty `apps/admin`, `apps/student`, `apps/api`, all libs scaffolded as listed in [03-shared-libraries.md](./03-shared-libraries.md).
- Both apps boot to "Hello world", deploy to Cloudflare Pages preview on every PR.
- API boots, returns `/health`, deploys to staging via Coolify on `main`.
- Postgres + Redis running via `docker-compose.dev.yml`.
- Prisma initial migration with `User` + `AuditLog` only.
- Clerk wired in dev tenant; sign-in works in both apps.
- CI: lint, type-check, build, unit test scaffolded.
- Sentry, Grafana Cloud, structured logging in place.
- DO Droplets provisioned (app + Judge0 + staging) and Coolify installed.
- DO Managed Postgres (staging + prod) provisioned.
- Cloudflare DNS, TLS, WAF basics live.

**Acceptance**:
- ✅ A PR opened by a contributor produces a preview URL for both apps.
- ✅ Pushing to `main` deploys to staging and runs migrations.
- ✅ Tagging `v0.0.1` deploys to prod with a manual approval gate.

## Phase 1 — Tokens, ui-core, i18n (1–2 weeks)

**Goal**: design system + i18n foundations.

Deliverables:
- `libs/ui-tokens` complete (color, spacing, type, shadow, motion, breakpoints).
- Bootstrap variable map and Ionic CSS-var map in place.
- Light + dark themes verified on both apps with a demo page.
- `libs/ui-core` formatters + level math (100% test coverage).
- `libs/i18n` provider, ngx-translate set up with pt-BR and en-US chrome strings for `common`/`gamification`/`time`/`billing` namespaces.
- Locale switcher in both apps; persisted on `User.locale`.

**Acceptance**:
- ✅ Theme switcher live on both apps.
- ✅ Locale switcher live; chrome strings flip immediately; `<html lang/dir>` updates.
- ✅ Storybook page documents tokens.
- ✅ Lint rule blocks raw string literals in templates.

## Phase 2 — Atomic component build, admin (`ui-bootstrap`) (3–4 weeks)

**Goal**: complete Bootstrap component catalog before any admin feature.

Deliverables:
- All atoms, molecules, organisms listed in [03-shared-libraries.md](./03-shared-libraries.md) for `ui-bootstrap`.
- Storybook with every variant.
- A11y check (axe) passes on every component.
- A demo "Course list" page and demo "Lesson editor" shell page in `apps/admin`, built using only `ui-bootstrap` + tokens.

**Acceptance**:
- ✅ Storybook URL deployed and reviewed by design.
- ✅ Two demo pages signed off.
- ✅ Component ownership matrix written (who owns each component for evolution).

## Phase 3 — Atomic component build, student (`ui-ionic`) + gamification engine (4–5 weeks)

**Goal**: student component catalog + reward orchestration before features.

Deliverables (in parallel):
- All atoms, molecules, organisms listed in [03-shared-libraries.md](./03-shared-libraries.md) for `ui-ionic`.
- `AvatarRenderer` shared component + sample base bodies + a few items.
- `libs/gamification-engine`: `RewardOrchestrator`, `XpService`, `CoinService`, `StreakService`, animation primitives (coin-fly, confetti, level-up, badge unlock), sound + haptic wrappers.
- Storybook for student components on web build.
- A demo "Today" page and demo "Lesson player" page in `apps/student`, built using only `ui-ionic` + tokens + engine.
- Reduced-motion + reduced-sound preferences respected end-to-end.
- Responsive verification at xs/sm/md/lg/xl breakpoints (catalog-style and lesson-style demo pages).

**Acceptance**:
- ✅ Storybook URL deployed.
- ✅ Two demo pages signed off; mobile + desktop layouts both reviewed.
- ✅ "RewardOrchestrator demo" page plays each reward kind with deterministic seed.
- ✅ Lint rule enforces all reward calls go through `RewardOrchestrator`.

## Phase 4 — Auth + base shells + content schema (1–2 weeks)

**Goal**: real auth + role guards + lesson schema usable.

Deliverables:
- `libs/auth` complete: signals, guards, role directive.
- AppShell organisms wired in both apps with sidebar/tabs adapting per breakpoint (student) and persistent sidebar (admin).
- Profile basics in both apps (display name, locale, theme).
- `libs/lesson-schema` complete: types, zod validator, Tiptap extensions, renderer protocol, migration scaffolding.
- API: User module (CRUD limited), AuditLog wiring, auth middleware, JWT verification.

**Acceptance**:
- ✅ Sign in → land in app → sign out works on both.
- ✅ Role-protected route blocks unauthorized users.
- ✅ A v1 `LessonDoc` round-trips through schema validator and migrator.

## Phase 5 — Course delivery MVP (3–4 weeks)

**Goal**: teacher creates content; student consumes.

Deliverables:
- API: Course / Module / Lesson CRUD, Category CRUD, draft/publish flow, `Progress` tracking, `Enrollment` model, free-flag enforcement.
- Admin: Catalog screens (Courses list, detail, curriculum), `LessonBlockEditor` with Tiptap + custom blocks (paragraph, heading, code, callout, image, embed, divider, table, quiz, ai-prompt placeholder, exerciseRef placeholder), Categories screen.
- Student: Catalog browse + filter, Course detail with curriculum, Lesson player rendering reading + quiz blocks, basic Progress recording.
- `ContentTranslation` table live; admin Translation workspace minimum (per-entity inline edit; outdated flag).
- Asset upload pipeline (R2 + CDN).

**Acceptance**:
- ✅ Non-developer creates a 3-lesson course in < 20 minutes.
- ✅ Student sees the course, completes a free lesson, sees "subscribe to continue" paywall on a non-free lesson.
- ✅ Translation completeness % shown per locale per entity.

## Phase 5b — Offline reading + queued completions (1.5 weeks)

**Goal**: student app survives disconnection without losing progress. See [16-offline.md](./16-offline.md).

Deliverables:
- Service worker (PWA) + IndexedDB plumbing in `apps/student`.
- Cached identity bundle on sign-in (user, locale, level, XP, coin balance, owned items, active subscription, avatar config).
- `OfflineEventQueue` (IndexedDB) with FIFO flush + idempotency-key generation per event.
- Conflict reconciliation: server enforces `Progress (userId, lessonId)` uniqueness; client handles `409` by removing from queue and reconciling state.
- Reading + quiz + scenario lessons playable offline (graded locally; rewards queued).
- Capability gating in UI: exercise / AI prompt / shop / social / payments visibly disabled offline with friendly explanations.
- Token-expired-offline behavior: cached identity stays valid for reads; sync queue blocks until same-user re-sign-in. Different-user sign-in discards queue with explanatory toast.
- Streak grace via `clientTimestamp` normalized to user-local TZ on the server.
- Offline indicator chip in header + "Sync now" affordance.

**Acceptance**:
- ✅ Airplane-mode test: sign in online → enable airplane mode → complete 3 cached lessons → re-enable network → all 3 sync, XP/coins/streak credited once.
- ✅ Two-device test: same lesson completed offline on Device A and Device B; first to sync wins, second gets `409` and reconciles cleanly.
- ✅ Token-revoked test: revoke session server-side, return to online, re-sign-in same user → queue flushes; sign in different user → queue discarded.
- ✅ Streak attribution test: complete a lesson at 23:55 local while offline, sync at 00:30 → counts for the prior day.

## Phase 6 — Categories, plans, Stripe (3 weeks)

**Goal**: monetization end-to-end.

Deliverables:
- `Plan`, `PlanPrice`, `PlanCategory` admin screens.
- "Sync to Stripe" creates Stripe Product + Prices.
- API: `BillingProvider` abstraction + Stripe implementation.
- Stripe Checkout integration: card, PIX, Boleto for one-shot annual prepay.
- Subscription webhooks (created/updated/deleted, invoice paid/failed, async PIX success).
- Customer Portal link.
- Access control via `libs/domain/access` enforced server-side and used by client UI.
- Student: Subscription screen, paywall sheet listing plans-that-include-the-course, plan picker, checkout flow.
- "Plans including this course" rendered on course detail.

**Acceptance**:
- ✅ Student subscribes via card with installments in < 90 seconds (mobile).
- ✅ Student subscribes via PIX, sees QR, pays in test, gets access within 30s of webhook.
- ✅ Admin can change a plan's category set and access updates immediately for affected users.
- ✅ Cancellation flow has no dark patterns; retest with design.

## Phase 7 — Gamification core (3–4 weeks)

**Goal**: XP, coins, multipliers, streaks, badges, daily quests, level-ups all live.

Deliverables:
- API: `XpEvent` + `CoinTransaction` + `Streak` + `Multiplier` + `Badge` + `UserBadge` + `QuestTemplate` + `QuestAssignment`.
- `libs/domain/multipliers.resolveMultiplier` complete; admin `MultiplierEditor` and `Promotions` screens.
- Server-authoritative grant pipeline: `GamificationService.grantReward(...)`.
- Daily quest assignment job (midnight per user TZ).
- Badge evaluator job (post-event).
- Streak save + freeze logic, including notification scheduling.
- Student: streak chip, XP bar, coin counter live with animations through `RewardOrchestrator`. Daily quests on Today. Level-up + badge-unlock overlays.
- Admin: gamification defaults panel, badge editor, quest template editor.

**Acceptance**:
- ✅ Lesson complete → server returns canonical reward → client plays animation in < 50ms after response.
- ✅ Multiplier breakdown UI shows correct math for premium × course-promo × streak.
- ✅ Drift check passes nightly (coin balance == sum of transactions).
- ✅ Streak freeze auto-applies on missed day; never auto-deducts beyond banked.

## Phase 8 — Avatar + shop (2–3 weeks)

**Goal**: cosmetic loop live; first batch of items shipped.

Deliverables:
- API: `Item`, `UserItem`, `EquippedItem`, item purchase endpoint with idempotency.
- Admin: Items + Item Categories screens; sprite upload + preview; limited-drop scheduler.
- Student: Avatar dressing room, Shop, Inventory, premium-only badge, limited-drop section + countdown, push notifications for drops.
- First batch of ~60 items produced (see [08-avatar-and-shop.md §16](./08-avatar-and-shop.md)).
- Avatar visible in profile, leaderboard placeholder, Today header.

**Acceptance**:
- ✅ User can preview any item on dressing room without buying ("Try on").
- ✅ Buying debits coin balance, adds to inventory, optionally equips. Atomic.
- ✅ Reduced-motion mode disables equip animations but UX still works.

## Phase 8b — Download + asset caching (1 week)

**Goal**: explicit download UX + complete offline asset story. See [16-offline.md](./16-offline.md).

Deliverables:
- "Download" button on course / module / lesson surfaces with progress + pause/resume/cancel.
- Settings → Downloads screen: per-course size, total used vs budget, last-updated, "Update" / "Remove" / "Sync now".
- Storage budget cap (default 1 GB, configurable) with LRU eviction by `lastReadAt`.
- Wi-Fi-only and auto-update toggles.
- Auto-download enrolled courses (opt-in) for free + first paid module.
- Asset prefetch on sign-in: avatar config, base body, equipped item sprites, owned-item sprites, owned badge icons.
- Per-locale `ContentTranslation` prefetch alongside lesson download.
- Download includes: `LessonDoc` JSON, inline images, quiz keys, scenario trees, exercise stubs (no solutions, no hidden tests).
- "Update available" indicator when a downloaded lesson's source content changed.
- Telemetry: download/sync events, storage/eviction metrics.

**Acceptance**:
- ✅ Download a 12-lesson course → go offline → all 12 readable; quiz lessons playable; exercise lessons surface "Connect to run code" inline.
- ✅ Avatar (config + equipped items) renders offline even after course downloads are evicted.
- ✅ Wi-Fi-only mode pauses an in-progress cellular download; resumes on Wi-Fi reconnect.
- ✅ Updating a published lesson in admin causes "Update available" to appear on the student's downloaded course; tapping update re-fetches only the changed lessons.
- ✅ Storage budget enforced: hitting cap evicts least-recently-read course before allowing a new download (with user prompt).

## Phase 9 — Leagues + social (2 weeks)

**Goal**: weekly cohort competition + minimal friends.

Deliverables:
- API: League rollover job (Sunday 23:59 UTC), `LeagueMembership` weekly XP accumulation.
- Student: League screen, current rank, time-to-reset, virtualized leaderboard, promotion/demotion summary at week roll, weekly result push.
- Friends MVP: add by email + share link, friend requests inbox, nudge button (rate-limited).
- Profile pages with avatar, badges, level, stats.

**Acceptance**:
- ✅ Cohort sharding produces ~30-person groups; verified at 1k synthetic users.
- ✅ Promotion event awards expected XP/coins/freeze atomically.
- ✅ Nudge sends a single push, respects rate limit.

## Phase 10 — Programming exercises (4–6 weeks)

**Goal**: real coding lessons with auto-graded feedback.

Deliverables:
- Judge0 self-hosted on dedicated VPS (per [12-code-execution.md](./12-code-execution.md)).
- API: `Exercise`, `Submission`, submission worker, language whitelist (JS/TS/Python initially).
- Admin: Exercise editor (Monaco), test harness fields, "verify reference solution" tool.
- Student: `ExerciseRunner` integrated into `LessonPlayer` for `EXERCISE` lessons.
- Reward path: first-time pass → full XP/coins via `RewardOrchestrator`.

**Acceptance**:
- ✅ p95 submission turnaround < 4s under realistic load.
- ✅ Visible vs hidden test separation works as specified.
- ✅ Sandbox enforces limits; intentionally hostile submissions caught (fork bomb, infinite loop, network attempt).
- ✅ A 5-lesson Python course shipped end-to-end as a dogfood.

## Phase 11 — Mobile builds + IAP via RevenueCat (2–3 weeks)

**Goal**: store presence + native billing.

Deliverables:
- iOS + Android builds via Capacitor, signed in CI.
- TestFlight + Play Internal Testing live.
- RevenueCat integration: products mirror Stripe plans; entitlement webhook syncs to `Subscription`.
- Push notifications via FCM/APNs end-to-end.
- Haptics live on mobile for all reward events.
- Store listings (icon, screenshots, description, ratings, privacy disclosure).
- App submission to App Store + Play.

**Acceptance**:
- ✅ Subscribe via App Store IAP → entitlement created in our DB → access granted.
- ✅ Push notification arrives on a real device for streak reminder.
- ✅ Apps approved.

## Phase 12 — AI-prompt grading + scenario lessons (3–4 weeks)

**Goal**: differentiator content types live.

Deliverables:
- API: `ai-grading` module with deterministic + LLM-judged rubric scoring; per-user rate limits; caching.
- Admin: AI prompt block editor with rubric builder.
- Student: `AiPromptPlayground` with rubric checklist that lights up.
- API + admin + student: scenario block + `ScenarioRunner` (branching dialogue).

**Acceptance**:
- ✅ AI prompt lesson grades within 3s p95.
- ✅ Scenario lesson supports 2+ branch depth and replay.
- ✅ A soft-skill course (4 scenarios) shipped as dogfood.

## Phase 13 — Marketing site, capstone projects, certificates (2–3 weeks)

**Goal**: top-of-funnel + social proof.

Deliverables:
- Public marketing site (`codify.app` root pages).
- "Capstone project" lesson type (a curated multi-lesson capstone with shareable result).
- Certificate of completion: branded image + verifiable URL on user profile.
- Referral / share links.

## Future (post-launch backlog)

- Cloudflare Stream video pipeline + video lessons.
- Cohort challenges (group-based, opt-in).
- Pet evolution / item recoloring.
- Marketplace for outside teachers (revenue share).
- Enterprise / team licensing.
- Advanced search (Meilisearch).
- Apple Watch / Wear OS minimal companions.
- Feature-flag service migration to GrowthBook/Unleash if needed.

## Cross-cutting workstreams (always on)

| Workstream | Owner | Cadence |
|---|---|---|
| Engagement instrumentation | PM + FE | Each phase |
| A/B test review | PM | Bi-weekly |
| Cost monitoring | Ops | Monthly |
| Dependency upgrades | Renovate + 1 dev | Weekly |
| Security drill | Ops | Quarterly |
| Backup restore drill | Ops | Quarterly |
| Translation catch-up | Content + agency | Monthly per locale |
| Asset production for shop | Designer | Continuous |

## Risk & dependency map

| Risk | Mitigation phase |
|---|---|
| Engagement loop fails | Phase 7 + Phase 9 land before paid push; instrument retention from Phase 5 |
| Stripe BR PIX-recurring limitations | Phase 6 ships card-first + PIX one-shot; revisit recurring PIX with Pagar.me later |
| Judge0 compromise | Phase 10 isolates VPS, locks egress, adds drift monitor |
| App Store rejection | Phase 11 adheres to IAP rules from day 1 (no external payment links from inside app for digital subs) |
| Over-engineering shared libs | Atomic phases (2, 3) gated on demo-page sign-off, not on "every conceivable component" — ship Phase 5 with 90% of components, add the remaining 10% on demand |

## Definition of done (every phase)

- All deliverables shipped to staging and exercised end-to-end.
- Tests written for new pure logic (`libs/domain`, `libs/ui-core`, gamification math).
- Telemetry events instrumented for new user-facing flows.
- Translations present for all new chrome strings in pt-BR + en-US.
- Storybook updated for new components.
- Migration applied cleanly to staging without manual intervention.
- Phase retro: what surprised us, what we'd defer next time.
- Promoted to prod with manual gate.
