import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import {
  IonContent,
  IonHeader,
  IonTitle,
  IonToolbar,
} from '@ionic/angular/standalone';
import { TranslatePipe } from '@codify/i18n';
import {
  AppButton,
  AppCard,
  AppSkeleton,
  Icon,
  type IconName,
} from '@codify/ui-ionic';
import { TelemetryService } from '../telemetry/telemetry.service.js';
import {
  GrowthLinksService,
  type GrowthClaimResult,
} from './shared/growth-links.service.js';

interface Line {
  icon: IconName;
  key: string;
  params?: Record<string, unknown>;
  tone: 'ok' | 'warn';
}

/**
 * Landing for `/r/:code` (referral + friend invite) and `/invite/:code`
 * (friend invite). The route guard stored the code before sign-in; here
 * (always authenticated) we claim it and say what happened.
 */
@Component({
  selector: 'cdf-growth-link-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonContent,
    AppButton,
    AppCard,
    AppSkeleton,
    Icon,
    TranslatePipe,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-title>{{ 'student.growth.title' | translate }}</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content class="ion-padding">
      <div class="gl">
        @if (working()) {
          <cdf-app-skeleton shape="rect" [height]="120" />
          <p class="muted" role="status">
            {{ 'student.growth.working' | translate }}
          </p>
        } @else {
          <cdf-app-card padding="spacious" data-testid="growth-result">
            <h1>{{ 'student.growth.heading' | translate }}</h1>
            <ul class="gl__lines" aria-live="polite">
              @for (l of lines(); track l.key) {
                <li
                  [class.gl__warn]="l.tone === 'warn'"
                  [attr.data-key]="l.key"
                >
                  <cdf-icon [name]="l.icon" size="sm" />
                  <span>{{ l.key | translate: l.params }}</span>
                </li>
              }
            </ul>
            <div class="gl__actions">
              <cdf-app-button
                kind="primary"
                routerLink="/today"
                data-testid="growth-continue"
              >
                {{ 'student.growth.continue' | translate }}
              </cdf-app-button>
              @if (hasFriend()) {
                <cdf-app-button kind="ghost" routerLink="/friends">
                  {{ 'student.growth.seeFriends' | translate }}
                </cdf-app-button>
              }
            </div>
          </cdf-app-card>
        }
      </div>
    </ion-content>
  `,
  styles: [
    `
      .gl {
        max-width: 560px;
        margin: 0 auto;
      }
      h1 {
        font-size: var(--cdf-font-size-xl);
        margin: 0 0 var(--cdf-space-3);
      }
      .gl__lines {
        list-style: none;
        padding: 0;
        margin: 0 0 var(--cdf-space-4);
        display: flex;
        flex-direction: column;
        gap: var(--cdf-space-2);
      }
      .gl__lines li {
        display: flex;
        gap: var(--cdf-space-2);
        align-items: flex-start;
        color: var(--cdf-color-success);
      }
      .gl__lines li.gl__warn {
        color: var(--cdf-color-text-muted);
      }
      .gl__actions {
        display: flex;
        gap: var(--cdf-space-2);
        flex-wrap: wrap;
      }
      .muted {
        color: var(--cdf-color-text-muted);
      }
    `,
  ],
})
export class GrowthLinkPage {
  private readonly route = inject(ActivatedRoute);
  private readonly links = inject(GrowthLinksService);
  private readonly telemetry = inject(TelemetryService);

  protected readonly working = signal(true);
  protected readonly result = signal<GrowthClaimResult | null>(null);
  protected readonly lines = computed(() => describeClaim(this.result()));
  protected readonly hasFriend = computed(() => {
    const i = this.result()?.invite;
    return !!i && (i.status === 'accepted' || i.status === 'already_friends');
  });

  constructor() {
    // The guard remembered the code; when the page is reached by an already
    // signed-in user the guard ran too, so pending storage is populated.
    const code = this.route.snapshot.paramMap.get('code');
    const kind = this.route.snapshot.data['kind'] as 'referral' | 'invite';
    if (code) {
      this.links.remember('invite', code);
      if (kind === 'referral') this.links.remember('referral', code);
    }
    void this.claim();
  }

  private async claim(): Promise<void> {
    const res = await this.links.claimPending();
    this.result.set(res);
    this.working.set(false);
    if (res.invite?.status === 'accepted') {
      this.telemetry.track('friend_invite_accepted', { channel: 'link' });
    }
  }
}

/** Human-readable lines for a claim result (exported for tests). */
export function describeClaim(res: GrowthClaimResult | null): Line[] {
  if (!res) return [];
  const out: Line[] = [];
  switch (res.referral) {
    case 'claimed':
    case 'already':
      out.push({
        icon: 'gift',
        key: 'student.growth.referral.claimed',
        tone: 'ok',
      });
      break;
    case 'invalid':
      out.push({
        icon: 'warning',
        key: 'student.growth.referral.invalid',
        tone: 'warn',
      });
      break;
    case 'ineligible':
      out.push({
        icon: 'info-circle',
        key: 'student.growth.referral.ineligible',
        tone: 'warn',
      });
      break;
    case 'conflict':
      out.push({
        icon: 'info-circle',
        key: 'student.growth.referral.conflict',
        tone: 'warn',
      });
      break;
    case 'error':
      out.push({
        icon: 'warning',
        key: 'student.growth.referral.error',
        tone: 'warn',
      });
      break;
  }
  const inv = res.invite;
  if (inv) {
    if (inv.status === 'accepted') {
      out.push({
        icon: 'person',
        key: 'student.growth.invite.accepted',
        params: { name: inv.friendName },
        tone: 'ok',
      });
    } else if (inv.status === 'already_friends') {
      out.push({
        icon: 'person',
        key: 'student.growth.invite.already',
        params: { name: inv.friendName },
        tone: 'ok',
      });
    } else if (inv.status === 'self') {
      out.push({
        icon: 'info-circle',
        key: 'student.growth.invite.self',
        tone: 'warn',
      });
    } else if (inv.status === 'invalid') {
      out.push({
        icon: 'warning',
        key: 'student.growth.invite.invalid',
        tone: 'warn',
      });
    } else {
      out.push({
        icon: 'warning',
        key: 'student.growth.invite.error',
        tone: 'warn',
      });
    }
  }
  if (out.length === 0) {
    out.push({
      icon: 'info-circle',
      key: 'student.growth.nothing',
      tone: 'warn',
    });
  }
  return out;
}
