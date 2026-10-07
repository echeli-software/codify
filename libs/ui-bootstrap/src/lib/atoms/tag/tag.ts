import {
  Component,
  ChangeDetectionStrategy,
  computed,
  input,
  output,
} from '@angular/core';
import { TranslatePipe } from '@codify/i18n';
import { Icon } from '../icon/icon.js';

/**
 * Interactive label. Use for filter chips, multi-select selections, and any
 * removable categorical value. For purely presentational labels use `cdf-badge`.
 */
@Component({
  selector: 'cdf-tag',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, TranslatePipe],
  template: `
    <span [class]="cssClass()" [attr.aria-disabled]="disabled() || null">
      <ng-content />
      @if (removable()) {
        <button
          type="button"
          class="cdf-tag__remove"
          (click)="onRemove($event)"
          [attr.aria-label]="removeLabel() ?? ('common.remove' | translate)"
        >
          <cdf-icon name="x" size="xs" />
        </button>
      }
    </span>
  `,
  styleUrl: './tag.scss',
})
export class Tag {
  readonly removable = input(false);
  readonly disabled = input(false);
  readonly removeLabel = input<string | null>(null);
  readonly remove = output<void>();

  protected readonly cssClass = computed(() => {
    const cls = ['cdf-tag'];
    if (this.removable()) cls.push('cdf-tag--removable');
    if (this.disabled()) cls.push('cdf-tag--disabled');
    return cls.join(' ');
  });

  protected onRemove(ev: Event): void {
    ev.stopPropagation();
    if (this.disabled()) return;
    this.remove.emit();
  }
}
