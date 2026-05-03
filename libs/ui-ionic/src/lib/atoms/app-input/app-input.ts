import {
  Component,
  ChangeDetectionStrategy,
  forwardRef,
  input,
  signal,
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { IonInput } from '@ionic/angular/standalone';

export type AppInputType = 'text' | 'email' | 'url' | 'password' | 'search' | 'tel' | 'number';

/**
 * Branded text input. CVA over <ion-input> so it works with template-driven
 * and reactive forms. Use the FormField molecule (Phase 3d) to add
 * label/help/error scaffolding.
 *
 * Errors are surfaced visually via `invalid`; the FormField wires the
 * accessible-description attribute (we hold it as a lookup target for
 * the molecule).
 */
@Component({
  selector: 'cdf-app-input',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IonInput],
  host: {
    '[attr.data-invalid]': 'invalid() ? "" : null',
  },
  template: `
    <ion-input
      [type]="type()"
      [value]="value()"
      [disabled]="disabled()"
      [readonly]="readonly()"
      [placeholder]="placeholder()"
      [label]="ionLabel()"
      [labelPlacement]="labelPlacement()"
      [helperText]="helper()"
      [errorText]="errorText()"
      [maxlength]="maxLength()"
      [autocomplete]="autocomplete()"
      [inputmode]="inputmode()"
      [fill]="fill()"
      [attr.aria-invalid]="invalid() || null"
      [attr.aria-describedby]="describedBy() || null"
      (ionInput)="onInput($event)"
      (ionBlur)="onBlur()"
    />
  `,
  styleUrl: './app-input.scss',
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => AppInput),
      multi: true,
    },
  ],
})
export class AppInput implements ControlValueAccessor {
  readonly type = input<AppInputType>('text');
  readonly placeholder = input('');
  readonly readonly = input(false);
  readonly invalid = input(false);
  /** Optional inline label rendered by Ion (use FormField for richer scaffolding). */
  readonly ionLabel = input<string | null>(null);
  readonly labelPlacement = input<'fixed' | 'stacked' | 'floating' | 'start' | 'end'>('stacked');
  readonly helper = input<string | null>(null);
  readonly errorText = input<string | null>(null);
  readonly maxLength = input<number | null>(null);
  readonly autocomplete = input<string | null>(null);
  readonly inputmode = input<
    'none' | 'text' | 'tel' | 'url' | 'email' | 'numeric' | 'decimal' | 'search' | null
  >(null);
  readonly describedBy = input<string | null>(null);
  readonly fill = input<'outline' | 'solid'>('outline');

  protected readonly value = signal<string>('');
  protected readonly disabled = signal(false);

  // ─── ControlValueAccessor ────────────────────────────────────────────────
  private onChange: (v: string) => void = () => undefined;
  private onTouched: () => void = () => undefined;

  writeValue(value: string | null | undefined): void {
    this.value.set(value ?? '');
  }
  registerOnChange(fn: (v: string) => void): void {
    this.onChange = fn;
  }
  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }
  setDisabledState(isDisabled: boolean): void {
    this.disabled.set(isDisabled);
  }

  protected onInput(ev: CustomEvent<{ value?: string | number | null }>): void {
    const v = String(ev.detail.value ?? '');
    this.value.set(v);
    this.onChange(v);
  }

  protected onBlur(): void {
    this.onTouched();
  }
}
