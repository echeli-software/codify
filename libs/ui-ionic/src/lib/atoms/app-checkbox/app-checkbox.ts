import {
  Component,
  ChangeDetectionStrategy,
  forwardRef,
  input,
  signal,
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { IonCheckbox } from '@ionic/angular/standalone';

@Component({
  selector: 'cdf-app-checkbox',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IonCheckbox],
  template: `
    <ion-checkbox
      [checked]="checked()"
      [disabled]="disabled()"
      [labelPlacement]="labelPlacement()"
      [justify]="justify()"
      (ionChange)="onChangeEvent($event)"
      (ionBlur)="onBlur()"
    >
      @if (label()) {
      <span>{{ label() }}</span>
      } @else {
      <ng-content />
      }
    </ion-checkbox>
  `,
  styleUrl: './app-checkbox.scss',
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => AppCheckbox),
      multi: true,
    },
  ],
})
export class AppCheckbox implements ControlValueAccessor {
  readonly label = input<string | null>(null);
  readonly labelPlacement = input<'start' | 'end' | 'fixed' | 'stacked'>('end');
  readonly justify = input<'start' | 'end' | 'space-between'>('start');

  protected readonly checked = signal(false);
  protected readonly disabled = signal(false);

  // ─── ControlValueAccessor ────────────────────────────────────────────────
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

  protected onChangeEvent(ev: CustomEvent<{ checked: boolean }>): void {
    this.checked.set(ev.detail.checked);
    this.onChange(ev.detail.checked);
  }

  protected onBlur(): void {
    this.onTouched();
  }
}
