// `@codify/ui-core/format` entry point.
export {
  formatCurrency,
  formatInstallmentAmount,
  formatInstallments,
  type FormatCurrencyOptions,
  type FormatInstallmentsInput,
  type FormattedInstallments,
} from './currency.js';
export {
  formatXp,
  formatCoins,
  formatCompact,
  formatMultiplier,
} from './numbers.js';
export {
  formatDuration,
  type DurationUnit,
  type FormattedDuration,
} from './duration.js';
export { formatRelative, formatRelativeDate } from './relative.js';
