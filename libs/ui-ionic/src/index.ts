// Public surface of @codify/ui-ionic. Student-app component primitives
// branded over Ionic. See docs/03-shared-libraries.md §`libs/ui-ionic/`.

// ─── Atoms — structural ──────────────────────────────────────────────────
export { Icon, type IconName, ICON_NAMES } from './lib/atoms/icon/icon.js';
export {
  AppButton,
  type AppButtonKind,
  type AppButtonSize,
  type AppButtonType,
} from './lib/atoms/app-button/app-button.js';
export {
  AppCard,
  type AppCardElevation,
  type AppCardPadding,
} from './lib/atoms/app-card/app-card.js';
export {
  AppAvatar,
  type AppAvatarSize,
} from './lib/atoms/app-avatar/app-avatar.js';
export {
  AppBadge,
  type AppBadgeVariant,
} from './lib/atoms/app-badge/app-badge.js';
export { AppTag } from './lib/atoms/app-tag/app-tag.js';
export { AppChip, type AppChipVariant } from './lib/atoms/app-chip/app-chip.js';
export {
  AppSpinner,
  type AppSpinnerSize,
  type AppSpinnerVariant,
} from './lib/atoms/app-spinner/app-spinner.js';

// ─── Atoms — form controls ───────────────────────────────────────────────
export {
  AppInput,
  type AppInputType,
} from './lib/atoms/app-input/app-input.js';
export {
  AppSelect,
  type AppSelectOption,
} from './lib/atoms/app-select/app-select.js';
export { AppCheckbox } from './lib/atoms/app-checkbox/app-checkbox.js';
export { AppToggle } from './lib/atoms/app-toggle/app-toggle.js';

// ─── Atoms — state ───────────────────────────────────────────────────────
export {
  AppSkeleton,
  type AppSkeletonShape,
} from './lib/atoms/app-skeleton/app-skeleton.js';
export {
  AppProgressBar,
  type AppProgressBarVariant,
  type AppProgressBarSize,
} from './lib/atoms/app-progress-bar/app-progress-bar.js';

// ─── Atoms — gamification ────────────────────────────────────────────────
export { XpBadge } from './lib/atoms/xp-badge/xp-badge.js';
export { CoinBadge } from './lib/atoms/coin-badge/coin-badge.js';

// ─── Molecules ───────────────────────────────────────────────────────────
export { FormField } from './lib/molecules/form-field/form-field.js';
export { LevelBadge } from './lib/molecules/level-badge/level-badge.js';
export { StreakChip } from './lib/molecules/streak-chip/streak-chip.js';
export { XpBar } from './lib/molecules/xp-bar/xp-bar.js';
export {
  LessonItem,
  type LessonItemType,
  type LessonItemStatus,
} from './lib/molecules/lesson-item/lesson-item.js';
export {
  CourseCard,
  type CourseCategoryRef,
} from './lib/molecules/course-card/course-card.js';
export { EmptyState } from './lib/molecules/empty-state/empty-state.js';
export { RewardToast } from './lib/molecules/reward-toast/reward-toast.js';
export { AvatarWithFrame } from './lib/molecules/avatar-with-frame/avatar-with-frame.js';
export {
  AvatarRenderer,
  type AvatarSlot,
  type AvatarSprite,
  type AvatarConfigLike,
} from './lib/molecules/avatar-renderer/avatar-renderer.js';

// ─── Organisms ───────────────────────────────────────────────────────────
export {
  AppShell,
  type ShellTab,
} from './lib/organisms/app-shell/app-shell.js';
export {
  DailyQuestList,
  type DailyQuest,
  type DailyQuestKind,
} from './lib/organisms/daily-quest-list/daily-quest-list.js';
export {
  StreakWidget,
  type StreakDay,
} from './lib/organisms/streak-widget/streak-widget.js';
export {
  CoursePreviewModal,
  type CoursePreview,
  type CoursePreviewLesson,
} from './lib/organisms/course-preview-modal/course-preview-modal.js';
export {
  PaywallSheet,
  type PaywallReason,
  type PaywallPlan,
  type PaywallContent,
} from './lib/organisms/paywall-sheet/paywall-sheet.js';
export {
  OnboardingCarousel,
  type OnboardingSlide,
} from './lib/organisms/onboarding-carousel/onboarding-carousel.js';
export { LevelUpModal } from './lib/organisms/level-up-modal/level-up-modal.js';
export { BadgeUnlockOverlay } from './lib/organisms/badge-unlock-overlay/badge-unlock-overlay.js';

// ─── Roadmap completion additions ────────────────────────────────────────
export { SearchBar } from './lib/molecules/search-bar/search-bar.js';
export {
  PriceTag,
  type BillingPeriod,
} from './lib/molecules/price-tag/price-tag.js';
export { PlanCard } from './lib/molecules/plan-card/plan-card.js';
export { CoinCounter } from './lib/molecules/coin-counter/coin-counter.js';
export { BottomSheet } from './lib/molecules/bottom-sheet/bottom-sheet.js';
export { ErrorState } from './lib/molecules/error-state/error-state.js';
export { OfflineState } from './lib/molecules/offline-state/offline-state.js';
export { LanguageSwitcher } from './lib/molecules/language-switcher/language-switcher.js';
export { ThemeToggle } from './lib/molecules/theme-toggle/theme-toggle.js';
export {
  ThemeService,
  type ThemeMode,
} from './lib/molecules/theme-toggle/theme.service.js';
export { formatMinutes } from './lib/molecules/course-card/course-card.js';
export {
  LeaderboardTable,
  LeaderboardAvatar,
  leaderboardZone,
  type LeaderboardRow,
  type LeaderboardZone,
} from './lib/organisms/leaderboard-table/leaderboard-table.js';
export {
  RARITIES,
  SLOT_ORDER,
  affordability,
  spriteGlyph,
  type Affordability,
  type ItemRarity,
  type ShopItem,
} from './lib/organisms/shop-grid/shop-item.js';
export { ShopGrid } from './lib/organisms/shop-grid/shop-grid.js';
export { SAMPLE_ITEMS } from './lib/organisms/shop-grid/sample-items.js';
export {
  Inventory,
  groupBySlot,
  type InventoryGroup,
} from './lib/organisms/inventory/inventory.js';
export {
  AvatarBuilder,
  type EquippedMap,
} from './lib/organisms/avatar-builder/avatar-builder.js';
export {
  CelebrationOverlay,
  confettiPieces,
  type ConfettiPiece,
} from './lib/organisms/celebration-overlay/celebration-overlay.js';
export {
  ExerciseRunner,
  type ExerciseAction,
  type ExerciseTestView,
  type ExerciseView,
} from './lib/organisms/exercise-runner/exercise-runner.js';
export {
  ScenarioRunner,
  stepScenario,
  type ScenarioChoiceView,
  type ScenarioFinish,
  type ScenarioGraphView,
  type ScenarioNodeView,
} from './lib/organisms/scenario-runner/scenario-runner.js';
export {
  AiPromptPlayground,
  rubricRows,
  type AiCriterionView,
  type AiPromptView,
  type RubricRow,
  type RubricState,
} from './lib/organisms/ai-prompt-playground/ai-prompt-playground.js';
