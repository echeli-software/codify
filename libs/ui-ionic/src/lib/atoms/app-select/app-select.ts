import {
  Component,
  ChangeDetectionStrategy,
  forwardRef,
  input,
  signal,
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { IonSelect, IonSelectOption } from '@ionic/angular/standalone';

export interface AppSelectOption<T = string> {
  value: T;
  label: string;
  disabled?: boolean;
}

/**
 * Branded single-select. CVA over <ion-select>; pages get type-safe
 * AppSelectOption<T> instead of stringly-typed values. Multi-select
 * variant lands when a feature actually needs it.
 *
 * Defaults to `interface="action-sheet"` on mobile (one-tap pick) and
 * "popover" on tablet/desktop (no full-screen swipe).
 */
@Component({
  selector: 'cdf-app-select',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IonSelect, IonSelectOption],
  host: { '[attr.data-invalid]': 'invalid() ? "" : null' },
  template: `
    <ion-select
      [value]="value()"
      [disabled]="disabled()"
      [placeholder]="placeholder()"
      [interface]="interface()"
      [label]="ionLabel()"
      [labelPlacement]="labelPlacement()"
      [fill]="fill()"
      [attr.aria-invalid]="invalid() || null"
      [attr.aria-label]="ariaLabel()"
      (ionChange)="onChangeEvent($event)"
      (ionBlur)="onBlur()"
    >
      @for (opt of options(); track $any(opt.value)) {
        <ion-select-option
          [value]="opt.value"
          [disabled]="opt.disabled ?? false"
        >
          {{ opt.label }}
        </ion-select-option>
      }
    </ion-select>
  `,
  styleUrl: './app-select.scss',
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => AppSelect),
      multi: true,
    },
  ],
})
export class AppSelect<T = string> implements ControlValueAccessor {
  readonly options = input.required<AppSelectOption<T>[]>();
  readonly placeholder = input<string | null>(null);
  readonly interface = input<'action-sheet' | 'alert' | 'popover'>(
    'action-sheet',
  );
  readonly ionLabel = input<string | null>(null);
  readonly labelPlacement = input<
    'fixed' | 'stacked' | 'floating' | 'start' | 'end'
  >('stacked');
  readonly invalid = input(false);
  readonly fill = input<'outline' | 'solid'>('outline');
  /** Accessible name when no visible `ionLabel` is shown. */
  readonly ariaLabel = input<string | null>(null);

  protected readonly value = signal<T | null>(null);
  protected readonly disabled = signal(false);

  // ─── ControlValueAccessor ────────────────────────────────────────────────
  private onChange: (v: T | null) => void = () => undefined;
  private onTouched: () => void = () => undefined;

  writeValue(value: T | null | undefined): void {
    this.value.set(value ?? null);
  }
  registerOnChange(fn: (v: T | null) => void): void {
    this.onChange = fn;
  }
  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }
  setDisabledState(isDisabled: boolean): void {
    this.disabled.set(isDisabled);
  }

  protected onChangeEvent(ev: CustomEvent<{ value: T | null }>): void {
    const v = ev.detail.value ?? null;
    this.value.set(v);
    this.onChange(v);
  }

  protected onBlur(): void {
    this.onTouched();
  }
}
