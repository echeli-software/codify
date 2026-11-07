# 19 — Component ownership matrix

Roadmap Phase 2 acceptance: _"Component ownership matrix written (who owns
each component for evolution)."_ This is that matrix for every component in
`libs/ui-bootstrap` and `libs/ui-ionic` and for every other library, plus the
rules for changing them. It complements [03-shared-libraries.md](./03-shared-libraries.md)
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

| Rule                     | Applies to                                                                                      | Requirement                                                                      |
| ------------------------ | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| **R1 — Owner review**    | any change                                                                                      | 1 approval from the owning role                                                  |
| **R2 — Owner + Design**  | visual change: new variant, spacing/colour/typography, motion, icon                             | R1 + Design approval on the Storybook preview (storybook.yml publishes `pr-<n>`) |
| **R3 — Contract change** | public inputs/outputs/selectors, exported TS types, service APIs                                | R1 + every consuming app's owner; deprecate first (see Evolution)                |
| **R4 — Cross-lib**       | anything re-exported by both UI libs (`AvatarRenderer`, `LessonBlockRenderer`) or token changes | DS-Admin **and** DS-Student + Design                                             |
| **R5 — Integrity**       | reward/coin/XP/streak logic or visuals that imply a reward                                      | R1 + Gamification; server stays authoritative (docs/07)                          |

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

| Component                                                                                 | Selector / export                 | Layer         | Owner                           | Review                                                | Policy   |
| ----------------------------------------------------------------------------------------- | --------------------------------- | ------------- | ------------------------------- | ----------------------------------------------------- | -------- |
| Avatar                                                                                    | `atoms/avatar`                    | atom          | DS-Admin                        | R2                                                    | Stable   |
| Badge                                                                                     | `atoms/badge`                     | atom          | DS-Admin                        | R2                                                    | Stable   |
| Button                                                                                    | `atoms/button`                    | atom          | DS-Admin                        | R2                                                    | Stable   |
| Checkbox                                                                                  | `atoms/checkbox`                  | atom          | DS-Admin                        | R2                                                    | Stable   |
| Divider                                                                                   | `atoms/divider`                   | atom          | DS-Admin                        | R1                                                    | Stable   |
| Icon                                                                                      | `atoms/icon`                      | atom          | DS-Admin                        | R4 (shared icon set with student)                     | Stable   |
| IconButton                                                                                | `atoms/icon-button`               | atom          | DS-Admin                        | R2                                                    | Stable   |
| Input                                                                                     | `atoms/input`                     | atom          | DS-Admin                        | R2                                                    | Stable   |
| Kbd                                                                                       | `atoms/kbd`                       | atom          | DS-Admin                        | R1                                                    | Stable   |
| ProgressBar                                                                               | `atoms/progress-bar`              | atom          | DS-Admin                        | R2                                                    | Stable   |
| Radio                                                                                     | `atoms/radio`                     | atom          | DS-Admin                        | R2                                                    | Stable   |
| Select                                                                                    | `atoms/select`                    | atom          | DS-Admin                        | R2                                                    | Stable   |
| Skeleton                                                                                  | `atoms/skeleton`                  | atom          | DS-Admin                        | R1                                                    | Stable   |
| Spinner                                                                                   | `atoms/spinner`                   | atom          | DS-Admin                        | R1                                                    | Stable   |
| Tag                                                                                       | `atoms/tag`                       | atom          | DS-Admin                        | R2                                                    | Stable   |
| Textarea                                                                                  | `atoms/textarea`                  | atom          | DS-Admin                        | R2                                                    | Stable   |
| Toggle                                                                                    | `atoms/toggle`                    | atom          | DS-Admin                        | R2                                                    | Stable   |
| Tooltip                                                                                   | `atoms/tooltip`                   | atom          | DS-Admin                        | R2                                                    | Stable   |
| BreadcrumbBar                                                                             | `molecules/breadcrumb-bar`        | molecule      | DS-Admin                        | R2                                                    | Stable   |
| ConfirmDialog                                                                             | `molecules/confirm-dialog`        | molecule      | DS-Admin                        | R2                                                    | Stable   |
| EmptyState                                                                                | `molecules/empty-state`           | molecule      | DS-Admin                        | R2                                                    | Stable   |
| FormField                                                                                 | `molecules/form-field`            | molecule      | DS-Admin                        | R3 (used by every admin form)                         | Stable   |
| KeyValueList                                                                              | `molecules/key-value-list`        | molecule      | DS-Admin                        | R2                                                    | Stable   |
| LanguageSwitcher                                                                          | `molecules/language-switcher`     | molecule      | DS-Admin + Platform (i18n)      | R3                                                    | Stable   |
| Pagination                                                                                | `molecules/pagination`            | molecule      | DS-Admin                        | R2                                                    | Stable   |
| PriceTag                                                                                  | `molecules/price-tag`             | molecule      | Billing                         | R4 (same contract as student `PriceTag`)              | Stable   |
| SearchBar                                                                                 | `molecules/search-bar`            | molecule      | DS-Admin                        | R2                                                    | Stable   |
| ThemeToggle + ThemeService                                                                | `molecules/theme-toggle`          | molecule      | DS-Admin + Design               | R4 (theme tokens)                                     | Stable   |
| Toast host + ToastService                                                                 | `molecules/toast`                 | molecule      | DS-Admin                        | R3 (service API)                                      | Stable   |
| AppShell                                                                                  | `organisms/app-shell`             | organism      | DS-Admin                        | R3                                                    | Evolving |
| DataTable                                                                                 | `organisms/data-table`            | organism      | DS-Admin                        | R3                                                    | Evolving |
| JsonEditor                                                                                | `organisms/json-editor`           | organism      | Content                         | R1                                                    | Evolving |
| LessonBlockEditor (+ Tiptap extensions, callout)                                          | `organisms/lesson-block-editor`   | organism      | Content                         | R3 + Content (schema)                                 | Evolving |
| LessonBlockRenderer                                                                       | `organisms/lesson-block-renderer` | organism      | Content                         | R4 (single source for admin preview + student player) | Stable   |
| Modal frame + ModalService                                                                | `organisms/modal`                 | organism      | DS-Admin                        | R3                                                    | Stable   |
| MoneyInput                                                                                | `organisms/money-input`           | organism      | Billing                         | R2                                                    | Stable   |
| PlanFeatureList                                                                           | `organisms/plan-feature-list`     | organism      | Billing                         | R2                                                    | Evolving |
| Combobox, Popover, Chip, Drawer, FileUploader, ImageCropper, DateRangePicker, AssetPicker | —                                 | atom/molecule | DS-Admin                        | R2                                                    | Planned  |
| BlockToolbar, BlockMenu                                                                   | —                                 | organism      | Content                         | R3                                                    | Planned  |
| MediaLibrary                                                                              | —                                 | organism      | Content + Platform (R2 uploads) | R3                                                    | Planned  |
| ItemSpritePreview, MultiplierEditor                                                       | —                                 | organism      | Gamification                    | R5                                                    | Planned  |
| CategoryAssignmentMatrix                                                                  | —                                 | organism      | Billing                         | R3                                                    | Planned  |

## `libs/ui-ionic` (student)

| Component                                                                                                        | Selector / export                | Layer    | Owner                                                              | Review                                          | Policy                                |
| ---------------------------------------------------------------------------------------------------------------- | -------------------------------- | -------- | ------------------------------------------------------------------ | ----------------------------------------------- | ------------------------------------- |
| AppAvatar                                                                                                        | `atoms/app-avatar`               | atom     | DS-Student                                                         | R4 (uses `AvatarRenderer`)                      | Stable                                |
| AppBadge                                                                                                         | `atoms/app-badge`                | atom     | DS-Student                                                         | R2                                              | Stable                                |
| AppButton                                                                                                        | `atoms/app-button`               | atom     | DS-Student                                                         | R2                                              | Stable                                |
| AppCard                                                                                                          | `atoms/app-card`                 | atom     | DS-Student                                                         | R2                                              | Stable                                |
| AppCheckbox                                                                                                      | `atoms/app-checkbox`             | atom     | DS-Student                                                         | R2                                              | Stable                                |
| AppChip                                                                                                          | `atoms/app-chip`                 | atom     | DS-Student                                                         | R2                                              | Stable                                |
| AppInput                                                                                                         | `atoms/app-input`                | atom     | DS-Student                                                         | R2                                              | Stable                                |
| AppProgressBar                                                                                                   | `atoms/app-progress-bar`         | atom     | DS-Student                                                         | R2                                              | Stable                                |
| AppSelect                                                                                                        | `atoms/app-select`               | atom     | DS-Student                                                         | R2                                              | Stable                                |
| AppSkeleton                                                                                                      | `atoms/app-skeleton`             | atom     | DS-Student                                                         | R1                                              | Stable                                |
| AppSpinner                                                                                                       | `atoms/app-spinner`              | atom     | DS-Student                                                         | R1                                              | Stable                                |
| AppTag                                                                                                           | `atoms/app-tag`                  | atom     | DS-Student                                                         | R2                                              | Stable                                |
| AppToggle                                                                                                        | `atoms/app-toggle`               | atom     | DS-Student                                                         | R2                                              | Stable                                |
| CoinBadge                                                                                                        | `atoms/coin-badge`               | atom     | Gamification                                                       | R5                                              | Stable                                |
| Icon                                                                                                             | `atoms/icon`                     | atom     | DS-Student                                                         | R4 (shared icon set with admin)                 | Stable                                |
| XpBadge                                                                                                          | `atoms/xp-badge`                 | atom     | Gamification                                                       | R5                                              | Stable                                |
| AvatarRenderer                                                                                                   | `molecules/avatar-renderer`      | molecule | Gamification (avatar/shop, docs/08)                                | R4 + R5                                         | Stable                                |
| AvatarWithFrame                                                                                                  | `molecules/avatar-with-frame`    | molecule | Gamification                                                       | R5                                              | Stable                                |
| CourseCard                                                                                                       | `molecules/course-card`          | molecule | DS-Student                                                         | R2                                              | Stable                                |
| EmptyState                                                                                                       | `molecules/empty-state`          | molecule | DS-Student                                                         | R2                                              | Stable                                |
| FormField                                                                                                        | `molecules/form-field`           | molecule | DS-Student                                                         | R3                                              | Stable                                |
| LessonItem                                                                                                       | `molecules/lesson-item`          | molecule | Content                                                            | R3 (lesson-type union)                          | Evolving                              |
| LevelBadge                                                                                                       | `molecules/level-badge`          | molecule | Gamification                                                       | R5                                              | Stable                                |
| RewardToast                                                                                                      | `molecules/reward-toast`         | molecule | Gamification                                                       | R5 (played only via `RewardOrchestrator`)       | Stable                                |
| StreakChip                                                                                                       | `molecules/streak-chip`          | molecule | Gamification                                                       | R5                                              | Stable                                |
| XpBar                                                                                                            | `molecules/xp-bar`               | molecule | Gamification                                                       | R5                                              | Stable                                |
| AppShell                                                                                                         | `organisms/app-shell`            | organism | DS-Student                                                         | R3 (tabs ↔ sidebar breakpoints)                 | Evolving                              |
| BadgeUnlockOverlay                                                                                               | `organisms/badge-unlock-overlay` | organism | Gamification                                                       | R5                                              | Stable                                |
| CoursePreviewModal                                                                                               | `organisms/course-preview-modal` | organism | DS-Student + Billing                                               | R3                                              | Evolving                              |
| DailyQuestList                                                                                                   | `organisms/daily-quest-list`     | organism | Gamification                                                       | R5                                              | Evolving                              |
| LevelUpModal                                                                                                     | `organisms/level-up-modal`       | organism | Gamification                                                       | R5                                              | Stable                                |
| OnboardingCarousel                                                                                               | `organisms/onboarding-carousel`  | organism | DS-Student + Product (copy)                                        | R2                                              | Evolving                              |
| PaywallSheet                                                                                                     | `organisms/paywall-sheet`        | organism | Billing                                                            | R3 (native IAP vs web checkout, docs/17-mobile) | Evolving                              |
| StreakWidget                                                                                                     | `organisms/streak-widget`        | organism | Gamification                                                       | R5                                              | Stable                                |
| `demo/*` (Today, lesson player demos)                                                                            | `demo`                           | demo     | DS-Student                                                         | R1                                              | Experimental                          |
| SearchBar, PlanCard, PriceTag, CoinCounter, BottomSheet, ErrorState, OfflineState, LanguageSwitcher, ThemeToggle | —                                | molecule | DS-Student (PriceTag/PlanCard: Billing; CoinCounter: Gamification) | R2 / R4 / R5                                    | Planned                               |
| LessonPlayer, QuizRenderer, ExerciseRunner, ScenarioRunner, AiPromptPlayground                                   | — (live in `apps/student` today) | organism | Content                                                            | R3                                              | Evolving → promote to lib when reused |
| LeaderboardTable, ShopGrid, Inventory, AvatarBuilder, CelebrationOverlay, MysteryChestOpener                     | —                                | organism | Gamification                                                       | R5                                              | Planned                               |

## Other libraries

| Library                                                                                | Owner                                                                          | Review                  | Policy   | Notes                                                                       |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ----------------------- | -------- | --------------------------------------------------------------------------- |
| `ui-tokens`                                                                            | Design + DS-Admin + DS-Student                                                 | R4                      | Stable   | Every token rename is a breaking change for both apps; add, don't rename    |
| `ui-core` (format, level, color, random, validate)                                     | Platform                                                                       | R3                      | Stable   | 100 % test coverage required (roadmap Phase 1)                              |
| `domain` (leagues, multipliers, items, exercises, AI grading, certificates, scenarios) | Gamification (reward/league math) · Content (exercises, scenarios, AI grading) | R3 + R5 for reward math | Stable   | Shared by API and apps — pure functions only, changes need API + app owners |
| `gamification-engine` (`RewardOrchestrator`, animation, sound, haptics, state)         | Gamification                                                                   | R5                      | Stable   | All reward playback goes through `RewardOrchestrator` (lint-enforced)       |
| `lesson-schema` (schema, registry, migrate)                                            | Content                                                                        | R3                      | Stable   | Schema changes require a `migrate.ts` step; never edit a released version   |
| `api-client`                                                                           | Platform (per-client files: the feature owner)                                 | R3                      | Evolving | Mirrors API contracts; types live next to their client                      |
| `auth`                                                                                 | Platform                                                                       | R3 + security review    | Stable   | Clerk integration, guards, interceptors (docs/14 §1–2)                      |
| `i18n`                                                                                 | Platform                                                                       | R1 (+ Product for copy) | Stable   | pt-BR + en-US must stay in sync (locales spec)                              |
| `billing`                                                                              | Billing                                                                        | R3                      | Evolving | Pricing/installment math shared by admin + student                          |

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
```
