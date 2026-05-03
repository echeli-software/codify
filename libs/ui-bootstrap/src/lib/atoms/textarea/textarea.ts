import {
  Component,
  ChangeDetectionStrategy,
  computed,
  forwardRef,
  input,
  signal,
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';

@Component({
  selector: 'cdf-textarea',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <textarea
      [class]="cssClass()"
      [value]="value()"
      [disabled]="disabled()"
      [readonly]="readonly()"
      [placeholder]="placeholder()"
      [rows]="rows()"
      [attr.aria-invalid]="invalid() || null"
      [attr.aria-describedby]="describedBy() || null"
      [attr.maxlength]="maxLength()"
      (input)="onInput($event)"
      (blur)="onBlur()"
    ></textarea>
  `,
  styleUrl: './textarea.scss',
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => Textarea),
      multi: true,
    },
  ],
})
export class Textarea implements ControlValueAccessor {
  readonly placeholder = input('');
  readonly readonly = input(false);
  readonly invalid = input(false);
  readonly rows = input(4);
  readonly maxLength = input<number | null>(null);
  readonly describedBy = input<string | null>(null);

  protected readonly value = signal('');
  protected readonly disabled = signal(false);

  protected readonly cssClass = computed(() => {
    const cls = ['cdf-textarea'];
    if (this.invalid()) cls.push('cdf-textarea--invalid');
    return cls.join(' ');
  });

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
    const v = (ev.target as HTMLTextAreaElement).value;
    this.value.set(v);
    this.onChange(v);
  }

  protected onBlur(): void {
    this.onTouched();
  }
}
