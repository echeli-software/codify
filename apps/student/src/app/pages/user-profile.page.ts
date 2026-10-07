import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  IonHeader,
  IonToolbar,
  IonTitle,
  IonButtons,
  IonBackButton,
  IonContent,
} from '@ionic/angular/standalone';
import {
  AppBadge,
  AppCard,
  AppSkeleton,
  AvatarRenderer,
  type AvatarSlot,
  type AvatarSprite,
  EmptyState,
  ErrorState,
  Icon,
  type IconName,
  ICON_NAMES,
} from '@codify/ui-ionic';
import {
  LeaguesClient,
  ProblemDetailsError,
  type PublicProfile,
} from '@codify/api-client';
import { AuthService } from '@codify/auth';
import { LocalePipe, TranslatePipe } from '@codify/i18n';
import { errorMessageKey } from '../platform/app-toast.service.js';
import { TelemetryService } from '../telemetry/telemetry.service.js';

/** Public profile (docs/05 §3 Profile): avatar, tier / level, stats and badges. */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    IonHeader,
    IonToolbar,
    IonTitle,
    IonButtons,
    IonBackButton,
    IonContent,
    AppBadge,
    AppCard,
    AppSkeleton,
    AvatarRenderer,
    EmptyState,
    ErrorState,
    Icon,
    TranslatePipe,
    LocalePipe,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-back-button
            defaultHref="/league"
            [text]="'common.back' | translate"
          />
        </ion-buttons>
        <ion-title>{{
          profile()?.displayName ?? ('student.profile.title' | translate)
        }}</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content class="ion-padding">
      <div class="up">
        @if (loading()) {
          <cdf-app-skeleton shape="rect" [height]="240" />
        } @else if (profile(); as p) {
          <div class="up__hero" data-testid="profile-hero">
            <cdf-avatar-renderer
              [config]="p.avatar.config"
              [equipped]="equippedSprites()"
              [size]="160"
              [showLevelRing]="true"
              [level]="p.level"
            />
            <h1>{{ p.displayName }}</h1>
            <cdf-app-badge variant="primary" [subtle]="true">
              {{
                'student.publicProfile.tierLevel'
                  | translate
                    : {
                        tier: ('ui.tier.' + p.tier | translate),
                        level: p.level,
                      }
              }}
            </cdf-app-badge>
          </div>

          <dl class="up__stats" data-testid="profile-stats">
            <div>
              <dd>{{ p.stats.lessonsCompleted | locale: 'integer' }}</dd>
              <dt>{{ 'student.publicProfile.lessons' | translate }}</dt>
            </div>
            <div>
              <dd>{{ p.stats.streakDays | locale: 'integer' }}</dd>
              <dt>{{ 'student.publicProfile.streak' | translate }}</dt>
            </div>
            <div>
              <dd>{{ p.stats.longestStreak | locale: 'integer' }}</dd>
              <dt>{{ 'student.publicProfile.best' | translate }}</dt>
            </div>
            <div>
              <dd>{{ p.stats.friends | locale: 'integer' }}</dd>
              <dt>{{ 'student.publicProfile.friends' | translate }}</dt>
            </div>
          </dl>

          <h2>
            {{
              'student.publicProfile.badges'
                | translate: { count: p.badges.length }
            }}
          </h2>
          @if (p.badges.length === 0) {
            <p class="up__muted">
              {{ 'student.publicProfile.noBadges' | translate }}
            </p>
          } @else {
            <ul class="up__badges" data-testid="profile-badges">
              @for (b of p.badges; track b.slug) {
                <li>
                  <cdf-app-card padding="normal" class="up__badge">
                    <cdf-icon [name]="badgeIcon(b.iconName)" size="md" />
                    <span>{{ b.name }}</span>
                    <small class="up__muted">{{
                      b.awardedAt | locale: 'date'
                    }}</small>
                  </cdf-app-card>
                </li>
              }
            </ul>
          }
        } @else if (errorKey(); as e) {
          <cdf-error-state
            [title]="'student.publicProfile.loadError' | translate"
            [description]="e | translate"
            (retry)="reload()"
          />
        } @else {
          <cdf-empty-state
            icon="person"
            [title]="'student.publicProfile.notFound' | translate"
            [description]="'student.publicProfile.notFoundBody' | translate"
          />
        }
      </div>
    </ion-content>
  `,
  styles: [
    `
      .up {
        max-width: 720px;
        margin: 0 auto;
      }
      .up__hero {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: var(--cdf-space-2);
        margin-bottom: var(--cdf-space-4);
      }
      .up__hero h1 {
        margin: var(--cdf-space-2) 0 0;
        font-size: var(--cdf-font-size-xl);
      }
      .up__stats {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: var(--cdf-space-2);
        margin: 0 0 var(--cdf-space-4);
      }
      .up__stats > div {
        display: flex;
        flex-direction: column-reverse;
        text-align: center;
        background: var(--cdf-color-surface-2, rgba(0, 0, 0, 0.04));
        border-radius: 12px;
        padding: var(--cdf-space-2);
      }
      .up__stats dd {
        margin: 0;
        font-size: 22px;
        font-weight: 800;
      }
      .up__stats dt {
        font-size: 12px;
        color: var(--cdf-color-text-muted);
      }
      .up__muted {
        color: var(--cdf-color-text-muted);
      }
      h2 {
        font-size: var(--cdf-font-size-md);
        margin: 0 0 var(--cdf-space-2);
      }
      .up__badges {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
        gap: var(--cdf-space-2);
      }
      .up__badge {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 4px;
        text-align: center;
      }
    `,
  ],
})
export class UserProfilePage {
  private readonly route = inject(ActivatedRoute);
  private readonly client = inject(LeaguesClient);
  private readonly auth = inject(AuthService);
  private readonly telemetry = inject(TelemetryService);

  protected readonly loading = signal(true);
  protected readonly profile = signal<PublicProfile | null>(null);
  protected readonly errorKey = signal<string | null>(null);

  protected readonly equippedSprites = computed<
    Partial<Record<AvatarSlot, AvatarSprite>>
  >(() => {
    const out: Partial<Record<AvatarSlot, AvatarSprite>> = {};
    for (const [slot, ref] of Object.entries(
      this.profile()?.avatar.equipped ?? {},
    )) {
      out[slot as AvatarSlot] = {
        spriteAssetId: ref.spriteAssetId,
        name: ref.name,
      };
    }
    return out;
  });

  constructor() {
    this.route.paramMap.pipe(takeUntilDestroyed()).subscribe((pm) => {
      const id = pm.get('id');
      if (id) void this.load(id);
    });
  }

  protected reload(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) void this.load(id);
  }

  private async load(id: string): Promise<void> {
    this.loading.set(true);
    this.errorKey.set(null);
    try {
      this.profile.set(await this.client.profile(id));
      this.telemetry.track('profile_view', {
        self: this.auth.user()?.id === id,
      });
    } catch (err) {
      this.profile.set(null);
      if (!(err instanceof ProblemDetailsError && err.isNotFound))
        this.errorKey.set(errorMessageKey(err));
    } finally {
      this.loading.set(false);
    }
  }

  protected badgeIcon(name: string | null): IconName {
    return name && (ICON_NAMES as readonly string[]).includes(name)
      ? (name as IconName)
      : 'trophy';
  }
}
