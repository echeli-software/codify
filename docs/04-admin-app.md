# 04 — Admin App

Angular SPA at `admin.codify.app`. Bootstrap-themed via `ui-bootstrap` + tokens. No public sign-up — accounts are provisioned by an existing admin (or via Clerk invitation).

## 1. Roles & permissions

| Role      | Authoring        | Catalog ops | Billing               | Users                                     | Items / Shop | Promotions / Multipliers          | Audit            |
| --------- | ---------------- | ----------- | --------------------- | ----------------------------------------- | ------------ | --------------------------------- | ---------------- |
| `TEACHER` | Own courses only | View own    | –                     | View own course enrollments (anonymized)  | –            | View own course-level multipliers | View own actions |
| `SUPPORT` | –                | View        | View, refund (capped) | View, suspend, manual coin grant (capped) | View         | –                                 | View             |
| `ADMIN`   | All              | All         | All                   | All                                       | All          | All                               | All              |

Permissions enforced server-side. Client uses `*codifyIfRole` directive for UI gating only.

## 2. Information architecture

```
Sidebar
├── Dashboard
├── Catalog
│   ├── Courses
│   ├── Categories
│   └── Promotions     (Multipliers + Campaigns)
├── Plans
├── Shop
│   ├── Items
│   └── Item Categories
├── Gamification
│   ├── Badges
│   ├── Quest Templates
│   └── Leagues
├── Users
├── Translations
├── Analytics
├── Audit
└── Settings
```

`TEACHER` sees: `Dashboard`, `Catalog → Courses` (own), `Translations` (own), `Analytics` (own).

## 3. Screens

### Dashboard

- KPI cards (admin scope): WAU, MAU, paid conversions this week, active subscriptions, MRR (BRL), top 5 courses by completion.
- Teacher scope: own course enrollments today, top lessons by drop-off, pending translations.
- Recent audit activity (last 20 actions).
- Coolify deploy status indicator (read-only, off `GITHUB_API` build webhook last result).

### Catalog → Courses (list)

- DataTable: cover, title (in admin's locale), author, status, categories chips, lesson count, published date, actions menu.
- Filters: status, category, author, "has missing translations".
- Bulk actions: publish, archive, change category.
- "+ New course" button → wizard (basics → categories → first module).

### Catalog → Course (detail / editor)

Tabs:

1. **Overview**
   - Title, slug, cover (`ImageCropper` + `AssetPicker`), source locale, difficulty 1–5, estimated duration, status, publish/archive controls.
   - Categories (multi-select) — saving updates the `coursesIncludedInPlan` resolver immediately.
   - "Plans including this course" read-only chip list (computed from plan-category bindings).
2. **Curriculum**
   - Drag-to-reorder modules (collapsible) → lessons inside.
   - Each lesson: type icon, title, free toggle, est. minutes, "edit" / "duplicate" / "delete".
   - Bulk: mark first N lessons free (sets `lesson.isFree = true` on those rows; revertible). There is no separate "preview window" field — gating is uniformly `lesson.isFree`.
3. **Lessons (block editor)** — opened from a curriculum row. Full-screen.
   - `LessonBlockEditor` (Tiptap host).
   - Side panel: lesson properties (`type`, `isFree`, `baseXp`, `baseCoins`, `estimatedMinutes`, optional `Exercise` link, `Multiplier` rules attached to this lesson).
   - "Preview as student" button → opens read-only `LessonBlockRenderer` in a modal at mobile + desktop sizes.
   - Save = autosave every 5s + explicit save button. Versioning: each save bumps a `versionNumber` in a per-lesson revision table (not in initial schema; add when the team needs it).
4. **Promotions**
   - List of multipliers attached at course or lesson level.
   - "+ Add" → `MultiplierEditor` (kind, target XP/COINS/BOTH, value, time window, optional lesson within course).
5. **Translations** — see "Translations" screen.
6. **Analytics**
   - Funnel: enrolled → started → 50% → completed.
   - Drop-off heatmap per lesson.
   - Free → paid conversion attributable to this course (via `EnrollmentSource`).
7. **Audit** — last 100 actions on this course.

### Catalog → Categories

- Simple list. Slug, color token, icon, sortOrder.
- Reorder by drag.
- Click → edit translations + assign to plans (matrix view).

### Catalog → Promotions

- All multipliers across the catalog, filterable by kind / time window.
- Calendar view (week/month) showing active windows for `CAMPAIGN` and `COURSE_PROMO`.
- Quick "Activate now for 24h" button on rows.
- Effective preview: pick a user + lesson, show resolver breakdown (`PREMIUM_DEFAULT × COURSE_PROMO × STREAK_TIER = 6.0x`). Drives trust in the system.

### Plans

- List: name, all-access flag, prices in BRL/USD, billing period, included categories chips, active toggle, sortOrder.
- Detail tabs:
  - **Basics**: name, slug, all-access, sortOrder.
  - **Pricing**: per (currency × period) row with `amountCents`, `maxInstallments`. "Sync to Stripe" creates the Product + Prices via API call (admin must confirm — destructive in prod).
  - **Categories**: matrix toggle.
  - **Translations**.

### Shop → Items

- DataTable: thumbnail, slug, slot, category, rarity, costCoins, requiredLevel, premiumOnly badge, drop window, active toggle.
- Detail:
  - Sprite upload (`AssetPicker`, accepts SVG, validates dimensions and slot anchor).
  - Live preview via `ItemSpritePreview` over a sample avatar.
  - Cost / required level / premium-only / limited-drop window.
  - Translations.
- "Schedule limited drop" wizard: pick items, set window, set notification copy.

### Shop → Item Categories

- Slug, sortOrder, translations. Used for shop filtering in student.

### Gamification → Badges

- List + create. Each badge: slug, icon, hidden flag, rule JSON (with helper builder for common rules).
- "Test" button: pick a user, simulate, see if the badge would unlock.
- Translations.

### Gamification → Quest Templates

- List: kind, target, params, rewards, active.
- Detail: rewards (xp + coins), kind-specific config (e.g. `categorySlug` for `CATEGORY_LESSON_COUNT`).
- "Daily mix" planner: define how many quests per day are drawn from this pool and at what weight.

### Gamification → Leagues

- Configuration of tier promotion/relegation thresholds.
- This week's snapshot: leagues per tier, member count, p50/p95 weekly XP.
- Drill into any league → list members + ranks.

### Users

- DataTable with filters (role, locale, country, last seen, subscription status).
- Detail tabs:
  - **Profile**: read-only (Clerk-managed), avatar preview, level, XP, coin balance, current streak.
  - **Subscriptions**: active + history; refund or cancel at period end (capped for `SUPPORT`).
  - **Enrollments**: courses + progress; manual GIFT enrollment.
  - **Inventory**: items owned; manual grant (with audit reason).
  - **Coin / XP ledger**: paged transactions with delta + balance after.
  - **Manual grant**: form (amount, source = `ADMIN_GRANT`, reason). Rate-limited per admin/day.
  - **Suspend / unsuspend**: sets `User.suspendedAt` + a staff-only reason (the API then refuses the account with `ACCOUNT_SUSPENDED`); ADMIN and SUPPORT, SUPPORT only for student/teacher accounts; audited. Shown with the account's deletion / purge state and its payments in `<cdf-user-account-panel>` (see docs/14 §13.1). When Clerk is configured (`CLERK_SECRET_KEY`) the user is also banned / unbanned at Clerk (Backend API `POST /v1/users/{id}/ban` / `/unban`; users without a Clerk id — dev tokens — are skipped). A Clerk failure keeps the local change, is audited as `user.idp_sync_failed` and shows a warning toast.
  - **Audit**: actions performed on this user.

### Translations

- Workspace view: pick locale → pick entity type → list of entities with translation completeness % and per-field status (missing/outdated/done).
- Inline editor side-by-side with source locale.
- "Outdated" flag set when source content changed after last translation.
- Bulk export/import as CSV or JSON for outsourced translation.

### Analytics

- Cross-cutting dashboards: retention curves, league participation, shop revenue (coins spent), MRR, churn cohort.
- Read-only — built on top of the API's analytics endpoints (precomputed nightly).

### Audit

- Filter by actor, action, entity type, time. Export.

### Settings

- Branding (color tokens overridable per environment for staging visibility).
- Default coin rates and `PREMIUM_DEFAULT` multiplier value (writes a `Multiplier` row).
- Streak tier thresholds and bonuses.
- Notification template defaults.
- Locale enable/disable.
- Stripe connection status; webhook URL display + signing secret rotation. (Implemented as a read-only card: whether `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` and `REVENUECAT_WEBHOOK_AUTH` are set, plus the webhook endpoint; rotation happens in the Stripe dashboard + deployment environment.)
- Feature flags (e.g. `leagues.enabled`, `shop.enabled`): table + create/edit (enabled, active, rollout %, holdout %, weighted variants, surface, description) + delete with confirm; ADMIN only. See docs/10 §9.

## 4. Layout & responsive

- Desktop ≥ 1024px: persistent sidebar (240px), topbar (56px), content (max-width 1440px, gutters).
- Tablet 768–1023: collapsible sidebar (icons only by default).
- Mobile < 768: drawer-style sidebar; admin not optimized for phone but must remain usable for "approve/refund on the go" tasks.

## 5. Forms & autosave

- Reactive forms with zod validation via a shared `zodControlAdapter`.
- Autosave on lesson editor (5s debounce, visible "Saved at HH:MM:SS").
  Implemented in `core/autosave.ts`: every edit restarts the 5 s timer; no
  autosave while the title is empty or while the API's last content
  rejection (`issues`) still applies; edits made during an in-flight save
  stay dirty and get their own autosave; the unsaved-changes guard follows
  `dirty`. The status line shows Saving… / Saved at HH:MM:SS (locale time) /
  paused / failed.
- All other forms: explicit save with optimistic UI + rollback on error.
- Unsaved-changes guard on route navigation.

## 6. Search

- Top-bar global search (Cmd/Ctrl-K). Searches courses, lessons, users, items, badges by name + slug.
- Initial: Postgres `tsvector` + `tsquery` per entity. Migrate to Meilisearch if latency or relevance becomes a problem.
- Shipped: `GET /api/admin/search?q=` (2–100 chars, staff) — case-insensitive
  substring (`ILIKE`) on course/lesson titles (ContentTranslation, any locale)
  and slugs, user email/name, item and badge name/slug, plus exact ids; ≤ 5
  hits per type. Scope by role: TEACHER own courses + lessons; SUPPORT
  courses + users; ADMIN everything. The palette (`core/search-palette.ts`)
  is a modal combobox: ↑/↓, Enter opens, Esc closes, focus returns.

## 7. Theming & accessibility

- Light + dark themes from `ui-tokens`. User preference per-account, persisted.
- All interactive elements keyboard-reachable; `Esc` closes modals; `Tab` order manually verified on lesson editor.
- High-contrast mode via tokens override.

## 8. Telemetry

- Page view tracking (route + role + locale).
- Feature events: `course.created`, `lesson.published`, `multiplier.created`, `user.suspended`, `coins.granted`, `translation.completed`.
- All admin actions also emit `AuditLog` rows server-side.
- Implementation (`core/telemetry.ts`): events go through the analytics ingest
  (`POST /api/analytics/events`, platform `admin-web`) in batches of ≤ 20 or
  every 5 s, never awaited by the UI; a failed batch is dropped. Every event
  carries `role` + `locale`. Names are snake_case (ingest rule):
  `admin_page_view {route}` (route pattern, e.g. `/users/:id`),
  `course_created`, `course_published` (lessons go live with their course —
  there is no lesson-level publish, so this stands in for `lesson.published`),
  `multiplier_created`, `user_suspended`, `coins_granted`,
  `translation_completed {count}`. Feature events come from an HTTP
  interceptor on successful mutations, so every page reports them.

## 9. Empty / error states

- Every list has an `EmptyState` with a primary CTA ("+ New course").
- Every async area has skeletons during load and a typed error state with retry.
- Permission-denied states explain _which role_ would be required.

## 10. Admin operations API

All under `/api/admin`, RFC 7807 errors, mutations audited.

| Method + path                                                        | Roles                                        | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| -------------------------------------------------------------------- | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /dashboard`                                                     | ADMIN, SUPPORT, TEACHER                      | `{ scope, generatedAt, weekStart, admin, teacher, recentActivity[20] }`. Admin: `wau`/`mau` (distinct students with `lastSeenAt` or an analytics event in 7/30 d), `paidConversionsThisWeek` (users whose first non-admin-grant subscription past trial/checkout was created since UTC Monday), `activeSubscriptions` (paid sources, ACTIVE + PAST_DUE), `trialingSubscriptions`, `mrr { currency: 'BRL', amountCents, excludedSubscriptions }` (BRL plan price for the subscription's period — store product price, else inferred from period length; annual ÷ 12; plans without a BRL price are excluded and counted, no FX), `topCourses` (published, by learners who completed every lesson). Teacher: `enrollmentsToday` (UTC day) + per course, `topDropOffLessons` (last 30 d: learners with `lesson_open` vs Progress), `pendingTranslations` (missing + outdated fields). Recent activity: teachers see only their own. |
| `GET /search?q=`                                                     | staff                                        | See §6.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `GET /audit?actorId&action&entityType&entityId&from&to&cursor&limit` | ADMIN, SUPPORT, TEACHER (own actions forced) | `action` is a prefix match; keyset cursor; `{ items, nextCursor }`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `GET /audit/export` (same filters)                                   | same                                         | `text/csv`, newest first, capped at 10 000 rows; `X-Export-Rows`, `X-Export-Truncated`. Formula-leading cells are prefixed with `'`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `GET /leagues/snapshot?weekStart=`                                   | ADMIN                                        | Per tier: leagues, members, p50/p95 weekly XP (nearest rank); cohorts; `rules` (zone sizes from `@codify/domain`, rewards from GamificationConfig `league.promotionReward` / `league.rank1Reward`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `GET /leagues/:id`                                                   | ADMIN                                        | Members ranked as the rollover ranks them, projected `zone`, stored `finalRank`/`promoted`/`demoted`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `GET /users/:id/items`                                               | ADMIN, SUPPORT                               | Inventory with `equipped`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `POST /users/:id/items { itemId, reason }`                           | ADMIN                                        | Grants with `ADMIN_GRANT` (201, audited `user.item_grant`); already owned → 200 `{ alreadyOwned: true }`, nothing written.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `GET /users/:id/ledger?type=coins\|xp&cursor&limit`                  | ADMIN, SUPPORT                               | `{ type, balance, items: [{ delta, balanceAfter, source, multiplier, refType, refId }], nextCursor }`. XP `balanceAfter` is the running journal sum.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `POST /badges/:id/test { userId }`                                   | ADMIN                                        | `{ wouldUnlock, alreadyEarned, awardedAt, badgeActive, mode, clauses[], events, metrics }` from the badge engine; awards nothing.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `GET/POST /item-categories`, `PATCH/DELETE /item-categories/:slug`   | ADMIN                                        | Slug immutable; delete refused with `ITEM_CATEGORY_IN_USE` while items reference it. Names are single-locale (ItemCategory is not a TranslatableEntity).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `PATCH /users/:id/role { role, reason? }`                            | ADMIN                                        | Staff role change (docs/14 §2, §11). `role` ∈ STUDENT, TEACHER, SUPPORT, ADMIN; `reason` ≤ 500 chars. Response `{ id, email, displayName, role, previousRole, changed }`; same role → `changed: false`, nothing written. `403 ROLE_CHANGE_SELF` on your own account (so an ADMIN always remains), `404` unknown/purged user, `409 ROLE_CHANGED_CONCURRENTLY` if it changed meanwhile. Audited `user.role_changed` with `diff.before.role`, `diff.after.role`, `diff.reason`. Takes effect on the user's next request (roles are read from the DB, never from Clerk claims).                                                                                                                                                                                                                                                                                                                                                      |

`GET /api/users` also accepts `locale`, `lastSeenFrom`, `lastSeenTo` (ISO)
and `subscriptionStatus` (a SubscriptionStatus, or `NONE` = never
subscribed). There is no country column, so the "country" filter is not
offered.

## 11. Out of scope (initial)

- Multi-author collaboration on a single lesson (locking only — last write wins with autosave conflict warning).
- Course bundling separate from plans (consider after launch).
- Coupons / promo codes for new subscribers (Stripe supports natively; we surface in admin in a later phase).
- Manual review queue for flagged content (moderation tooling — later).

## 12. Staff tools (as built)

**Typed confirmation** (docs/14 §18): on the user detail, suspend, role change, refunds and manual grants open the confirm dialog with `typeToConfirm` = the user's email; the confirm button stays disabled until it matches. The terms announcement asks for its version string.

**Users → detail**

- **Profile → Role** (ADMIN, never on your own account): select + optional reason → `PATCH /admin/users/:id/role { role, reason? }` (audited `user.role_changed`).
- **Coin / XP ledger → Manual grant** (ADMIN, SUPPORT): coins (SUPPORT ≤ 1,000 per grant) and XP (ADMIN only) + reason; shows what you granted today against your daily limit; the ledger reloads with the `ADMIN_GRANT` row.
- **Account → Payments → Refund** (SUPPORT, ADMIN; web payments only — App Store / Google Play rows say to refund in the store): amount (default: what is left), reason, typed confirmation; SUPPORT is told about the one-month cap and the API enforces it (docs/09 §5).

**Analytics** (ADMIN; TEACHER sees only the Courses tab): Overview — MRR (BRL), trial → paid, ARPPU and refund rate per currency, MRR by plan, new / churned / net new per week, retention by signup cohort (D1 / D7 / D30), league participation and shop coins per week; every chart sits next to a table with the same data. Courses — enrolled → started → completed per course and per-lesson completions / drop-off. Events — the raw event counts (unchanged).

**Exercise health** (`/exercise-health`, ADMIN; docs/12 §11): per exercise learners, attempts, pass rate, mean attempts to pass, failures by verdict and the three most failed tests (from `Submission.resultJson`); "Re-test all <language> exercises" queues a run of every reference solution through the executor (`ExercisesService.verifyReference`, one job at a time per API instance) and lists the jobs with per-exercise results (polled while running; finished jobs are kept in the audit log as `exercise.bulk_retest`).

**Settings**: the flags section shows the experiment policy (global hold-out %, experiments per surface in priority order, an "Experiment" badge per flag — docs/10 §9) and a **System announcements** card that sends the SYSTEM terms-update notice (docs/10 §3).

| Method + path                                                                           | Roles                                                        | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `POST /admin/users/:id/grants { coins?, xp?, reason }`                                  | ADMIN, SUPPORT                                               | 201 `{ userId, coins, xp, before { coins, totalXp }, after, remainingToday }`. Through `grantReward` (`ADMIN_GRANT`, flat). SUPPORT: coins ≤ 1,000 (`403 GRANT_CAP_EXCEEDED`), no XP (`403 INSUFFICIENT_ROLE`). Daily per-actor limit (UTC day) `GRANT_DAILY_COIN_LIMIT_SUPPORT` (3,000), `GRANT_DAILY_COIN_LIMIT_ADMIN` (50,000), `GRANT_DAILY_XP_LIMIT_ADMIN` (50,000) → `403 GRANT_DAILY_LIMIT`; checked under a per-actor advisory lock. Audited `user.coins_granted` (before/after) in the same transaction. Admin telemetry: `coins_granted { amount, xp }`. |
| `GET /admin/grants/allowance`                                                           | ADMIN, SUPPORT                                               | `{ usedToday { coins, xp }, limit { coins, xp }, maxCoinsPerGrant }`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `POST /admin/system-notices/terms-update`, `GET …/:version`                             | ADMIN                                                        | docs/10 §3.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `GET /admin/reports/overview?fresh=1`                                                   | ADMIN                                                        | `{ generatedAt, retention[], leagues[], shop[], billing }` (docs/09 §13); 10-minute per-instance cache.                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `GET /admin/reports/courses`, `GET /admin/reports/courses/:id`                          | ADMIN, TEACHER (own courses; others `403 NOT_COURSE_AUTHOR`) | Funnel `{ courseId, slug, title, status, lessons, enrolled (Enrollment ∪ learners with progress), started, completed }`; detail adds `lessons[{ lessonId, title, position, type, opened (lesson_open, 90 d), completed, dropOff, dropOffRate }]`.                                                                                                                                                                                                                                                                                                                  |
| `GET /admin/exercise-health?language=`                                                  | ADMIN                                                        | `{ languages[], items[{ exerciseId, lessonId, lessonTitle, courseId, courseTitle, language, attempts, learners, passers, passRate, avgAttemptsToPass, failures { FAIL, ERROR, TIMEOUT, MEMORY, RUNTIME }, topFailingTests[{ testId, name, count }] }] }` (scored, graded submissions).                                                                                                                                                                                                                                                                             |
| `POST /admin/exercise-health/retest { language }`, `GET /admin/exercise-health/retests` | ADMIN                                                        | 202 job `{ jobId, language, status: queued\|running\|done\|failed, total, done, passed, failed, results[{ exerciseId, lessonTitle, ok, verdict, scorePct, message }] }`; `409 RETEST_RUNNING`. Audited `exercise.bulk_retest_queued` / `exercise.bulk_retest`.                                                                                                                                                                                                                                                                                                     |
