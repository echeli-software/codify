import {
  Component,
  ChangeDetectionStrategy,
  computed,
  forwardRef,
  inject,
  input,
  signal,
} from '@angular/core';
import {
  ControlValueAccessor,
  FormsModule,
  NG_VALUE_ACCESSOR,
} from '@angular/forms';
import { I18nService } from '@codify/i18n';
import { Input as TextInput } from '../../atoms/input/input.js';

/**
 * Masked currency input. The form value is **always integer cents** so
 * round-tripping through Stripe/Prisma is lossless. The display formats
 * per the active locale.
 *
 *   <cdf-money-input [(ngModel)]="amountCents" currency="BRL" />
 *
 * Edits are accepted as either "39,90" (pt-BR) or "39.90" (en-US); both
 * produce 3990 cents.
 */
@Component({
  selector: 'cdf-money-input',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, TextInput],
  template: `
    <span class="cdf-money">
      <span class="cdf-money__symbol">{{ symbol() }}</span>
      <cdf-input
        class="cdf-money__field"
        [ngModel]="display()"
        (ngModelChange)="onUserInput($event)"
        [invalid]="invalid()"
        [placeholder]="placeholder()"
        inputmode="decimal"
      />
    </span>
  `,
  styleUrl: './money-input.scss',
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => MoneyInput),
      multi: true,
    },
  ],
})
export class MoneyInput implements ControlValueAccessor {
  readonly currency = input<string>('BRL');
  readonly invalid = input(false);
  readonly placeholder = input<string>('');

  private readonly i18n = inject(I18nService);

  /** Stored value in cents. Source of truth. */
  protected readonly cents = signal<number | null>(null);

  /** Display value as the user sees + types it. */
  protected readonly display = computed(() => {
    const c = this.cents();
    if (c === null) return '';
    return this.formatDisplay(c, this.i18n.currentLocale());
  });

  /** Currency symbol prefix derived from Intl format. */
  protected readonly symbol = computed(() =>
    this.symbolFor(this.currency(), this.i18n.currentLocale()),
  );

  private onChange: (v: number | null) => void = () => undefined;
  private onTouched: () => void = () => undefined;

  writeValue(value: number | null | undefined): void {
    this.cents.set(value ?? null);
  }
  registerOnChange(fn: (v: number | null) => void): void {
    this.onChange = fn;
  }
  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }
  setDisabledState(_isDisabled: boolean): void {
    // Disabled state is owned by the inner cdf-input; we'd thread it via input
    // signal, but for now this minimal mask doesn't expose it.
  }

  protected onUserInput(raw: string): void {
    this.cents.set(this.parseToCents(raw));
    this.onChange(this.cents());
    this.onTouched();
  }

  // ─── helpers ──────────────────────────────────────────────────────────────

  private parseToCents(raw: string): number | null {
    if (!raw || raw.trim() === '') return null;
    // Strip everything except digits, commas, dots, and minus.
    let cleaned = raw.replace(/[^\d,.-]/g, '');
    // If both `,` and `.` appear, assume the LAST one is the decimal separator.
    const lastComma = cleaned.lastIndexOf(',');
    const lastDot = cleaned.lastIndexOf('.');
    let decimalSep: string | null = null;
    if (lastComma > -1 || lastDot > -1) {
      decimalSep = lastComma > lastDot ? ',' : '.';
    }
    if (decimalSep) {
      // Remove all separators except the last decimal one
      cleaned = cleaned
        .split('')
        .filter((ch, i) => {
          if (ch !== ',' && ch !== '.') return true;
          // Keep only the last decimal separator instance
          return (
            ch === decimalSep && (ch === ',' ? i === lastComma : i === lastDot)
          );
        })
        .join('');
      // Normalize to '.'
      cleaned = cleaned.replace(decimalSep, '.');
    }
    const num = parseFloat(cleaned);
    if (Number.isNaN(num)) return null;
    return Math.round(num * 100);
  }

  private formatDisplay(cents: number, locale: string): string {
    return new Intl.NumberFormat(locale, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(cents / 100);
  }

  private symbolFor(currency: string, locale: string): string {
    try {
      const parts = new Intl.NumberFormat(locale, {
        style: 'currency',
        currency,
      }).formatToParts(0);
      return parts.find((p) => p.type === 'currency')?.value ?? currency;
    } catch {
      return currency;
    }
  }
}
