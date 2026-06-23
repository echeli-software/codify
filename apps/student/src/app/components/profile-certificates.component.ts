import { ChangeDetectionStrategy, Component, type OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AppBadge, AppCard, Icon } from '@codify/ui-ionic';
import { CertificatesClient, type CertificateView, type ReferralView } from '@codify/api-client';

/**
 * Profile section: the learner's certificates of completion + their referral
 * share link (Phase 13). Self-contained so it drops into the profile page
 * without touching its large template. See /docs/18-growth.md.
 */
@Component({
  selector: 'cdf-profile-certificates',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, AppBadge, AppCard, Icon],
  template: `
    <cdf-app-card padding="normal" class="certs" data-testid="profile-certificates">
      <h3><cdf-icon name="trophy-outline" size="sm" /> Certificates</h3>
      @if (certs().length === 0) {
      <p class="muted" data-testid="certs-empty">Finish a course to earn a shareable certificate.</p>
      } @else {
      <ul class="cert-list">
        @for (c of certs(); track c.serial) {
        <li>
          <a [routerLink]="['/verify', c.serial]" data-testid="cert-link">
            {{ c.courseTitle }}
            @if (c.isCapstone) { <cdf-app-badge variant="info" [subtle]="true">Capstone</cdf-app-badge> }
          </a>
          <span class="serial">{{ c.serial }}</span>
        </li>
        }
      </ul>
      }

      @if (referral(); as r) {
      <div class="referral" data-testid="referral">
        <h4>Invite a friend</h4>
        <code data-testid="referral-link">{{ r.shareUrl }}</code>
        <p class="muted">{{ r.referredCount }} joined with your link.</p>
      </div>
      }
    </cdf-app-card>
  `,
  styles: [
    `
      .certs h3 { display: flex; align-items: center; gap: 6px; margin: 0 0 var(--cdf-space-2); }
      .muted { color: var(--cdf-color-text-muted); }
      .cert-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 8px; }
      .cert-list li { display: flex; flex-direction: column; }
      .cert-list a { font-weight: 600; text-decoration: none; display: flex; gap: 8px; align-items: center; }
      .serial { font-family: monospace; font-size: 12px; color: var(--cdf-color-text-muted); }
      .referral { margin-top: var(--cdf-space-3); padding-top: var(--cdf-space-3); border-top: 1px solid var(--cdf-color-border, #e2e8f0); }
      .referral h4 { margin: 0 0 6px; }
      .referral code { font-size: 13px; word-break: break-all; }
    `,
  ],
})
export class ProfileCertificatesComponent implements OnInit {
  private readonly client = inject(CertificatesClient);
  protected readonly certs = signal<CertificateView[]>([]);
  protected readonly referral = signal<ReferralView | null>(null);

  ngOnInit(): void {
    void this.load();
  }

  private async load(): Promise<void> {
    const [certs, referral] = await Promise.all([
      this.client.listMine().catch(() => []),
      this.client.referral().catch(() => null),
    ]);
    this.certs.set(certs);
    this.referral.set(referral);
  }
}
