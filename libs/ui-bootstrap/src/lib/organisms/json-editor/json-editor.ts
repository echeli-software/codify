import {
  Component,
  ChangeDetectionStrategy,
  computed,
  forwardRef,
  input,
  signal,
} from '@angular/core';
import { ControlValueAccessor, FormsModule, NG_VALUE_ACCESSOR } from '@angular/forms';

/**
 * Lightweight monospace JSON editor for advanced fields like badge rules
 * and exercise tests. Validates on blur; surfaces parse errors via
 * `validationError`. The form value is the raw string — callers parse.
 *
 * Real Monaco shows up later as part of `ExerciseRunner` (Phase 10).
 */
@Component({
  selector: 'cdf-json-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  template: `
    <div class="cdf-json" [class.cdf-json--invalid]="!!validationError()">
      <textarea
        class="cdf-json__textarea"
        spellcheck="false"
        [rows]="rows()"
        [(ngModel)]="value"
        (blur)="onBlur()"
        [attr.aria-invalid]="!!validationError() || null"
      ></textarea>
      @if (validationError(); as err) {
      <p class="cdf-json__error" role="alert">{{ err }}</p>
      }
    </div>
  `,
  styleUrl: './json-editor.scss',
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => JsonEditor),
      multi: true,
    },
  ],
})
export class JsonEditor implements ControlValueAccessor {
  readonly rows = input(8);
  /** When true, runs JSON.parse on blur and surfaces errors. */
  readonly validate = input(true);

  protected readonly value = signal('');
  protected readonly validationError = computed(() => {
    if (!this.validate() || !this.value().trim()) return null;
    try {
      JSON.parse(this.value());
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : 'Invalid JSON';
    }
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
  setDisabledState(_isDisabled: boolean): void {
    // not exposed yet; native textarea handles when added
  }

  protected onBlur(): void {
    this.onChange(this.value());
    this.onTouched();
  }
}
