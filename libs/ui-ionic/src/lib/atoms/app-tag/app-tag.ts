import {
  Component,
  ChangeDetectionStrategy,
  input,
  output,
} from '@angular/core';
import { TranslatePipe } from '@codify/i18n';
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
  imports: [IonChip, IonIcon, TranslatePipe],
  template: `
    <ion-chip [outline]="outline()" [disabled]="disabled()">
      <ng-content />
      @if (removable()) {
        <button
          type="button"
          class="cdf-app-tag__remove"
          [disabled]="disabled()"
          [attr.aria-label]="removeLabel() ?? ('common.remove' | translate)"
          (click)="onRemove($event)"
        >
          <ion-icon name="close" aria-hidden="true" />
        </button>
      }
    </ion-chip>
  `,
  styleUrl: './app-tag.scss',
})
export class AppTag {
  readonly removable = input(false);
  readonly outline = input(true);
  readonly disabled = input(false);
  /** Accessible name for the remove button (defaults to "Remove"). */
  readonly removeLabel = input<string | null>(null);
  readonly remove = output<void>();

  protected onRemove(ev: Event): void {
    ev.stopPropagation();
    if (this.disabled()) return;
    this.remove.emit();
  }
}
