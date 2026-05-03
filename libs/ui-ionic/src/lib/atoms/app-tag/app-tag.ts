import {
  Component,
  ChangeDetectionStrategy,
  input,
  output,
} from '@angular/core';
import { IonChip, IonIcon } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { close } from 'ionicons/icons';

addIcons({ close });

/**
 * Removable / interactive label. For dismissible filters, multi-select
 * selections, or any chip with a remove affordance. For purely decorative
 * labels use `cdf-app-badge`. For static informational chips with no
 * interaction use `cdf-app-chip`.
 */
@Component({
  selector: 'cdf-app-tag',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IonChip, IonIcon],
  template: `
    <ion-chip [outline]="outline()" [disabled]="disabled()">
      <ng-content />
      @if (removable()) {
      <ion-icon
        name="close"
        role="button"
        [attr.aria-label]="removeLabel()"
        (click)="onRemove($event)"
      />
      }
    </ion-chip>
  `,
  styleUrl: './app-tag.scss',
})
export class AppTag {
  readonly removable = input(false);
  readonly outline = input(true);
  readonly disabled = input(false);
  readonly removeLabel = input('Remove');
  readonly remove = output<void>();

  protected onRemove(ev: Event): void {
    ev.stopPropagation();
    if (this.disabled()) return;
    this.remove.emit();
  }
}
