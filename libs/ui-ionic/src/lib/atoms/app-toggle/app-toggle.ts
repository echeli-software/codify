import {
  Component,
  ChangeDetectionStrategy,
  forwardRef,
  input,
  signal,
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { IonToggle } from '@ionic/angular/standalone';

@Component({
  selector: 'cdf-app-toggle',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IonToggle],
  template: `
    <ion-toggle
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
    </ion-toggle>
  `,
  styleUrl: './app-toggle.scss',
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => AppToggle),
      multi: true,
    },
  ],
})
export class AppToggle implements ControlValueAccessor {
  readonly label = input<string | null>(null);
  readonly labelPlacement = input<'start' | 'end' | 'fixed' | 'stacked'>('start');
  readonly justify = input<'start' | 'end' | 'space-between'>('space-between');

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
