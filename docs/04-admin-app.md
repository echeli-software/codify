# 04 — Admin App

Angular SPA at `admin.codify.app`. Bootstrap-themed via `ui-bootstrap` + tokens. No public sign-up — accounts are provisioned by an existing admin (or via Clerk invitation).

## 1. Roles & permissions

| Role | Authoring | Catalog ops | Billing | Users | Items / Shop | Promotions / Multipliers | Audit |
|---|---|---|---|---|---|---|---|
| `TEACHER` | Own courses only | View own | – | View own course enrollments (anonymized) | – | View own course-level multipliers | View own actions |
| `SUPPORT` | – | View | View, refund (capped) | View, suspend, manual coin grant (capped) | View | – | View |
| `ADMIN` | All | All | All | All | All | All | All |

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
  - **Suspend / unsuspend**: writes Clerk + sets `User.deletedAt` on hard delete.
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
- Stripe connection status; webhook URL display + signing secret rotation.
- Feature flags (e.g. `leagues.enabled`, `shop.enabled`).

## 4. Layout & responsive

- Desktop ≥ 1024px: persistent sidebar (240px), topbar (56px), content (max-width 1440px, gutters).
- Tablet 768–1023: collapsible sidebar (icons only by default).
- Mobile < 768: drawer-style sidebar; admin not optimized for phone but must remain usable for "approve/refund on the go" tasks.

## 5. Forms & autosave

- Reactive forms with zod validation via a shared `zodControlAdapter`.
- Autosave on lesson editor (5s debounce, visible "Saved at HH:MM:SS").
- All other forms: explicit save with optimistic UI + rollback on error.
- Unsaved-changes guard on route navigation.

## 6. Search

- Top-bar global search (Cmd/Ctrl-K). Searches courses, lessons, users, items, badges by name + slug.
- Initial: Postgres `tsvector` + `tsquery` per entity. Migrate to Meilisearch if latency or relevance becomes a problem.

## 7. Theming & accessibility

- Light + dark themes from `ui-tokens`. User preference per-account, persisted.
- All interactive elements keyboard-reachable; `Esc` closes modals; `Tab` order manually verified on lesson editor.
- High-contrast mode via tokens override.

## 8. Telemetry

- Page view tracking (route + role + locale).
- Feature events: `course.created`, `lesson.published`, `multiplier.created`, `user.suspended`, `coins.granted`, `translation.completed`.
- All admin actions also emit `AuditLog` rows server-side.

## 9. Empty / error states

- Every list has an `EmptyState` with a primary CTA ("+ New course").
- Every async area has skeletons during load and a typed error state with retry.
- Permission-denied states explain *which role* would be required.

## 10. Out of scope (initial)

- Multi-author collaboration on a single lesson (locking only — last write wins with autosave conflict warning).
- Course bundling separate from plans (consider after launch).
- Coupons / promo codes for new subscribers (Stripe supports natively; we surface in admin in a later phase).
- Manual review queue for flagged content (moderation tooling — later).
