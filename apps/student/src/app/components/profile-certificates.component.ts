import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  AppBadge,
  AppButton,
  AppCard,
  AppSkeleton,
  Icon,
} from '@codify/ui-ionic';
import { CertificatesClient, type CertificateView } from '@codify/api-client';
import { I18nService, LocalePipe, TranslatePipe } from '@codify/i18n';
import { AppToastService } from '../platform/app-toast.service.js';
import { TelemetryService } from '../telemetry/telemetry.service.js';
import { shareLink } from '../pages/shared/share.js';

/**
 * Profile section: the learner's certificates of completion with their
 * public verification links and a share action (docs/18).
 */
@Component({
  selector: 'cdf-profile-certificates',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    AppBadge,
    AppButton,
    AppCard,
    AppSkeleton,
    Icon,
    TranslatePipe,
    LocalePipe,
  ],
  template: `
    <cdf-app-card padding="normal" data-testid="profile-certificates">
      <h3 class="pc__title">
        <cdf-icon name="trophy-outline" size="sm" />
        {{ 'student.profile.certificates.title' | translate }}
      </h3>
      @if (loading()) {
        <cdf-app-skeleton shape="text" />
      } @else if (certs().length === 0) {
        <p class="pc__muted" data-testid="certs-empty">
          {{ 'student.profile.certificates.empty' | translate }}
        </p>
      } @else {
        <ul class="pc__list">
          @for (c of certs(); track c.serial) {
            <li>
              <div class="pc__info">
                <a
                  [routerLink]="['/verify', c.serial]"
                  data-testid="cert-link"
                  >{{ c.courseTitle }}</a
                >
                @if (c.isCapstone) {
                  <cdf-app-badge variant="info" [subtle]="true">{{
                    'student.myCourses.capstone' | translate
                  }}</cdf-app-badge>
                }
                <span class="pc__muted">{{
                  'student.profile.certificates.issued'
                    | translate: { date: (c.issuedAt | locale: 'date') }
                }}</span>
                <code class="pc__serial">{{ c.serial }}</code>
              </div>
              <cdf-app-button
                kind="ghost"
                size="sm"
                [ariaLabel]="
                  'student.profile.certificates.shareNamed'
                    | translate: { title: c.courseTitle }
                "
                (buttonClick)="share(c)"
              >
                <cdf-icon name="share" size="sm" />
                {{ 'student.friends.share' | translate }}
              </cdf-app-button>
            </li>
          }
        </ul>
      }
    </cdf-app-card>
  `,
  styles: [
    `
      .pc__title {
        display: flex;
        align-items: center;
        gap: 6px;
        margin: 0 0 var(--cdf-space-2);
      }
      .pc__muted {
        color: var(--cdf-color-text-muted);
        font-size: var(--cdf-font-size-sm);
      }
      .pc__list {
        list-style: none;
        padding: 0;
        margin: 0;
        display: flex;
        flex-direction: column;
        gap: var(--cdf-space-2);
      }
      .pc__list li {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: var(--cdf-space-2);
      }
      .pc__info {
        display: flex;
        flex-direction: column;
        gap: 2px;
        min-width: 0;
      }
      .pc__info a {
        font-weight: 600;
      }
      .pc__serial {
        font-size: 12px;
        color: var(--cdf-color-text-muted);
        word-break: break-all;
      }
    `,
  ],
})
export class ProfileCertificatesComponent {
  private readonly client = inject(CertificatesClient);
  private readonly toast = inject(AppToastService);
  private readonly telemetry = inject(TelemetryService);
  private readonly i18n = inject(I18nService);

  protected readonly loading = signal(true);
  protected readonly certs = signal<CertificateView[]>([]);

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    try {
      this.certs.set(await this.client.listMine());
    } catch (err) {
      this.toast.error(err);
    } finally {
      this.loading.set(false);
    }
  }

  protected async share(c: CertificateView): Promise<void> {
    const url = `${window.location.origin}/verify/${encodeURIComponent(c.serial)}`;
    const outcome = await shareLink({
      title: this.i18n.t('student.profile.certificates.shareTitle'),
      text: this.i18n.t('student.profile.certificates.shareText', {
        title: c.courseTitle,
      }),
      url,
    });
    if (outcome === 'shared' || outcome === 'copied') {
      this.telemetry.track('certificate_shared', {
        courseId: c.courseId,
        isCapstone: c.isCapstone,
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
