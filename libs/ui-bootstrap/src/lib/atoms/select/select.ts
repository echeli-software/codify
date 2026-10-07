import {
  Component,
  ChangeDetectionStrategy,
  ElementRef,
  computed,
  forwardRef,
  inject,
  input,
  signal,
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { TranslatePipe } from '@codify/i18n';
import { Icon } from '../icon/icon.js';

export interface SelectOption<T = string> {
  value: T;
  label: string;
  disabled?: boolean;
}

let selectSeq = 0;

/**
 * Select with two modes:
 *
 *   single (default) — native `<select>` with Codify styling; value `T | null`.
 *   multiple         — disclosure button + checkbox panel (native checkboxes,
 *                      so screen readers and keyboards work out of the box);
 *                      value `T[]`.
 *
 *   <cdf-select [options]="cats" [(ngModel)]="cat" />
 *   <cdf-select [options]="cats" [multiple]="true" [(ngModel)]="cats" />
 *
 * For typeahead / async filtering use `cdf-combobox`.
 */
@Component({
  selector: 'cdf-select',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, TranslatePipe],
  host: {
    '(document:click)': 'onDocumentClick($event)',
  },
  template: `
    @if (!multiple()) {
      <span class="cdf-select" [class]="cssClass()">
        <select
          class="cdf-select__native"
          [id]="inputId() ?? null"
          [value]="singleValue() ?? ''"
          [disabled]="disabled()"
          [attr.aria-label]="ariaLabel()"
          [attr.aria-invalid]="invalid() || null"
          [attr.aria-describedby]="describedBy() || null"
          (change)="onChangeEvent($event)"
          (blur)="onBlur()"
        >
          @if (placeholder()) {
            <option value="" disabled>{{ placeholder() }}</option>
          }
          @for (opt of options(); track opt.value) {
            <option [value]="opt.value" [disabled]="opt.disabled ?? false">
              {{ opt.label }}
            </option>
          }
        </select>
        <cdf-icon class="cdf-select__caret" name="caret-down" size="sm" />
      </span>
    } @else {
      <span class="cdf-select cdf-select--multiple" [class]="cssClass()">
        <button
          type="button"
          class="cdf-select__native cdf-select__trigger"
          [id]="inputId() ?? null"
          [disabled]="disabled()"
          aria-haspopup="true"
          [attr.aria-expanded]="open()"
          [attr.aria-controls]="panelId"
          [attr.aria-label]="ariaLabel()"
          [attr.aria-invalid]="invalid() || null"
          [attr.aria-describedby]="describedBy() || null"
          (click)="toggle()"
          (keydown.escape)="close(true)"
        >
          @if (selectedLabels().length === 0) {
            <span class="cdf-select__placeholder">{{
              placeholder() ?? ('ui.select.none' | translate)
            }}</span>
          } @else if (selectedLabels().length <= 2) {
            {{ selectedLabels().join(', ') }}
          } @else {
            {{
              'ui.select.countSelected'
                | translate: { count: selectedLabels().length }
            }}
          }
        </button>
        <cdf-icon class="cdf-select__caret" name="caret-down" size="sm" />
        @if (open()) {
          <div
            class="cdf-select__panel"
            role="group"
            [id]="panelId"
            [attr.aria-label]="ariaLabel()"
            (keydown.escape)="close(true)"
          >
            @for (opt of options(); track opt.value) {
              <label
                class="cdf-select__option"
                [class.cdf-select__option--disabled]="opt.disabled"
              >
                <input
                  type="checkbox"
                  [checked]="isSelected(opt.value)"
                  [disabled]="opt.disabled ?? false"
                  (change)="toggleValue(opt.value, $any($event.target).checked)"
                />
                <span>{{ opt.label }}</span>
              </label>
            }
          </div>
        }
      </span>
    }
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
  private readonly host = inject(ElementRef<HTMLElement>);

  readonly options = input.required<SelectOption<T>[]>();
  readonly placeholder = input<string | null>(null);
  readonly size = input<'sm' | 'md' | 'lg'>('md');
  readonly invalid = input(false);
  readonly describedBy = input<string | null>(null);
  /** Accessible name when there is no visible `<label for>`. */
  readonly ariaLabel = input<string | null>(null);
  /** Id for the native control (pair with `<label for>` / FormField). */
  readonly inputId = input<string | null>(null);
  /** Multi-select mode — the form value becomes `T[]`. */
  readonly multiple = input(false);

  protected readonly value = signal<T | T[] | null>(null);
  protected readonly disabled = signal(false);
  protected readonly open = signal(false);
  protected readonly panelId = `cdf-select-panel-${++selectSeq}`;

  protected readonly singleValue = computed(() => {
    const v = this.value();
    return Array.isArray(v) ? (v[0] ?? null) : v;
  });

  protected readonly selectedValues = computed<T[]>(() => {
    const v = this.value();
    if (Array.isArray(v)) return v;
    return v === null || v === undefined ? [] : [v];
  });

  protected readonly selectedLabels = computed(() => {
    const selected = this.selectedValues();
    return this.options()
      .filter((o) => selected.includes(o.value))
      .map((o) => o.label);
  });

  protected readonly cssClass = computed(() => {
    const cls = [`cdf-select--${this.size()}`];
    if (this.invalid()) cls.push('cdf-select--invalid');
    if (this.disabled()) cls.push('cdf-select--disabled');
    if (this.multiple()) cls.push('cdf-select--multiple');
    return cls.join(' ');
  });

  private onChange: (v: T | T[] | null) => void = () => undefined;
  private onTouched: () => void = () => undefined;

  writeValue(value: T | T[] | null | undefined): void {
    this.value.set(value ?? (this.multiple() ? [] : null));
  }
  registerOnChange(fn: (v: T | T[] | null) => void): void {
    this.onChange = fn;
  }
  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }
  setDisabledState(isDisabled: boolean): void {
    this.disabled.set(isDisabled);
  }

  protected isSelected(v: T): boolean {
    return this.selectedValues().includes(v);
  }

  protected onChangeEvent(ev: Event): void {
    const raw = (ev.target as HTMLSelectElement).value;
    // Find the matching option to recover the original (typed) value.
    const opt = this.options().find((o) => String(o.value) === raw);
    const v = (opt ? opt.value : null) as T | null;
    this.value.set(v);
    this.onChange(v);
  }

  protected toggle(): void {
    if (this.disabled()) return;
    this.open.update((o) => !o);
  }

  protected close(refocus = false): void {
    if (!this.open()) return;
    this.open.set(false);
    this.onTouched();
    if (refocus) {
      (this.host.nativeElement as HTMLElement)
        .querySelector<HTMLButtonElement>('.cdf-select__trigger')
        ?.focus();
    }
  }

  protected toggleValue(v: T, checked: boolean): void {
    // Keep the option order stable regardless of click order.
    const next = new Set(this.selectedValues());
    if (checked) next.add(v);
    else next.delete(v);
    const ordered = this.options()
      .map((o) => o.value)
      .filter((value) => next.has(value));
    this.value.set(ordered);
    this.onChange(ordered);
  }

  protected onDocumentClick(ev: MouseEvent): void {
    if (!this.open()) return;
    const target = ev.target as Node | null;
    if (target && !(this.host.nativeElement as HTMLElement).contains(target)) {
      this.close();
    }
  }

  protected onBlur(): void {
    this.onTouched();
  }
}
