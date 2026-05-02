# 03 — Shared Libraries (Atomic Build)

This is the **build order**. Each library has a "Done when" gate — no app feature work begins until the libraries it depends on hit their gate.

```
ui-tokens ─┬─► ui-core ─┬─► ui-bootstrap (admin)
           │            ├─► ui-ionic (student)
           │            └─► gamification-engine
           │
           ├─► lesson-schema ──────► used by ui-bootstrap (editor) + ui-ionic (renderer)
           │
           ├─► auth ─────────────────► used by all apps
           ├─► i18n ─────────────────► used by all apps
           ├─► api-client ───────────► used by all apps (codegen)
           ├─► billing ──────────────► used by api + admin + student
           └─► domain ───────────────► used by api + ui-* (where pure)
```

## `libs/ui-tokens/`

**Purpose**: single source of truth for design tokens. SCSS only — no TypeScript.

**Structure**:
```
ui-tokens/
├── _color.scss        Brand, semantic, surface, text, state, gamification
├── _spacing.scss      4px scale: 0, 1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64
├── _radius.scss       sm, md, lg, xl, pill, circle
├── _shadow.scss       elevation 0–4
├── _typography.scss   font families, weights, sizes, line-heights
├── _breakpoints.scss  xs, sm, md, lg, xl, xxl
├── _motion.scss       durations + easing curves
├── _z.scss            z-index scale
├── _bootstrap-map.scss  Maps tokens → Bootstrap SCSS variables
├── _ionic-map.scss      Maps tokens → Ionic CSS custom properties
└── index.scss          Re-exports + theme builders (`@mixin theme-light`, `theme-dark`)
```

**Conventions**:
- Tokens exposed both as Sass variables (`$color-primary-500`) and as CSS custom properties (`--codify-color-primary-500`) — Sass for compile-time, CSS vars for runtime theme switching.
- Semantic tokens (`--color-coin`, `--color-xp`, `--color-premium`) layer on top of palette tokens.
- Dark theme is a CSS-var override — every component must read tokens via CSS vars, never hardcoded colors.

**Done when**:
- ✅ Light + dark themes render identical demo page in admin shell (Bootstrap) and student shell (Ionic).
- ✅ Storybook page documenting every token group exists.
- ✅ A11y check: all `text on surface` token pairs ≥ 4.5:1 contrast.

---

## `libs/ui-core/`

**Purpose**: framework-agnostic utilities used everywhere. No DOM, no Angular.

**Modules**:
- `format/` — `formatCurrency(cents, currency, locale, opts?)`, `formatInstallments({totalCents, count, currency, locale})`, `formatXp(n, locale)`, `formatCoins(n, locale)`, `formatDuration(ms, locale)`, `formatRelativeDate(date, locale)`.
- `level/` — `levelFromXp(xp)`, `xpToNextLevel(xp)`, `levelProgressPct(xp)` — encodes the XP curve from [07-gamification.md](./07-gamification.md). Pure functions; tested.
- `validate/` — zod schemas for primitives reused FE+BE: `Email`, `Slug`, `LocaleCode`, `Currency`, `HexColor`.
- `color/` — `getContrastingTextColor(hex)`, palette adjusters.
- `random/` — seeded RNG for reproducible animations (e.g. cohort-deterministic confetti).

**Done when**:
- ✅ 100% unit-test coverage on `level/` (it's load-bearing for every reward).
- ✅ Tree-shakable (each module a separate entry point).
- ✅ Zero Angular / DOM imports verified by lint rule.

---

## `libs/lesson-schema/`

**Purpose**: defines the Tiptap document JSON shape and is the contract between admin (author) and student (renderer). See [06-content-authoring.md](./06-content-authoring.md) for the block catalog.

**Exports**:
- `LessonDoc` TypeScript type — full discriminated union of block nodes.
- `lessonDocSchema` zod validator.
- `LESSON_BLOCK_REGISTRY` — metadata per block: `{ name, allowedIn, hasInteractive, version, migrate? }`.
- `migrateLessonDoc(doc)` — runs versioned migrations (e.g. v1 → v2 schema bumps).
- `tiptapExtensions` — the array of Tiptap node + mark extensions, importable by admin.
- `BlockRendererProtocol` — TS interface that the student renderer implements.

**Done when**:
- ✅ Round-trip test: random valid doc → admin save → student render → no data loss.
- ✅ Schema versioning works: a v1 doc loads through `migrateLessonDoc` cleanly.
- ✅ Storybook shows every block in isolation (within admin context).

---

## `libs/api-client/`

**Purpose**: typed HTTP client generated from the API's OpenAPI spec.

**Pipeline**:
1. NestJS emits `openapi.json` at build (via `@nestjs/swagger`).
2. CI step runs `openapi-typescript-codegen` → outputs to `libs/api-client/src/generated/`.
3. Hand-written wrapper layer in `libs/api-client/src/` adds Angular `HttpClient` interceptor integration (auth header, locale header, idempotency key generation, retry policy).
4. Both apps depend on `libs/api-client`; never call `HttpClient` directly for backend endpoints.

**Wrapper additions**:
- `IdempotencyInterceptor` — generates UUID v4 for any POST/PUT/PATCH that the caller marks via `withIdempotency()`.
- `LocaleInterceptor` — injects `Accept-Language` from `i18n` service.
- `AuthInterceptor` — pulls Clerk JWT from `auth` lib.
- `ProblemDetailsErrorMapper` — converts RFC 7807 responses into typed errors.

**Done when**:
- ✅ Codegen runs on every API change in CI; PR fails if `api-client` is out of date with `openapi.json`.
- ✅ Both apps build only against the wrapper, not the generated types directly.

---

## `libs/auth/`

**Purpose**: Clerk integration as an Angular library.

**Exports**:
- `provideAuth()` — standalone provider function configuring Clerk SDK.
- `AuthService` — signals: `user`, `role`, `isAuthenticated`, `loading`. Methods: `signIn()`, `signOut()`, `openProfile()`.
- `authGuard(roles?)` — route guard factory.
- `RoleDirective` — `*codifyIfRole="['ADMIN','TEACHER']"`.
- `withAuthInterceptor()` — function provider for HttpClient.

**Done when**:
- ✅ Both apps boot, sign in, role-guard a route, log out, all in dev.
- ✅ Token refresh works silently across a long session.
- ✅ E2E test for the full Clerk flow against dev tenant.

---

## `libs/i18n/`

**Purpose**: ngx-translate setup + shared keys + content-translation helper.

**Exports**:
- `provideI18n(opts)` — registers loader, missing-handler, default + supported locales.
- `I18nService` — signals: `currentLocale`, `availableLocales`. Methods: `setLocale(locale)`, `t(key, params?)`, `tContent(entityType, entityId, field, opts?)`.
- `LocalePipe` — `{{ 'home.greeting' | t:{name} }}`.
- `ContentTranslatePipe` — `{{ courseId | tContent:'COURSE':'title' }}`.
- `setHtmlLangDir()` — sets `<html lang>` and `dir` attributes on locale change.
- `currencyForLocale(locale)`, `defaultDateFormat(locale)`.

**Shared key namespaces** (lives here, not duplicated across apps):
- `common.*` — buttons, errors, validation messages.
- `time.*` — relative dates, durations.
- `gamification.*` — XP, coins, streak labels.
- `billing.*` — currency, plan terminology.

**Done when**:
- ✅ Locale switch updates UI without reload, including content translations.
- ✅ Missing-key handler logs to Sentry in prod, warns in dev.
- ✅ RTL flip works (verified with Hebrew test locale even if not user-facing).

See [11-i18n.md](./11-i18n.md) for full strategy.

---

## `libs/domain/`

**Purpose**: pure business logic that must not diverge between API and clients.

**Modules**:
- `access/` — `canUserAccessLesson(user, lesson, course, subscriptions, enrollments): AccessResult`. Single source of truth referenced by the API enforcement and by the client UI gating.
- `plans/` — `coursesIncludedInPlan(plan, courses, categories)`, `plansIncludingCourse(course, plans)`.
- `multipliers/` — `resolveMultiplier({ user, lesson, course, streak, now }): { value, breakdown }`. Returns the effective multiplier and a human-readable breakdown for "why am I getting 4x?" UI.
- `level/` — wraps `ui-core/level` for symmetry.
- `progress/` — `courseCompletionPct(progressRows, lessonsInCourse)`.

**Done when**:
- ✅ Every function is pure (no I/O, no `Date.now()` — clock injected).
- ✅ Property-based tests for `resolveMultiplier` covering combinatorial cases.
- ✅ API and client share identical results for the same inputs (verified by snapshot test).

---

## `libs/billing/`

**Purpose**: payment provider abstraction so we can swap Stripe later if needed.

**Exports**:
- `BillingProvider` interface: `createCheckoutSession`, `createPortalSession`, `getSubscription`, `cancelSubscription`, `verifyWebhookSignature`, `parseWebhookEvent`.
- `StripeBillingProvider` implementation.
- `formatPrice(price, locale, opts)` — handles installment display (`R$ 9,99/mês ou 12x de R$ 99,90 sem juros`).
- `PaymentMethodIcon` data — for rendering Visa/Mastercard/Elo/PIX/Boleto badges.
- `BR_INSTALLMENT_DEFAULTS` — recommended installment counts and interest curves for Brazil.

**Done when**:
- ✅ Both apps render plan + price + installments without referencing Stripe types directly.
- ✅ Webhook verification + parsing tested against Stripe's official fixtures.

See [09-billing.md](./09-billing.md).

---

## `libs/gamification-engine/`

**Purpose**: client-side orchestration of every reward event. Server is authoritative; this lib coordinates the experience.

**Exports**:
- `RewardOrchestrator` (Angular service): the **only** path through which a UI plays a reward animation.
  ```ts
  orchestrator.grant({
    kind: 'lessonComplete',
    canonical: { xp: 20, coins: 10, multiplier: 2.0, breakdown },
    levelUp?: { newLevel },
    badgesUnlocked?: BadgeRef[],
    sourceEl?: HTMLElement,   // origin of the coin-fly animation
  })
  ```
  Internally schedules: haptic → visual cue → coin trail → counter increment → optional level-up modal → optional badge overlay → audio. All sequenced via GSAP timeline.

- `XpService`, `CoinService`, `StreakService`, `QuestService`, `LeagueService` — Angular services that mirror the server state (signals) and accept reconciliation events.
- `RewardQueue` — when offline or rapid-fire events stack, reduces to a coherent celebration (e.g. 3 lessons in a row → one "3 lessons!" payload, not three separate confetti bursts).
- Animation primitives: `coinFlyDirective`, `confettiBurst()`, `levelUpOverlayService`, `badgeUnlockService`.
- Sound: `SoundService` — preloaded short SFX, respects user mute, falls back gracefully.
- Haptics: thin wrapper around `Capacitor/Haptics` (no-op on web).

**Done when**:
- ✅ All reward events go through `RewardOrchestrator` (lint rule enforces).
- ✅ Replaying a sequence is deterministic given a seed (testable).
- ✅ Reduced-motion + reduced-sound preferences honored.
- ✅ A standalone "RewardOrchestrator demo" page in Storybook plays each reward kind on demand.

See [07-gamification.md](./07-gamification.md) and [10-engagement.md](./10-engagement.md).

---

## `libs/ui-bootstrap/` (admin only)

**Purpose**: every visual primitive admin uses.

### Atoms
| Component | Notes |
|---|---|
| `Button` | variants: `primary`, `secondary`, `ghost`, `danger`, `link`; sizes `sm/md/lg`; `loading`, `disabled`, `iconOnly` |
| `IconButton` | wrapper |
| `Icon` | thin wrapper over a single icon set (Phosphor or Lucide) |
| `Input` | text/email/url/number; affixes |
| `Textarea` | autosize variant |
| `Select` | single + multi |
| `Combobox` | typeahead with async source |
| `Checkbox`, `Radio`, `Toggle` | accessible |
| `Tag`, `Badge`, `Chip` | with optional remove |
| `Avatar` | initials fallback, size variants |
| `Spinner`, `Skeleton` | |
| `ProgressBar` | linear |
| `Tooltip`, `Popover` | ng-bootstrap-backed |
| `Divider`, `KBD` | |

### Molecules
| Component | Notes |
|---|---|
| `FormField` | label + control slot + help + error |
| `SearchBar` | debounced input + clear |
| `Pagination` | numeric + cursor variants |
| `Modal`, `Drawer`, `ConfirmDialog` | service-driven |
| `Toast` | service: `toasts.success/error/info/warn` |
| `EmptyState` | illustration + CTA |
| `FileUploader` | drag+drop, progress |
| `ImageCropper` | for course covers, item thumbnails |
| `DataTable` | sortable, paginated, row actions, bulk select |
| `KeyValueList` | for detail panels |
| `LanguageSwitcher`, `ThemeToggle` | |
| `BreadcrumbBar` | |
| `PriceTag` | `{ amountCents, currency, period, installments }` |
| `PlanFeatureList` | bullet list + included-categories |
| `MoneyInput` | masked BRL input |
| `DateRangePicker` | for promotions |
| `AssetPicker` | inline media library opener |

### Organisms
| Component | Notes |
|---|---|
| `AppShell` | sidebar + topbar + content slot |
| `LessonBlockEditor` | Tiptap host with custom blocks (paragraph, heading, code, callout, quiz, exercise, AI-prompt, image, embed, video) |
| `BlockToolbar`, `BlockMenu` | floating + side menus |
| `MediaLibrary` | grid + uploader |
| `ItemSpritePreview` | renders an `Item` over the avatar canvas |
| `MultiplierEditor` | builds a `Multiplier` row visually |
| `CategoryAssignmentMatrix` | toggle grid of categories × plans |
| `AvatarRenderer` | re-exported from `ui-ionic`/shared (see below) |
| `JsonEditor` | for advanced fields (badge rules, exercise tests) |

**Naming**: every component is `Cdf` prefixed in selectors (`cdf-button`) but exported as `Button` in TS to avoid noise.

**Done when**:
- ✅ Storybook documents every component with all variants.
- ✅ A11y checks pass (axe via Storybook addon).
- ✅ Two demo admin pages (Course list + Lesson editor) built using only this lib + tokens.

---

## `libs/ui-ionic/` (student only)

**Purpose**: every visual primitive the student app uses, branded over Ionic primitives where appropriate.

### Atoms
| Component | Notes |
|---|---|
| `AppButton` | wraps `<ion-button>` with token styling, `kind`/`size`/`loading` |
| `AppCard` | wraps `<ion-card>`, padding tokens, hover state on web |
| `AppInput`, `AppSelect` | wrap Ionic equivalents |
| `AppCheckbox`, `AppToggle` | |
| `AppAvatar` | renders user's `AvatarConfig` via `AvatarRenderer`; size variants |
| `AppBadge`, `AppTag`, `AppChip` | rarity-aware (color tokens) |
| `AppSpinner`, `AppSkeleton` | |
| `Icon` | same icon set as admin |
| `XpBadge`, `CoinBadge` | inline icon + number; reused everywhere |

### Molecules
| Component | Notes |
|---|---|
| `FormField` | analogous to admin |
| `SearchBar` | debounced + voice (capacitor) |
| `LessonItem` | row in module list: title, status icon, free-flag |
| `CourseCard` | mobile + desktop variants (responsive grid) |
| `PlanCard` | with included-categories chips, price, installments |
| `PriceTag` | identical contract to admin |
| `XpBar` | linear progress with level label |
| `CoinCounter` | imperative `addCoins(n, fromEl?)` triggers fly animation |
| `LevelBadge` | level number with tier ring |
| `StreakChip` | flame icon + day count + freeze indicator |
| `AvatarWithFrame` | avatar + equipped frame + level ring |
| `RewardToast` | small "+10 XP +5 coins" pill |
| `BottomSheet` | mobile-first; expands to side panel on desktop |
| `EmptyState`, `ErrorState`, `OfflineState` | |
| `LanguageSwitcher`, `ThemeToggle` | |

### Organisms
| Component | Notes |
|---|---|
| `AppShell` | tabs (mobile) / sidebar (desktop ≥ md), header, slot |
| `LessonPlayer` | renders `LessonDoc` JSON via `BlockRendererProtocol` implementations |
| `QuizRenderer` | radio/checkbox/match question types, immediate feedback |
| `ExerciseRunner` | Monaco editor + visible-tests panel + run/submit buttons + verdict UI |
| `ScenarioRunner` | branching dialogue, choice scoring |
| `AiPromptPlayground` | textarea + "send" + rubric checklist that lights up |
| `LeaderboardTable` | virtualized; current-user pinned row |
| `ShopGrid` | virtualized; rarity filters; affordability badge |
| `Inventory` | grouped by slot; equip/unequip |
| `AvatarBuilder` | dressing-room view; live preview while picking |
| `DailyQuestList` | three quests with progress bars |
| `StreakWidget` | calendar dots last 14 days, freezes shown |
| `LevelUpModal` | full-screen celebration overlay |
| `BadgeUnlockOverlay` | full-screen, GSAP timeline |
| `MysteryChestOpener` | shake-to-open animation, rarity reveal — *deferred to chest phase, see 07 §10* |
| `CelebrationOverlay` | confetti + Lottie + SFX coordinator |
| `OnboardingCarousel` | swipeable, 3-step intro |
| `CoursePreviewModal` | shows free-lesson list + plans-included |
| `PaywallSheet` | for content gated by plan; lists plans-that-include and CTA |

### Truly shared visuals (single source)

These ship as framework-agnostic Angular standalone components and are re-exported by both `ui-bootstrap` and `ui-ionic` so they look identical:

- `AvatarRenderer` — composites SVG layers based on an `AvatarConfig`. Used in admin (item preview, user inspector) and student (everywhere). Props: `config`, `size`, `equippedItems?`, `pose?`, `frame?`.
- `LessonBlockRenderer` (read-only) — given a `LessonDoc` and a host config, renders the canonical view. Used in admin preview and student player.

**Done when**:
- ✅ Storybook (web build) documents every component.
- ✅ Reduced-motion and high-contrast modes verified.
- ✅ Two demo student screens (Today + Course detail) built using only this lib + tokens.
- ✅ Responsive: every component renders correctly at xs (320px), md (768px), and xl (1280px+) widths — no Ionic primitive stretched to look weird.

---

## Build sequencing (atomic-design discipline)

The point of doing this before features: when Phase 5 (course delivery) starts, **no one is making a button decision in a feature PR**. Every primitive exists, themed, accessible, in Storybook.

Recommended order within Phase 2/3:
1. Tokens.
2. `ui-core` formatters.
3. Atoms in both libs (parallel work, two devs).
4. `lesson-schema` (so admin editor + student renderer can begin in parallel).
5. Molecules.
6. `gamification-engine` skeleton + `RewardOrchestrator` API + animation primitives (in parallel with molecules).
7. Organisms — admin shell + lesson editor; student shell + lesson player.
8. Demo pages in each app, hand-built from primitives, signed off by design.

Only after step 8 do we open the gates on Phase 5+ feature work.
