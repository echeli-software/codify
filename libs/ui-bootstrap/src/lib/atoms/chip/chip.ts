import {
  Component,
  ChangeDetectionStrategy,
  computed,
  input,
  model,
  output,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { TranslatePipe } from '@codify/i18n';
import { Icon, type IconName } from '../icon/icon.js';

export type ChipVariant =
  | 'neutral'
  | 'primary'
  | 'success'
  | 'warning'
  | 'danger';

/**
 * Compact, optionally selectable / removable token — filter chips, selected
 * values in a Combobox, category pills. Unlike `cdf-tag` (static label),
 * a selectable chip is a toggle button (`aria-pressed`).
 *
 *   <cdf-chip [selectable]="true" [(selected)]="onlyFree">Free</cdf-chip>
 *   <cdf-chip icon="star" [removable]="true" (remove)="drop(cat)">{{ cat.name }}</cdf-chip>
 */
@Component({
  selector: 'cdf-chip',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, NgTemplateOutlet, TranslatePipe],
  template: `
    <ng-template #label
      ><span class="cdf-chip__label"><ng-content /></span
    ></ng-template>
    <span [class]="cssClass()" [attr.aria-disabled]="disabled() || null">
      @if (selectable()) {
        <button
          type="button"
          class="cdf-chip__main"
          [disabled]="disabled()"
          [attr.aria-pressed]="selected()"
          (click)="toggle()"
        >
          @if (selected()) {
            <cdf-icon name="check" size="xs" />
          } @else if (icon(); as i) {
            <cdf-icon [name]="i" size="xs" />
          }
          <ng-container [ngTemplateOutlet]="label" />
        </button>
      } @else {
        <span class="cdf-chip__main">
          @if (icon(); as i) {
            <cdf-icon [name]="i" size="xs" />
          }
          <ng-container [ngTemplateOutlet]="label" />
        </span>
      }
      @if (removable()) {
        <button
          type="button"
          class="cdf-chip__remove"
          [disabled]="disabled()"
          [attr.aria-label]="removeLabel() ?? ('common.remove' | translate)"
          (click)="onRemove($event)"
        >
          <cdf-icon name="x" size="xs" />
        </button>
      }
    </span>
  `,
  styleUrl: './chip.scss',
})
export class Chip {
  readonly variant = input<ChipVariant>('neutral');
  readonly icon = input<IconName | null>(null);
  readonly size = input<'sm' | 'md'>('md');
  /** Renders as a toggle button with `aria-pressed`. */
  readonly selectable = input(false);
  readonly selected = model(false);
  readonly removable = input(false);
  readonly disabled = input(false);
  /** Accessible name for the remove button (defaults to "Remove"). */
  readonly removeLabel = input<string | null>(null);

  readonly remove = output<void>();

  protected readonly cssClass = computed(() => {
    const cls = [
      'cdf-chip',
      `cdf-chip--${this.variant()}`,
      `cdf-chip--${this.size()}`,
    ];
    if (this.selected()) cls.push('cdf-chip--selected');
    if (this.removable()) cls.push('cdf-chip--removable');
    if (this.disabled()) cls.push('cdf-chip--disabled');
    if (this.selectable()) cls.push('cdf-chip--selectable');
    return cls.join(' ');
  });

  protected toggle(): void {
    if (this.disabled()) return;
    this.selected.update((v) => !v);
  }

  protected onRemove(ev: Event): void {
    ev.stopPropagation();
    if (this.disabled()) return;
    this.remove.emit();
  }
}
