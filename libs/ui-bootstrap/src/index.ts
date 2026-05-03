// Public surface of @codify/ui-bootstrap.
// SCSS is exposed via the `./scss/bootstrap` subpath export — see package.json.

// ─── Atoms — structural ───────────────────────────────────────────────────
export { Button, type ButtonKind, type ButtonSize, type ButtonType } from './lib/atoms/button/button.js';
export { IconButton } from './lib/atoms/icon-button/icon-button.js';
export { Icon, type IconName, ICON_NAMES } from './lib/atoms/icon/icon.js';
export { Spinner } from './lib/atoms/spinner/spinner.js';
export { Badge, type BadgeVariant } from './lib/atoms/badge/badge.js';
export { Tag } from './lib/atoms/tag/tag.js';
export { Skeleton, type SkeletonShape } from './lib/atoms/skeleton/skeleton.js';
export {
  ProgressBar,
  type ProgressBarVariant,
  type ProgressBarSize,
} from './lib/atoms/progress-bar/progress-bar.js';
export { Divider } from './lib/atoms/divider/divider.js';
export { Kbd } from './lib/atoms/kbd/kbd.js';
export { Tooltip } from './lib/atoms/tooltip/tooltip.js';

// ─── Atoms — form controls ────────────────────────────────────────────────
export { Input, type InputType, type InputSize } from './lib/atoms/input/input.js';
export { Textarea } from './lib/atoms/textarea/textarea.js';
export { Select, type SelectOption } from './lib/atoms/select/select.js';
export { RadioGroup, type RadioOption } from './lib/atoms/radio/radio.js';
export { Checkbox } from './lib/atoms/checkbox/checkbox.js';
export { Toggle } from './lib/atoms/toggle/toggle.js';
export { Avatar, type AvatarSize } from './lib/atoms/avatar/avatar.js';

// ─── Molecules ────────────────────────────────────────────────────────────
export { FormField } from './lib/molecules/form-field/form-field.js';
export { SearchBar } from './lib/molecules/search-bar/search-bar.js';
export { EmptyState } from './lib/molecules/empty-state/empty-state.js';
export { KeyValueList, type KeyValueRow } from './lib/molecules/key-value-list/key-value-list.js';
export { PriceTag, type BillingPeriod } from './lib/molecules/price-tag/price-tag.js';
export {
  BreadcrumbBar,
  type BreadcrumbCrumb,
} from './lib/molecules/breadcrumb-bar/breadcrumb-bar.js';
export { LanguageSwitcher } from './lib/molecules/language-switcher/language-switcher.js';
export { ThemeToggle } from './lib/molecules/theme-toggle/theme-toggle.js';
export { ThemeService, type ThemeMode } from './lib/molecules/theme-toggle/theme.service.js';
export { Pagination } from './lib/molecules/pagination/pagination.js';
export { ToastService, type Toast, type ToastVariant } from './lib/molecules/toast/toast.service.js';
export { ToastHost } from './lib/molecules/toast/toast-host.js';
export {
  ConfirmDialogService,
  type ConfirmDialogOptions,
} from './lib/molecules/confirm-dialog/confirm-dialog.js';
