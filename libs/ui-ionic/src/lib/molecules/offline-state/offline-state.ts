import {
  Component,
  ChangeDetectionStrategy,
  input,
  output,
} from '@angular/core';
import { TranslatePipe } from '@codify/i18n';
import { AppButton } from '../../atoms/app-button/app-button.js';
import { Icon } from '../../atoms/icon/icon.js';

/**
 * Shown when a surface needs the network and the device is offline
 * (docs/16-offline). Offers "Try again" and, when the caller has cached
 * content, a "See downloads" action.
 *
 *   <cdf-offline-state [hasDownloads]="downloads().length > 0" (retry)="reload()" (openDownloads)="go('/downloads')" />
 */
@Component({
  selector: 'cdf-offline-state',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AppButton, Icon, TranslatePipe],
  template: `
    <div class="cdf-state cdf-state--offline" role="status">
      <div class="cdf-state__icon">
        <cdf-icon name="cloud-offline" size="xl" />
      </div>
      <h2 class="cdf-state__title">
        {{ title() ?? ('ui.state.offlineTitle' | translate) }}
      </h2>
      <p class="cdf-state__description">
        {{ description() ?? ('ui.state.offlineBody' | translate) }}
      </p>
      @if (queued() > 0) {
        <p class="cdf-state__code">
          {{ 'ui.state.queued' | translate: { count: queued() } }}
        </p>
      }
      <div class="cdf-state__actions">
        <cdf-app-button kind="primary" (buttonClick)="retry.emit()">
          <cdf-icon name="refresh" size="sm" /> {{ 'common.retry' | translate }}
        </cdf-app-button>
        @if (hasDownloads()) {
          <cdf-app-button kind="secondary" (buttonClick)="openDownloads.emit()">
            <cdf-icon name="download" size="sm" />
            {{ 'ui.state.seeDownloads' | translate }}
          </cdf-app-button>
        }
      </div>
    </div>
  `,
  styleUrl: '../empty-state/state.scss',
})
export class OfflineState {
  readonly title = input<string | null>(null);
  readonly description = input<string | null>(null);
  readonly hasDownloads = input(false);
  /** Completions waiting to sync (offline queue). */
  readonly queued = input(0);
  readonly retry = output<void>();
  readonly openDownloads = output<void>();
}
