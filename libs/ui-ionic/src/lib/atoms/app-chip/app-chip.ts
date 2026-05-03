import { Component, ChangeDetectionStrategy, input } from '@angular/core';
import { IonChip } from '@ionic/angular/standalone';

export type AppChipVariant = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info' | 'coin' | 'xp';

const VARIANT_TO_COLOR: Record<AppChipVariant, string> = {
  neutral: 'medium',
  primary: 'primary',
  success: 'success',
  warning: 'warning',
  danger: 'danger',
  info: 'tertiary',
  coin: 'warning',
  xp: 'primary',
};

/**
 * Static informational chip — no remove affordance, no click handler. For
 * count-displays, status pills, and other read-only chips inside cards
 * and rows. For removable chips use `cdf-app-tag`.
 */
@Component({
  selector: 'cdf-app-chip',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IonChip],
  host: { '[attr.data-variant]': 'variant()' },
  template: `<ion-chip [color]="ionColor()" [outline]="outline()"><ng-content /></ion-chip>`,
  styleUrl: './app-chip.scss',
})
export class AppChip {
  readonly variant = input<AppChipVariant>('neutral');
  readonly outline = input(false);

  protected ionColor(): string {
    return VARIANT_TO_COLOR[this.variant()];
  }
}
