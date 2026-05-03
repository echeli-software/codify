// Public surface of @codify/ui-core. Pure TS; no DOM, no Angular.
// See docs/03-shared-libraries.md.

// Format
export {
  formatCurrency,
  formatInstallmentAmount,
  type FormatCurrencyOptions,
} from './lib/format/currency.js';
export {
  formatXp,
  formatCoins,
  formatCompact,
  formatMultiplier,
} from './lib/format/numbers.js';
export {
  formatDuration,
  type DurationUnit,
  type FormattedDuration,
} from './lib/format/duration.js';
export { formatRelative } from './lib/format/relative.js';

// Level
export {
  xpForLevel,
  levelFromXp,
  xpToNextLevel,
  levelProgress,
  levelProgressPct,
  tierForLevel,
  type LevelTier,
} from './lib/level/level.js';

// Validate
export {
  Email,
  Slug,
  LocaleCode,
  Currency,
  HexColor,
  DisplayName,
} from './lib/validate/primitives.js';

// Color
export {
  getContrastingTextColor,
  contrastRatio,
} from './lib/color/contrast.js';

// Random
export { mulberry32, pickSeeded } from './lib/random/seeded.js';
