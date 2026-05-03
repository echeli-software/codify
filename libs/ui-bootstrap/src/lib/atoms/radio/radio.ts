import {
  Component,
  ChangeDetectionStrategy,
  forwardRef,
  input,
  signal,
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';

export interface RadioOption<T = string> {
  value: T;
  label: string;
  disabled?: boolean;
}

/**
 * Radio group: a set of mutually-exclusive options bound to a single form
 * value. We expose the group as the form-control unit (rather than individual
 * radios) so consumers don't have to thread a shared `name` everywhere.
 */
@Component({
  selector: 'cdf-radio-group',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="cdf-radio-group" role="radiogroup" [attr.aria-label]="ariaLabel()">
      @for (opt of options(); track opt.value) {
      <label class="cdf-radio" [class.cdf-radio--disabled]="opt.disabled || disabled()">
        <input
          type="radio"
          class="cdf-radio__native"
          [name]="name()"
          [value]="opt.value"
          [checked]="value() === opt.value"
          [disabled]="opt.disabled || disabled()"
          (change)="select(opt.value)"
          (blur)="onBlur()"
        />
        <span class="cdf-radio__dot" aria-hidden="true"></span>
        <span class="cdf-radio__label">{{ opt.label }}</span>
      </label>
      }
    </div>
  `,
  styleUrl: './radio.scss',
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => RadioGroup),
      multi: true,
    },
  ],
})
export class RadioGroup<T = string> implements ControlValueAccessor {
  readonly options = input.required<RadioOption<T>[]>();
  readonly name = input(`cdf-radio-${Math.random().toString(36).slice(2, 8)}`);
  readonly ariaLabel = input<string | null>(null);

  protected readonly value = signal<T | null>(null);
  protected readonly disabled = signal(false);

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

  protected select(v: T): void {
    this.value.set(v);
    this.onChange(v);
  }

  protected onBlur(): void {
    this.onTouched();
  }
}
