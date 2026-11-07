import {
  Component,
  ChangeDetectionStrategy,
  input,
  output,
} from '@angular/core';
import { TranslatePipe } from '@codify/i18n';
import { AppButton } from '../../atoms/app-button/app-button.js';
import { Icon, type IconName } from '../../atoms/icon/icon.js';

/**
 * Something failed while loading a surface. Defaults to the shared
 * "Something went wrong" copy with a retry CTA; pass `title` /
 * `description` for specifics. Announced via `role="alert"`.
 *
 *   <cdf-error-state (retry)="reload()" />
 */
@Component({
  selector: 'cdf-error-state',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AppButton, Icon, TranslatePipe],
  template: `
    <div class="cdf-state cdf-state--error" role="alert">
      <div class="cdf-state__icon"><cdf-icon [name]="icon()" size="xl" /></div>
      <h2 class="cdf-state__title">
        {{ title() ?? ('ui.state.errorTitle' | translate) }}
      </h2>
      <p class="cdf-state__description">
        {{ description() ?? ('common.error.unknown' | translate) }}
      </p>
      @if (code(); as c) {
        <p class="cdf-state__code">
          {{ 'ui.state.errorCode' | translate: { code: c } }}
        </p>
      }
      <div class="cdf-state__actions">
        @if (retryable()) {
          <cdf-app-button
            kind="primary"
            [loading]="retrying()"
            (buttonClick)="retry.emit()"
          >
            <cdf-icon name="refresh" size="sm" />
            {{ 'common.retry' | translate }}
          </cdf-app-button>
        }
        <ng-content />
      </div>
    </div>
  `,
  styleUrl: '../empty-state/state.scss',
})
export class ErrorState {
  readonly title = input<string | null>(null);
  readonly description = input<string | null>(null);
  readonly icon = input<IconName>('warning');
  /** Support reference (request id / status) shown in small print. */
  readonly code = input<string | null>(null);
  readonly retryable = input(true);
  readonly retrying = input(false);
  readonly retry = output<void>();
}
