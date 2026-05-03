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
export { AppAvatar, type AppAvatarSize } from './lib/atoms/app-avatar/app-avatar.js';
export { AppBadge, type AppBadgeVariant } from './lib/atoms/app-badge/app-badge.js';
export { AppTag } from './lib/atoms/app-tag/app-tag.js';
export { AppChip, type AppChipVariant } from './lib/atoms/app-chip/app-chip.js';
export {
  AppSpinner,
  type AppSpinnerSize,
  type AppSpinnerVariant,
} from './lib/atoms/app-spinner/app-spinner.js';

// ─── Atoms — gamification ────────────────────────────────────────────────
export { XpBadge } from './lib/atoms/xp-badge/xp-badge.js';
export { CoinBadge } from './lib/atoms/coin-badge/coin-badge.js';
