// Public surface of @codify/ui-bootstrap.
// SCSS is exposed via the `./scss/bootstrap` subpath export — see package.json.

// ─── Atoms — structural ───────────────────────────────────────────────────
export {
  Button,
  type ButtonKind,
  type ButtonSize,
  type ButtonType,
} from './lib/atoms/button/button.js';
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
export {
  Input,
  type InputType,
  type InputSize,
} from './lib/atoms/input/input.js';
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
export {
  KeyValueList,
  type KeyValueRow,
} from './lib/molecules/key-value-list/key-value-list.js';
export {
  PriceTag,
  type BillingPeriod,
} from './lib/molecules/price-tag/price-tag.js';
export {
  BreadcrumbBar,
  type BreadcrumbCrumb,
} from './lib/molecules/breadcrumb-bar/breadcrumb-bar.js';
export { LanguageSwitcher } from './lib/molecules/language-switcher/language-switcher.js';
export { ThemeToggle } from './lib/molecules/theme-toggle/theme-toggle.js';
export {
  ThemeService,
  type ThemeMode,
} from './lib/molecules/theme-toggle/theme.service.js';
export { Pagination } from './lib/molecules/pagination/pagination.js';
export {
  ToastService,
  type Toast,
  type ToastVariant,
} from './lib/molecules/toast/toast.service.js';
export { ToastHost } from './lib/molecules/toast/toast-host.js';
export {
  ConfirmDialogService,
  type ConfirmDialogOptions,
} from './lib/molecules/confirm-dialog/confirm-dialog.js';

// ─── Organisms ────────────────────────────────────────────────────────────
export {
  AppShell,
  type NavItem,
  type NavSection,
} from './lib/organisms/app-shell/app-shell.js';
export {
  ModalService,
  type OpenModalOptions,
} from './lib/organisms/modal/modal.service.js';
export { ModalFrame } from './lib/organisms/modal/modal-frame.js';
export {
  DataTable,
  DataTableCell,
  type DataTableColumn,
  type SortDirection,
  type SortState,
} from './lib/organisms/data-table/data-table.js';
export { MoneyInput } from './lib/organisms/money-input/money-input.js';
export {
  PlanFeatureList,
  type PlanFeature,
  type PlanCategoryRef,
} from './lib/organisms/plan-feature-list/plan-feature-list.js';
export { JsonEditor } from './lib/organisms/json-editor/json-editor.js';
export { LessonBlockEditor } from './lib/organisms/lesson-block-editor/lesson-block-editor.js';
export { LessonBlockRenderer } from './lib/organisms/lesson-block-renderer/lesson-block-renderer.js';
export {
  LESSON_BLOCK_RENDERER,
  LessonRefSlot,
  type LessonQuizResult,
  type LessonRefSlotContext,
} from './lib/organisms/lesson-block-renderer/lesson-render-context.js';
export {
  LESSON_ASSET_UPLOADER,
  LESSON_IMAGE_TYPES,
  LESSON_IMAGE_MAX_BYTES,
  type LessonAssetUploader,
  type LessonAssetUploadOptions,
  type LessonAssetUploadResult,
} from './lib/organisms/lesson-block-editor/lesson-asset-uploader.js';
export {
  BlockToolbar,
  BLOCK_TOOLBAR_ITEMS,
  type BlockToolbarCommand,
  type BlockToolbarItem,
  type BlockToolbarState,
} from './lib/organisms/block-toolbar/block-toolbar.js';
export {
  BlockMenu,
  blockMenuItemsFromRegistry,
  type BlockMenuItem,
} from './lib/organisms/block-menu/block-menu.js';

// ─── Roadmap completion additions ─────────────────────────────────────────
export { Chip, type ChipVariant } from './lib/atoms/chip/chip.js';
export { Popover } from './lib/atoms/popover/popover.js';
export {
  Combobox,
  type ComboboxOption,
  type ComboboxSource,
} from './lib/atoms/combobox/combobox.js';
export {
  Drawer,
  type DrawerPosition,
  type DrawerSize,
} from './lib/molecules/drawer/drawer.js';
export {
  FileUploader,
  matchesAccept,
  type UploadItem,
  type UploadStatus,
} from './lib/molecules/file-uploader/file-uploader.js';
export {
  FILE_UPLOADER,
  type FileUploaderBackend,
  type UploadEvent,
} from './lib/molecules/file-uploader/file-uploader.token.js';
export {
  ImageCropper,
  type CroppedImage,
} from './lib/molecules/image-cropper/image-cropper.js';
export {
  clampOffsets,
  cropRect,
  initialCrop,
  minCoverScale,
  zoomTo,
  type CropRect,
  type CropState,
} from './lib/molecules/image-cropper/crop-math.js';
export {
  DateRangePicker,
  isInvertedRange,
  type DateRange,
  type DateRangePreset,
} from './lib/molecules/date-range-picker/date-range-picker.js';
export {
  AssetPicker,
  AssetPickerDialog,
} from './lib/molecules/asset-picker/asset-picker.js';
export {
  MediaLibrary,
  assetDisplayName,
} from './lib/organisms/media-library/media-library.js';
export {
  ASSET_LIBRARY,
  ASSET_KINDS,
  type AssetKind,
  type AssetLibrary,
  type AssetPage,
  type AssetSummary,
} from './lib/organisms/media-library/asset-library.token.js';
export { FakeAssetLibrary } from './lib/organisms/media-library/fake-asset-library.js';
export {
  ItemSpritePreview,
  type PreviewItem,
  type ItemRarity,
} from './lib/organisms/item-sprite-preview/item-sprite-preview.js';
export {
  MultiplierEditor,
  MULTIPLIER_KINDS,
  MULTIPLIER_MAX,
  emptyMultiplier,
  scopeOf,
  validateMultiplier,
  type MultiplierDraft,
  type MultiplierError,
  type MultiplierKind,
  type MultiplierScope,
  type MultiplierTarget,
} from './lib/organisms/multiplier-editor/multiplier-editor.js';
export {
  CategoryAssignmentMatrix,
  toggleAssignment,
  type CategoryAssignments,
  type MatrixCategory,
  type MatrixPlan,
} from './lib/organisms/category-assignment-matrix/category-assignment-matrix.js';
export {
  type PaginationMode,
  type CursorPageEvent,
} from './lib/molecules/pagination/pagination.js';
export { applyModalInputs } from './lib/organisms/modal/modal.service.js';
// Truly shared visual (docs/03): the same AvatarRenderer as the student app.
export {
  AvatarRenderer,
  type AvatarSlot,
  type AvatarSprite,
  type AvatarConfigLike,
} from '@codify/ui-ionic/avatar-renderer';
