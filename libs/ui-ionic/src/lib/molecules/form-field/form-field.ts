import {
  Component,
  ChangeDetectionStrategy,
  computed,
  input,
} from '@angular/core';

let uid = 0;

/**
 * Wraps any form control atom (AppInput, AppSelect, AppCheckbox, AppToggle)
 * with label, help text, and error scaffolding. The control is projected as
 * content; the field generates a stable id and exposes `controlId` /
 * `describedBy` for the consumer to thread through.
 *
 *   <cdf-form-field label="Email" [error]="emailError()">
 *     <cdf-app-input [(ngModel)]="email" type="email"
 *                    [invalid]="!!emailError()"
 *                    [describedBy]="field.describedBy()" />
 *   </cdf-form-field>
 *
 * Visually identical contract to ui-bootstrap's FormField so cross-app
 * mental model stays consistent.
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
  readonly controlIdInput = input<string | null>(null, { alias: 'controlId' });

  private readonly _autoId = `cdf-field-${++uid}`;
  protected readonly controlId = computed(() => this.controlIdInput() ?? this._autoId);
  protected readonly helpId = computed(() => `${this.controlId()}-help`);
  protected readonly errorId = computed(() => `${this.controlId()}-error`);

  /** ID consumers should pass to the projected control as `describedBy`. */
  readonly describedBy = computed(() => {
    if (this.error()) return this.errorId();
    if (this.help()) return this.helpId();
    return null;
  });
}
