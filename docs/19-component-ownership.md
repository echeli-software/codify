# 19 — Component ownership matrix

Roadmap Phase 2 acceptance: _"Component ownership matrix written (who owns
each component for evolution)."_ This is that matrix for every component in
`libs/ui-bootstrap` and `libs/ui-ionic`, for every other library and for the
apps' feature areas, plus the rules for changing them. It complements [03-shared-libraries.md](./03-shared-libraries.md)
(what each component is) with _who decides how it evolves_.

## Roles

Owners are **roles**, not names, so the matrix survives team changes. The
current holder of each role is recorded in the team handbook (and mirrored in
`.github/CODEOWNERS` once GitHub teams exist — template at the end).

| Role             | Owns                                                        | Typical holder (team of docs/15) |
| ---------------- | ----------------------------------------------------------- | -------------------------------- |
| **DS-Admin**     | `ui-bootstrap` + Bootstrap token map                        | Engineer A                       |
| **DS-Student**   | `ui-ionic` + Ionic token map                                | Engineer B                       |
| **Design**       | Visual language, tokens, a11y sign-off                      | Designer                         |
| **Gamification** | `gamification-engine`, reward visuals, `domain` reward math | Engineer B                       |
| **Content**      | `lesson-schema`, block editor/renderer contracts            | Engineer A                       |
| **Platform**     | `api-client`, `auth`, `i18n`, `ui-core`, CI/CD, infra       | Engineer A                       |
| **Billing**      | `billing` lib, price/plan visuals                           | Engineer B                       |
| **Product**      | Copy, scope, acceptance                                     | PM / operator                    |

## Review rules

| Rule                     | Applies to                                                                                                                       | Requirement                                                                      |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| **R1 — Owner review**    | any change                                                                                                                       | 1 approval from the owning role                                                  |
| **R2 — Owner + Design**  | visual change: new variant, spacing/colour/typography, motion, icon                                                              | R1 + Design approval on the Storybook preview (storybook.yml publishes `pr-<n>`) |
| **R3 — Contract change** | public inputs/outputs/selectors, exported TS types, service APIs                                                                 | R1 + every consuming app's owner; deprecate first (see Evolution)                |
| **R4 — Cross-lib**       | anything both apps render from one UI lib (`AvatarRenderer` in ui-ionic, `LessonBlockRenderer` in ui-bootstrap) or token changes | DS-Admin **and** DS-Student + Design                                             |
| **R5 — Integrity**       | reward/coin/XP/streak logic or visuals that imply a reward                                                                       | R1 + Gamification; server stays authoritative (docs/07)                          |

All UI changes must keep `storybook.yml` green: every story renders and **axe
reports no violations** (Phase 2/3 a11y acceptance).

## Evolution policy

| Policy           | Meaning                                                                                                                      |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| **Stable**       | Public API frozen; additive changes only (new optional input, new variant). Breaking change ⇒ new name or deprecation cycle. |
| **Evolving**     | Additive by default; breaking changes allowed with R3 and all call sites updated in the same PR.                             |
| **Experimental** | Free to change; not for use outside its owning app/demo without asking the owner.                                            |
| **Planned**      | Specified in docs/03, not built yet; the owner decides the API when it lands.                                                |

**Deprecation cycle (Stable):** mark `@deprecated` with the replacement → keep
both for one minor release → remove after call sites are gone. Never change a
selector (`cdf-*`) in place.

**Additions:** new primitives go to the lib first (with stories + variants)
and only then into features — no one-off visual components in apps (docs/03,
"Build sequencing").

## `libs/ui-bootstrap` (admin)

Rebuilt from `libs/ui-bootstrap/src/lib/` (Nov 2026): every component listed in docs/03 now exists. Components that were Planned in the first version of this matrix are Evolving until their owner freezes them.

| Component                                                           | Selector / export                       | Layer    | Owner                           | Review                                                | Policy   |
| ------------------------------------------------------------------- | --------------------------------------- | -------- | ------------------------------- | ----------------------------------------------------- | -------- |
| Avatar                                                              | `atoms/avatar`                          | atom     | DS-Admin                        | R2                                                    | Stable   |
| Badge                                                               | `atoms/badge`                           | atom     | DS-Admin                        | R2                                                    | Stable   |
| Button                                                              | `atoms/button`                          | atom     | DS-Admin                        | R2                                                    | Stable   |
| Checkbox                                                            | `atoms/checkbox`                        | atom     | DS-Admin                        | R2                                                    | Stable   |
| Chip                                                                | `atoms/chip`                            | atom     | DS-Admin                        | R2                                                    | Evolving |
| Combobox                                                            | `atoms/combobox`                        | atom     | DS-Admin                        | R3 (async `ComboboxSource` contract)                  | Evolving |
| Divider                                                             | `atoms/divider`                         | atom     | DS-Admin                        | R1                                                    | Stable   |
| Icon                                                                | `atoms/icon`                            | atom     | DS-Admin                        | R4 (shared icon set with student)                     | Stable   |
| IconButton                                                          | `atoms/icon-button`                     | atom     | DS-Admin                        | R2                                                    | Stable   |
| Input                                                               | `atoms/input`                           | atom     | DS-Admin                        | R2                                                    | Stable   |
| Kbd                                                                 | `atoms/kbd`                             | atom     | DS-Admin                        | R1                                                    | Stable   |
| Popover                                                             | `atoms/popover`                         | atom     | DS-Admin                        | R2                                                    | Evolving |
| ProgressBar                                                         | `atoms/progress-bar`                    | atom     | DS-Admin                        | R2                                                    | Stable   |
| RadioGroup                                                          | `atoms/radio`                           | atom     | DS-Admin                        | R2                                                    | Stable   |
| Select                                                              | `atoms/select`                          | atom     | DS-Admin                        | R2                                                    | Stable   |
| Skeleton                                                            | `atoms/skeleton`                        | atom     | DS-Admin                        | R1                                                    | Stable   |
| Spinner                                                             | `atoms/spinner`                         | atom     | DS-Admin                        | R1                                                    | Stable   |
| Tag                                                                 | `atoms/tag`                             | atom     | DS-Admin                        | R2                                                    | Stable   |
| Textarea                                                            | `atoms/textarea`                        | atom     | DS-Admin                        | R2                                                    | Stable   |
| Toggle                                                              | `atoms/toggle`                          | atom     | DS-Admin                        | R2                                                    | Stable   |
| Tooltip                                                             | `atoms/tooltip`                         | atom     | DS-Admin                        | R2                                                    | Stable   |
| AssetPicker (+ `AssetPickerDialog`)                                 | `molecules/asset-picker`                | molecule | Content + Platform (R2 uploads) | R3                                                    | Evolving |
| BreadcrumbBar                                                       | `molecules/breadcrumb-bar`              | molecule | DS-Admin                        | R2                                                    | Stable   |
| ConfirmDialogService                                                | `molecules/confirm-dialog`              | molecule | DS-Admin                        | R3 (service API)                                      | Stable   |
| DateRangePicker                                                     | `molecules/date-range-picker`           | molecule | DS-Admin                        | R2                                                    | Evolving |
| Drawer                                                              | `molecules/drawer`                      | molecule | DS-Admin                        | R2                                                    | Evolving |
| EmptyState                                                          | `molecules/empty-state`                 | molecule | DS-Admin                        | R2                                                    | Stable   |
| FileUploader (+ `FILE_UPLOADER` token)                              | `molecules/file-uploader`               | molecule | DS-Admin + Platform (uploads)   | R3                                                    | Evolving |
| FormField                                                           | `molecules/form-field`                  | molecule | DS-Admin                        | R3 (used by every admin form)                         | Stable   |
| ImageCropper                                                        | `molecules/image-cropper`               | molecule | DS-Admin                        | R2                                                    | Evolving |
| KeyValueList                                                        | `molecules/key-value-list`              | molecule | DS-Admin                        | R2                                                    | Stable   |
| LanguageSwitcher                                                    | `molecules/language-switcher`           | molecule | DS-Admin + Platform (i18n)      | R3                                                    | Stable   |
| Pagination (offset + cursor modes)                                  | `molecules/pagination`                  | molecule | DS-Admin                        | R2                                                    | Stable   |
| PriceTag                                                            | `molecules/price-tag`                   | molecule | Billing                         | R4 (same contract as student `PriceTag`)              | Stable   |
| SearchBar                                                           | `molecules/search-bar`                  | molecule | DS-Admin                        | R2                                                    | Stable   |
| ThemeToggle + ThemeService                                          | `molecules/theme-toggle`                | molecule | DS-Admin + Design               | R4 (theme tokens)                                     | Stable   |
| Toast host + ToastService                                           | `molecules/toast`                       | molecule | DS-Admin                        | R3 (service API)                                      | Stable   |
| AppShell                                                            | `organisms/app-shell`                   | organism | DS-Admin                        | R3                                                    | Evolving |
| BlockMenu                                                           | `organisms/block-menu`                  | organism | Content                         | R3 (built from `LESSON_BLOCK_REGISTRY`)               | Evolving |
| BlockToolbar                                                        | `organisms/block-toolbar`               | organism | Content                         | R3                                                    | Evolving |
| CategoryAssignmentMatrix                                            | `organisms/category-assignment-matrix`  | organism | Billing                         | R3                                                    | Evolving |
| DataTable                                                           | `organisms/data-table`                  | organism | DS-Admin                        | R3                                                    | Evolving |
| ItemSpritePreview                                                   | `organisms/item-sprite-preview`         | organism | Gamification                    | R5 (renders `AvatarRenderer`)                         | Evolving |
| JsonEditor                                                          | `organisms/json-editor`                 | organism | Content                         | R1                                                    | Evolving |
| LessonBlockEditor (+ Tiptap extensions, node views, asset uploader) | `organisms/lesson-block-editor`         | organism | Content                         | R3 + Content (schema)                                 | Evolving |
| LessonBlockRenderer (+ `LessonCodeBlock`, `LessonRefSlot`)          | `organisms/lesson-block-renderer`       | organism | Content                         | R4 (single source for admin preview + student player) | Stable   |
| MediaLibrary (+ `ASSET_LIBRARY` token)                              | `organisms/media-library`               | organism | Content + Platform (R2 uploads) | R3                                                    | Evolving |
| Modal frame + ModalService                                          | `organisms/modal`                       | organism | DS-Admin                        | R3                                                    | Stable   |
| MoneyInput                                                          | `organisms/money-input`                 | organism | Billing                         | R2                                                    | Stable   |
| MultiplierEditor                                                    | `organisms/multiplier-editor`           | organism | Gamification                    | R5                                                    | Evolving |
| PlanFeatureList                                                     | `organisms/plan-feature-list`           | organism | Billing                         | R2                                                    | Evolving |
| AvatarRenderer (re-export)                                          | from `@codify/ui-ionic/avatar-renderer` | molecule | Gamification                    | R4 + R5 (owned in `ui-ionic`)                         | Stable   |

## `libs/ui-ionic` (student)

| Component                                                         | Selector / export                                                           | Layer    | Owner                               | Review                                          | Policy                                         |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------- | -------- | ----------------------------------- | ----------------------------------------------- | ---------------------------------------------- |
| AppAvatar                                                         | `atoms/app-avatar`                                                          | atom     | DS-Student                          | R4 (uses `AvatarRenderer`)                      | Stable                                         |
| AppBadge                                                          | `atoms/app-badge`                                                           | atom     | DS-Student                          | R2                                              | Stable                                         |
| AppButton                                                         | `atoms/app-button`                                                          | atom     | DS-Student                          | R2                                              | Stable                                         |
| AppCard                                                           | `atoms/app-card`                                                            | atom     | DS-Student                          | R2                                              | Stable                                         |
| AppCheckbox                                                       | `atoms/app-checkbox`                                                        | atom     | DS-Student                          | R2                                              | Stable                                         |
| AppChip                                                           | `atoms/app-chip`                                                            | atom     | DS-Student                          | R2                                              | Stable                                         |
| AppInput                                                          | `atoms/app-input`                                                           | atom     | DS-Student                          | R2                                              | Stable                                         |
| AppProgressBar                                                    | `atoms/app-progress-bar`                                                    | atom     | DS-Student                          | R2                                              | Stable                                         |
| AppSelect                                                         | `atoms/app-select`                                                          | atom     | DS-Student                          | R2                                              | Stable                                         |
| AppSkeleton                                                       | `atoms/app-skeleton`                                                        | atom     | DS-Student                          | R1                                              | Stable                                         |
| AppSpinner                                                        | `atoms/app-spinner`                                                         | atom     | DS-Student                          | R1                                              | Stable                                         |
| AppTag                                                            | `atoms/app-tag`                                                             | atom     | DS-Student                          | R2                                              | Stable                                         |
| AppToggle                                                         | `atoms/app-toggle`                                                          | atom     | DS-Student                          | R2                                              | Stable                                         |
| CoinBadge                                                         | `atoms/coin-badge`                                                          | atom     | Gamification                        | R5                                              | Stable                                         |
| Icon                                                              | `atoms/icon`                                                                | atom     | DS-Student                          | R4 (shared icon set with admin)                 | Stable                                         |
| ItemSprite (+ `SPRITE_URL_RESOLVER`)                              | `atoms/item-sprite`                                                         | atom     | Gamification                        | R5                                              | Evolving                                       |
| XpBadge                                                           | `atoms/xp-badge`                                                            | atom     | Gamification                        | R5                                              | Stable                                         |
| AvatarRenderer                                                    | `molecules/avatar-renderer` (also `@codify/ui-ionic/avatar-renderer`)       | molecule | Gamification (avatar/shop, docs/08) | R4 + R5                                         | Stable                                         |
| AvatarWithFrame                                                   | `molecules/avatar-with-frame`                                               | molecule | Gamification                        | R5                                              | Stable                                         |
| BottomSheet                                                       | `molecules/bottom-sheet`                                                    | molecule | DS-Student                          | R2                                              | Evolving                                       |
| CodeEditor (Monaco, lazy-loaded)                                  | `molecules/code-editor`                                                     | molecule | Content                             | R3                                              | Evolving                                       |
| CoinCounter                                                       | `molecules/coin-counter`                                                    | molecule | Gamification                        | R5                                              | Evolving                                       |
| CourseCard                                                        | `molecules/course-card`                                                     | molecule | DS-Student                          | R2                                              | Stable                                         |
| EmptyState                                                        | `molecules/empty-state`                                                     | molecule | DS-Student                          | R2                                              | Stable                                         |
| ErrorState                                                        | `molecules/error-state`                                                     | molecule | DS-Student                          | R2                                              | Evolving                                       |
| FormField                                                         | `molecules/form-field`                                                      | molecule | DS-Student                          | R3                                              | Stable                                         |
| LanguageSwitcher                                                  | `molecules/language-switcher`                                               | molecule | DS-Student + Platform (i18n)        | R3                                              | Evolving                                       |
| LessonItem                                                        | `molecules/lesson-item`                                                     | molecule | Content                             | R3 (lesson-type union)                          | Evolving                                       |
| LevelBadge                                                        | `molecules/level-badge`                                                     | molecule | Gamification                        | R5                                              | Stable                                         |
| OfflineState                                                      | `molecules/offline-state`                                                   | molecule | DS-Student                          | R2 (offline copy, docs/16)                      | Evolving                                       |
| PlanCard                                                          | `molecules/plan-card`                                                       | molecule | Billing                             | R2                                              | Evolving                                       |
| PriceTag                                                          | `molecules/price-tag`                                                       | molecule | Billing                             | R4 (same contract as admin `PriceTag`)          | Evolving                                       |
| RewardToast                                                       | `molecules/reward-toast`                                                    | molecule | Gamification                        | R5 (played only via `RewardOrchestrator`)       | Stable                                         |
| SearchBar                                                         | `molecules/search-bar`                                                      | molecule | DS-Student                          | R2                                              | Evolving                                       |
| StreakChip                                                        | `molecules/streak-chip`                                                     | molecule | Gamification                        | R5                                              | Stable                                         |
| ThemeToggle + ThemeService                                        | `molecules/theme-toggle`                                                    | molecule | DS-Student + Design                 | R4 (theme tokens)                               | Evolving                                       |
| XpBar                                                             | `molecules/xp-bar`                                                          | molecule | Gamification                        | R5                                              | Stable                                         |
| AiPromptPlayground                                                | `organisms/ai-prompt-playground`                                            | organism | Content                             | R3                                              | Evolving                                       |
| AppShell                                                          | `organisms/app-shell`                                                       | organism | DS-Student                          | R3 (tabs ↔ sidebar breakpoints)                 | Evolving                                       |
| AvatarBuilder                                                     | `organisms/avatar-builder`                                                  | organism | Gamification                        | R5                                              | Evolving                                       |
| BadgeUnlockOverlay                                                | `organisms/badge-unlock-overlay`                                            | organism | Gamification                        | R5                                              | Stable                                         |
| CelebrationOverlay                                                | `organisms/celebration-overlay`                                             | organism | Gamification                        | R5 (played only via `RewardOrchestrator`)       | Evolving                                       |
| CoursePreviewModal                                                | `organisms/course-preview-modal`                                            | organism | DS-Student + Billing                | R3                                              | Evolving                                       |
| DailyQuestList                                                    | `organisms/daily-quest-list`                                                | organism | Gamification                        | R5                                              | Evolving                                       |
| ExerciseRunner                                                    | `organisms/exercise-runner`                                                 | organism | Content                             | R3                                              | Evolving                                       |
| Inventory                                                         | `organisms/inventory`                                                       | organism | Gamification                        | R5                                              | Evolving                                       |
| LeaderboardTable                                                  | `organisms/leaderboard-table`                                               | organism | Gamification                        | R5                                              | Evolving                                       |
| LevelUpModal                                                      | `organisms/level-up-modal`                                                  | organism | Gamification                        | R5                                              | Stable                                         |
| OnboardingCarousel                                                | `organisms/onboarding-carousel`                                             | organism | DS-Student + Product (copy)         | R2                                              | Evolving                                       |
| PaywallSheet                                                      | `organisms/paywall-sheet`                                                   | organism | Billing                             | R3 (native IAP vs web checkout, docs/17-mobile) | Evolving                                       |
| ScenarioRunner                                                    | `organisms/scenario-runner`                                                 | organism | Content                             | R3                                              | Evolving                                       |
| ShopGrid                                                          | `organisms/shop-grid`                                                       | organism | Gamification                        | R5                                              | Evolving                                       |
| StreakWidget                                                      | `organisms/streak-widget`                                                   | organism | Gamification                        | R5                                              | Stable                                         |
| RewardOrchestrator demo story                                     | `demo/reward-orchestrator-demo.stories.ts`                                  | demo     | Gamification                        | R1                                              | Experimental                                   |
| Lesson player (page; quizzes render inside `LessonBlockRenderer`) | — (lives in `apps/student`, `pages/lesson.page.ts` + `components/lesson-*`) | page     | Content                             | R3                                              | Evolving → promote to lib when reused          |
| MysteryChestOpener                                                | —                                                                           | organism | Gamification                        | R5                                              | Planned (mystery chests deferred, docs/07 §10) |

## Other libraries

| Library                                                                                                                             | Owner                                                                                                                      | Review                  | Policy   | Notes                                                                                               |
| ----------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ----------------------- | -------- | --------------------------------------------------------------------------------------------------- |
| `ui-tokens`                                                                                                                         | Design + DS-Admin + DS-Student                                                                                             | R4                      | Stable   | SCSS in `src/scss/`. Every token rename is a breaking change for both apps; add, don't rename       |
| `ui-core` (format, level, color, random, validate, avatar)                                                                          | Platform (`avatar/` config: Gamification)                                                                                  | R3                      | Stable   | 100 % test coverage required (roadmap Phase 1); `level` and `avatar` are also used by the API       |
| `domain` (access, earning, multipliers, streaks, leagues, items, exercises, browser exercises, AI grading, certificates, scenarios) | Gamification (reward / streak / league math) · Content (exercises, scenarios, AI grading, certificates) · Billing (access) | R3 + R5 for reward math | Stable   | Shared by API and apps — pure functions only, changes need API + app owners                         |
| `gamification-engine` (`RewardOrchestrator`, animation, sound, haptics, overlays, state)                                            | Gamification                                                                                                               | R5                      | Stable   | All reward playback goes through `RewardOrchestrator` (lint-enforced)                               |
| `lesson-schema` (schema, registry, migrate, quiz grading + answer hashes, URL allowlists)                                           | Content                                                                                                                    | R3                      | Stable   | Schema changes require a `migrate.ts` step; never edit a released version. Shared with the API      |
| `api-client`                                                                                                                        | Platform (per-client files: the feature owner)                                                                             | R3                      | Evolving | Hand-written, no codegen (docs/03): change the API DTO and its `*.client.ts` in the same PR         |
| `auth`                                                                                                                              | Platform                                                                                                                   | R3 + security review    | Stable   | Clerk integration, guards, interceptors (docs/14 §1–2)                                              |
| `i18n`                                                                                                                              | Platform                                                                                                                   | R1 (+ Product for copy) | Stable   | pt-BR + en-US must stay in sync (locales spec); also `<html lang/dir>` (docs/11 §5)                 |
| `billing`                                                                                                                           | Billing                                                                                                                    | R3                      | Evolving | Price / installment formatting shared by admin + student; the `BillingProvider` lives in `apps/api` |

## Apps

Feature code follows the same roles. Pages and API modules belong to the role that owns the domain; the shells belong to the design-system role of that app.

| Area                                                                                                                                                                                                  | Owner                                          | Review                                                    |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | --------------------------------------------------------- |
| `apps/api` — `gamification`, `leagues`, `items`, `promo-codes`, `referrals`, `engagement`                                                                                                             | Gamification (+ Product for notification copy) | R5 for ledger / reward code                               |
| `apps/api` — `courses`, `modules`, `lessons`, `progress`, `quizzes`, `exercises`, `scenarios`, `ai-grading`, `certificates`, `mastery`, `translations`, `search`                                      | Content                                        | R3; `progress` / grading changes that pay rewards also R5 |
| `apps/api` — `billing`, `plans`, `enrollments`                                                                                                                                                        | Billing                                        | R3 + security review for webhooks                         |
| `apps/api` — `auth`, `account`, `users`, `admin-ops`, `audit`, `notifications`, `email`, `assets`, `analytics`, `flags`, `site-settings`, `categories`, `ops`, `health`, `config`, `common`, `prisma` | Platform                                       | R1; `auth` / `account` R3 + security review               |
| `apps/admin` — shell, `core/`, `shared/`                                                                                                                                                              | DS-Admin                                       | R1                                                        |
| `apps/admin` — `pages/*`                                                                                                                                                                              | the role owning the page's domain (above)      | R1                                                        |
| `apps/student` — shell, `platform/`, `native/`, `offline/`, `telemetry/`                                                                                                                              | DS-Student + Platform                          | R1; `offline/` sync R3 (docs/16)                          |
| `apps/student` — `pages/*`, `components/*`                                                                                                                                                            | the role owning the page's domain (above)      | R1                                                        |

## Infrastructure & pipeline

| Area                                                             | Owner                    | Review                                                                           |
| ---------------------------------------------------------------- | ------------------------ | -------------------------------------------------------------------------------- |
| `.github/workflows/**`, `infra/**`, Dockerfiles, `renovate.json` | Platform                 | R1; production-affecting changes (release.yml, terraform) need a second engineer |
| `apps/student/fastlane/**`, `mobile.yml`                         | Platform + DS-Student    | R1                                                                               |
| `prisma/schema.prisma`, `prisma/migrations/**`                   | feature owner + Platform | R3; migrations follow docs/13 §10 (backwards-compatible)                         |

## CODEOWNERS template

Once the GitHub teams exist, encode R1 in `.github/CODEOWNERS` (GitHub then
requests the owner automatically; branch protection "Require review from Code
Owners" enforces it):

```
/libs/ui-bootstrap/         @org/ds-admin
/libs/ui-ionic/             @org/ds-student
/libs/ui-tokens/            @org/design @org/ds-admin @org/ds-student
/libs/gamification-engine/  @org/gamification
/libs/domain/               @org/gamification @org/content
/libs/lesson-schema/        @org/content
/libs/api-client/ /libs/auth/ /libs/i18n/ /libs/ui-core/  @org/platform
/libs/billing/              @org/billing
/.github/ /infra/ **/Dockerfile /renovate.json  @org/platform
/apps/admin/                @org/ds-admin
/apps/student/              @org/ds-student
/apps/api/                  @org/platform
/apps/api/src/app/gamification/ /apps/api/src/app/leagues/ /apps/api/src/app/items/  @org/gamification
/apps/api/src/app/billing/ /apps/api/src/app/plans/  @org/billing
/prisma/                    @org/platform
```

CODEOWNERS takes the last matching line, so the per-module `apps/api` lines
come after the `/apps/api/` default; extend them with the Apps table.
