import {
  Component,
  ChangeDetectionStrategy,
  forwardRef,
  input,
  signal,
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';

@Component({
  selector: 'cdf-toggle',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <label class="cdf-toggle" [class.cdf-toggle--disabled]="disabled()">
      <input
        type="checkbox"
        role="switch"
        class="cdf-toggle__native"
        [checked]="checked()"
        [disabled]="disabled()"
        [attr.aria-describedby]="describedBy() || null"
        (change)="onChangeEvent($event)"
        (blur)="onBlur()"
      />
      <span class="cdf-toggle__track" aria-hidden="true">
        <span class="cdf-toggle__thumb"></span>
      </span>
      @if (label()) {
      <span class="cdf-toggle__label">{{ label() }}</span>
      } @else {
      <ng-content />
      }
    </label>
  `,
  styleUrl: './toggle.scss',
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => Toggle),
      multi: true,
    },
  ],
})
export class Toggle implements ControlValueAccessor {
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
