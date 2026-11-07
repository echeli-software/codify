import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import {
  AppButton,
  AppCard,
  AppSkeleton,
  CoinBadge,
  Icon,
  XpBadge,
} from '@codify/ui-ionic';
import { ReferralsClient, type ReferralSummary } from '@codify/api-client';
import { I18nService, TranslatePipe } from '@codify/i18n';
import { AppToastService } from '../platform/app-toast.service.js';
import { TelemetryService } from '../telemetry/telemetry.service.js';
import { shareLink } from '../pages/shared/share.js';

/**
 * Referral card (docs/18): my share link, how many joined / converted, and
 * the rewards earned so far. Sharing uses the Web Share API with a
 * clipboard fallback.
 */
@Component({
  selector: 'cdf-referral-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    AppButton,
    AppCard,
    AppSkeleton,
    CoinBadge,
    Icon,
    XpBadge,
    TranslatePipe,
  ],
  template: `
    <cdf-app-card padding="normal" data-testid="referral">
      <h3 class="rc__title">
        <cdf-icon name="gift" size="sm" />
        {{ 'student.profile.referral.title' | translate }}
      </h3>
      <p class="rc__muted">{{ 'student.profile.referral.body' | translate }}</p>
      @if (summary(); as r) {
        <div class="rc__link">
          <code data-testid="referral-link">{{ r.shareUrl }}</code>
          <cdf-app-button
            kind="primary"
            size="sm"
            (buttonClick)="share(r)"
            data-testid="share-referral"
          >
            <cdf-icon name="share" size="sm" />
            {{ 'student.friends.share' | translate }}
          </cdf-app-button>
        </div>
        <dl class="rc__stats" data-testid="referral-stats">
          <div>
            <dt>{{ 'student.profile.referral.invited' | translate }}</dt>
            <dd>{{ r.invited }}</dd>
          </div>
          <div>
            <dt>{{ 'student.profile.referral.converted' | translate }}</dt>
            <dd>{{ r.converted }}</dd>
          </div>
          <div>
            <dt>{{ 'student.profile.referral.rewards' | translate }}</dt>
            <dd class="rc__rewards">
              <cdf-xp-badge [value]="r.rewards.xp" size="sm" />
              <cdf-coin-badge [value]="r.rewards.coins" size="sm" />
            </dd>
          </div>
        </dl>
      } @else {
        <cdf-app-skeleton shape="text" />
      }
    </cdf-app-card>
  `,
  styles: [
    `
      .rc__title {
        display: flex;
        align-items: center;
        gap: 6px;
        margin: 0 0 4px;
      }
      .rc__muted {
        color: var(--cdf-color-text-muted);
        font-size: var(--cdf-font-size-sm);
        margin: 0 0 var(--cdf-space-2);
      }
      .rc__link {
        display: flex;
        gap: var(--cdf-space-2);
        align-items: center;
        flex-wrap: wrap;
      }
      .rc__link code {
        flex: 1 1 200px;
        font-size: 13px;
        word-break: break-all;
      }
      .rc__stats {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: var(--cdf-space-2);
        margin: var(--cdf-space-3) 0 0;
      }
      .rc__stats dt {
        font-size: var(--cdf-font-size-xs);
        color: var(--cdf-color-text-muted);
      }
      .rc__stats dd {
        margin: 0;
        font-weight: 700;
        font-size: var(--cdf-font-size-lg);
      }
      .rc__rewards {
        display: flex;
        gap: 4px;
        flex-wrap: wrap;
        font-size: var(--cdf-font-size-sm);
      }
    `,
  ],
})
export class ReferralCardComponent {
  private readonly client = inject(ReferralsClient);
  private readonly toast = inject(AppToastService);
  private readonly telemetry = inject(TelemetryService);
  private readonly i18n = inject(I18nService);

  protected readonly summary = signal<ReferralSummary | null>(null);

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    try {
      this.summary.set(await this.client.summary());
    } catch (err) {
      this.toast.error(err);
    }
  }

  protected async share(r: ReferralSummary): Promise<void> {
    const outcome = await shareLink({
      title: this.i18n.t('student.friends.shareTitle'),
      text: this.i18n.t('student.friends.shareText'),
      url: r.shareUrl,
    });
    if (outcome === 'shared' || outcome === 'copied') {
      this.telemetry.track('referral_link_shared', {
        channel: outcome === 'shared' ? 'share_sheet' : 'clipboard',
      });
    }
    if (outcome === 'copied')
      this.toast.show({ message: 'student.friends.copied', kind: 'success' });
    if (outcome === 'failed')
      this.toast.show({
        message: 'student.friends.shareFailed',
        kind: 'warning',
      });
  }
}
