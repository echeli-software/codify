import {
  Component,
  ChangeDetectionStrategy,
  computed,
  forwardRef,
  input,
  signal,
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';

export type InputType =
  | 'text'
  | 'email'
  | 'url'
  | 'password'
  | 'search'
  | 'tel'
  | 'number';
export type InputSize = 'sm' | 'md' | 'lg';

/**
 * Text input atom. Implements ControlValueAccessor so it works with both
 * template-driven and reactive forms. Use FormField molecule (later) to add
 * label / help / error scaffolding.
 */
@Component({
  selector: 'cdf-input',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <input
      [type]="type()"
      [class]="cssClass()"
      [value]="value()"
      [disabled]="disabled()"
      [readonly]="readonly()"
      [placeholder]="placeholder()"
      [attr.aria-invalid]="invalid() || null"
      [attr.aria-describedby]="describedBy() || null"
      [attr.aria-label]="ariaLabel()"
      [id]="inputId() ?? null"
      [attr.autocomplete]="autocomplete()"
      [attr.inputmode]="inputmode()"
      [attr.maxlength]="maxLength()"
      (input)="onInput($event)"
      (blur)="onBlur()"
    />
  `,
  styleUrl: './input.scss',
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => Input),
      multi: true,
    },
  ],
})
export class Input implements ControlValueAccessor {
  readonly type = input<InputType>('text');
  readonly size = input<InputSize>('md');
  readonly placeholder = input('');
  readonly readonly = input(false);
  readonly invalid = input(false);
  readonly autocomplete = input<string | null>(null);
  readonly inputmode = input<
    | 'none'
    | 'text'
    | 'tel'
    | 'url'
    | 'email'
    | 'numeric'
    | 'decimal'
    | 'search'
    | null
  >(null);
  readonly maxLength = input<number | null>(null);
  readonly describedBy = input<string | null>(null);
  /** Accessible name when no `<label for>` points at the control. */
  readonly ariaLabel = input<string | null>(null);
  /** Id for the native input (pair with `<label for>` / FormField). */
  readonly inputId = input<string | null>(null);

  protected readonly value = signal('');
  protected readonly disabled = signal(false);

  protected readonly cssClass = computed(() => {
    const cls = ['cdf-input'];
    const s = this.size();
    if (s !== 'md') cls.push(`cdf-input--${s}`);
    if (this.invalid()) cls.push('cdf-input--invalid');
    return cls.join(' ');
  });

  // ControlValueAccessor
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

  protected onInput(ev: Event): void {
    const v = (ev.target as HTMLInputElement).value;
    this.value.set(v);
    this.onChange(v);
  }

  protected onBlur(): void {
    this.onTouched();
  }
}
