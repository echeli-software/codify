import {
  Component,
  ChangeDetectionStrategy,
  forwardRef,
  input,
  signal,
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { Icon } from '../icon/icon.js';

@Component({
  selector: 'cdf-checkbox',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  template: `
    <label class="cdf-checkbox" [class.cdf-checkbox--disabled]="disabled()">
      <input
        type="checkbox"
        class="cdf-checkbox__native"
        [checked]="checked()"
        [disabled]="disabled()"
        [attr.aria-describedby]="describedBy() || null"
        (change)="onChangeEvent($event)"
        (blur)="onBlur()"
      />
      <span class="cdf-checkbox__box" aria-hidden="true">
        @if (checked()) {
        <cdf-icon name="check" size="xs" />
        }
      </span>
      @if (label()) {
      <span class="cdf-checkbox__label">{{ label() }}</span>
      } @else {
      <ng-content />
      }
    </label>
  `,
  styleUrl: './checkbox.scss',
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => Checkbox),
      multi: true,
    },
  ],
})
export class Checkbox implements ControlValueAccessor {
  readonly label = input<string | null>(null);
  readonly describedBy = input<string | null>(null);

  protected readonly checked = signal(false);
  protected readonly disabled = signal(false);

  private onChange: (v: boolean) => void = () => undefined;
  private onTouched: () => void = () => undefined;

  writeValue(value: boolean | null | undefined): void {
    this.checked.set(!!value);
  }
  registerOnChange(fn: (v: boolean) => void): void {
    this.onChange = fn;
  }
  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }
  setDisabledState(isDisabled: boolean): void {
    this.disabled.set(isDisabled);
  }

  protected onChangeEvent(ev: Event): void {
    const v = (ev.target as HTMLInputElement).checked;
    this.checked.set(v);
    this.onChange(v);
  }

  protected onBlur(): void {
    this.onTouched();
  }
}
