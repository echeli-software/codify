import {
  Component,
  ChangeDetectionStrategy,
  computed,
  forwardRef,
  input,
  signal,
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { Icon } from '../icon/icon.js';

export interface SelectOption<T = string> {
  value: T;
  label: string;
  disabled?: boolean;
}

/**
 * Native single-select wrapped with Codify styling. For typeahead / async
 * filtering use `cdf-combobox` (later phase). For multi-select wait for the
 * dedicated multi variant — multi-select on a native element is poor UX.
 */
@Component({
  selector: 'cdf-select',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  template: `
    <span class="cdf-select" [class]="cssClass()">
      <select
        class="cdf-select__native"
        [value]="value() ?? ''"
        [disabled]="disabled()"
        [attr.aria-invalid]="invalid() || null"
        [attr.aria-describedby]="describedBy() || null"
        (change)="onChangeEvent($event)"
        (blur)="onBlur()"
      >
        @if (placeholder()) {
        <option value="" disabled>{{ placeholder() }}</option>
        }
        @for (opt of options(); track opt.value) {
        <option [value]="opt.value" [disabled]="opt.disabled ?? false">{{ opt.label }}</option>
        }
      </select>
      <cdf-icon class="cdf-select__caret" name="caret-down" size="sm" />
    </span>
  `,
  styleUrl: './select.scss',
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => Select),
      multi: true,
    },
  ],
})
export class Select<T = string> implements ControlValueAccessor {
  readonly options = input.required<SelectOption<T>[]>();
  readonly placeholder = input<string | null>(null);
  readonly size = input<'sm' | 'md' | 'lg'>('md');
  readonly invalid = input(false);
  readonly describedBy = input<string | null>(null);

  protected readonly value = signal<T | null>(null);
  protected readonly disabled = signal(false);

  protected readonly cssClass = computed(() => {
    const cls = [`cdf-select--${this.size()}`];
    if (this.invalid()) cls.push('cdf-select--invalid');
    if (this.disabled()) cls.push('cdf-select--disabled');
    return cls.join(' ');
  });

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

  protected onChangeEvent(ev: Event): void {
    const raw = (ev.target as HTMLSelectElement).value;
    // Find the matching option to recover the original (typed) value.
    const opt = this.options().find((o) => String(o.value) === raw);
    const v = (opt ? opt.value : null) as T | null;
    this.value.set(v);
    this.onChange(v);
  }

  protected onBlur(): void {
    this.onTouched();
  }
}
