import {
  Component,
  ChangeDetectionStrategy,
  computed,
  input,
} from '@angular/core';

let uid = 0;

/**
 * Wraps any form control atom (Input, Textarea, Select, Checkbox, Toggle,
 * RadioGroup, …) with label, help text, error scaffolding, and the right
 * ARIA wiring. Pass the control as projected content; the field generates
 * a stable id and threads it via `aria-describedby`.
 *
 *   <cdf-form-field label="Email" [error]="emailError()">
 *     <cdf-input [(ngModel)]="email" type="email" />
 *   </cdf-form-field>
 *
 * The control inside is responsible for its own validity styling — pass
 * `[invalid]="!!error()"` on the control to colour its border red.
 */
@Component({
  selector: 'cdf-form-field',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="cdf-form-field" [class.cdf-form-field--invalid]="!!error()">
      @if (label(); as l) {
      <label class="cdf-form-field__label" [attr.for]="controlId()">
        {{ l }}
        @if (required()) {
        <span class="cdf-form-field__required" aria-hidden="true">*</span>
        }
      </label>
      }

      <div class="cdf-form-field__control">
        <ng-content />
      </div>

      @if (error(); as e) {
      <p class="cdf-form-field__error" [id]="errorId()" role="alert">{{ e }}</p>
      } @else if (help(); as h) {
      <p class="cdf-form-field__help" [id]="helpId()">{{ h }}</p>
      }
    </div>
  `,
  styleUrl: './form-field.scss',
})
export class FormField {
  readonly label = input<string | null>(null);
  readonly help = input<string | null>(null);
  readonly error = input<string | null>(null);
  readonly required = input(false);
  /** Optional explicit id; otherwise a stable generated one. */
  readonly controlIdInput = input<string | null>(null, { alias: 'controlId' });

  private readonly _autoId = `cdf-field-${++uid}`;
  protected readonly controlId = computed(() => this.controlIdInput() ?? this._autoId);
  protected readonly helpId = computed(() => `${this.controlId()}-help`);
  protected readonly errorId = computed(() => `${this.controlId()}-error`);

  /**
   * IDs callers pass through to the projected control:
   *   <cdf-input [id]="field.controlId()" [describedBy]="field.describedBy()" />
   * This keeps the FormField/control coupling explicit without wiring through
   * complex content-child projection.
   */
  readonly describedBy = computed(() => {
    if (this.error()) return this.errorId();
    if (this.help()) return this.helpId();
    return null;
  });
}
