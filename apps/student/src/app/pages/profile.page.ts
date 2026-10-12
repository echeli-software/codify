import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import {
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
} from '@ionic/angular/standalone';
import {
  AppButton,
  AppCard,
  AppInput,
  AppToggle,
  AvatarRenderer,
  FormField,
  Icon,
  LanguageSwitcher,
  LevelBadge,
  ThemeToggle,
  type IconName,
} from '@codify/ui-ionic';
import { AuthService } from '@codify/auth';
import { TranslatePipe } from '@codify/i18n';
import { ItemsClient, MeClient, type AvatarResponse } from '@codify/api-client';
import {
  MotionAndSoundService,
  SoundService,
  XpService,
} from '@codify/gamification-engine';
import { AppToastService } from '../platform/app-toast.service.js';
import { AppSessionService } from '../platform/app-session.service.js';
import { ProfileCertificatesComponent } from '../components/profile-certificates.component.js';
import { ReferralCardComponent } from '../components/referral-card.component.js';
import { equippedSprites } from './shared/avatar.js';

interface NavLink {
  path: string;
  icon: IconName;
  key: string;
  testId: string;
}

const LINKS: NavLink[] = [
  {
    path: '/my-courses',
    icon: 'school',
    key: 'myCourses',
    testId: 'my-courses-link',
  },
  {
    path: '/subscription',
    icon: 'diamond',
    key: 'subscription',
    testId: 'subscription-link',
  },
  { path: '/friends', icon: 'person', key: 'friends', testId: 'friends-link' },
  { path: '/league', icon: 'podium', key: 'league', testId: 'league-link' },
  {
    path: '/downloads',
    icon: 'download',
    key: 'downloads',
    testId: 'downloads-link',
  },
];

/**
 * Profile & settings (docs/05 §3 Profile / Settings): avatar + level,
 * display name, language (persisted to the profile), theme, sound and
 * reduced-motion toggles (the reward engine's own prefs), certificates,
 * the referral card and links to the rest of the account surfaces.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    RouterLink,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonContent,
    AppButton,
    AppCard,
    AppInput,
    AppToggle,
    AvatarRenderer,
    FormField,
    Icon,
    LanguageSwitcher,
    LevelBadge,
    ThemeToggle,
    ProfileCertificatesComponent,
    ReferralCardComponent,
    TranslatePipe,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-title>{{ 'student.profile.title' | translate }}</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content class="ion-padding">
      <div class="pf">
        @if (user(); as u) {
          <cdf-app-card padding="spacious">
            <header class="pf__hero" data-testid="profile-hero">
              <a
                routerLink="/avatar"
                class="pf__avatar"
                [attr.aria-label]="'student.today.editAvatar' | translate"
              >
                <cdf-avatar-renderer
                  [config]="avatar()?.config ?? null"
                  [equipped]="sprites()"
                  [size]="96"
                  [showLevelRing]="true"
                  [level]="xp.level()"
                />
              </a>
              <div class="pf__copy">
                <h1>{{ u.displayName }}</h1>
                <p class="pf__muted">{{ u.email }}</p>
                <cdf-level-badge [level]="xp.level()" size="sm" />
              </div>
            </header>
            <a class="pf__public" [routerLink]="['/u', u.id]">{{
              'student.profile.viewPublic' | translate
            }}</a>
          </cdf-app-card>

          <nav [attr.aria-label]="'student.profile.navLabel' | translate">
            <ul class="pf__links">
              @for (l of links; track l.path) {
                <li>
                  <a
                    [routerLink]="l.path"
                    [attr.data-testid]="l.testId"
                    class="pf__link"
                  >
                    <cdf-icon [name]="l.icon" size="md" />
                    <span>
                      <strong>{{
                        'student.profile.links.' + l.key + '.title' | translate
                      }}</strong>
                      <small>{{
                        'student.profile.links.' + l.key + '.body' | translate
                      }}</small>
                    </span>
                    <cdf-icon name="chevron-forward" size="sm" />
                  </a>
                </li>
              }
            </ul>
          </nav>

          <cdf-referral-card />
          <cdf-profile-certificates />

          <h2>{{ 'student.profile.account' | translate }}</h2>
          <cdf-app-card padding="normal">
            <form class="pf__form" (submit)="saveName($event)">
              <cdf-form-field
                [label]="'student.profile.displayName' | translate"
                class="pf__field"
              >
                <cdf-app-input
                  name="displayName"
                  [(ngModel)]="displayName"
                  [maxLength]="60"
                  data-testid="display-name"
                />
              </cdf-form-field>
              <cdf-app-button
                kind="secondary"
                type="submit"
                [loading]="savingName()"
                >{{ 'common.save' | translate }}</cdf-app-button
              >
            </form>
            @if (auth.mode === 'clerk') {
              <cdf-app-button
                kind="ghost"
                (buttonClick)="auth.openUserProfile()"
              >
                {{ 'student.profile.manageAccount' | translate }}
              </cdf-app-button>
            }
          </cdf-app-card>

          <h2>{{ 'student.profile.preferences' | translate }}</h2>
          <cdf-app-card padding="normal">
            <div class="pf__prefs">
              <cdf-language-switcher data-testid="language-switcher" />
              <div>
                <p class="pf__label">{{ 'common.theme.label' | translate }}</p>
                <cdf-theme-toggle />
              </div>
              <cdf-app-toggle
                [label]="'student.profile.sound' | translate"
                [ngModel]="soundOn()"
                (ngModelChange)="setSound($event)"
                data-testid="sound-toggle"
              />
              <cdf-app-toggle
                [label]="'student.profile.reduceMotion' | translate"
                [ngModel]="reducedMotion()"
                (ngModelChange)="setReducedMotion($event)"
                data-testid="motion-toggle"
              />
              <p class="pf__muted">
                {{ 'student.profile.reduceMotionHint' | translate }}
              </p>
            </div>
          </cdf-app-card>

          <h2>{{ 'student.profile.session' | translate }}</h2>
          <cdf-app-card padding="normal">
            <p class="pf__muted">
              {{ 'student.profile.signedInAs' | translate: { email: u.email } }}
            </p>
            <cdf-app-button
              kind="danger"
              [loading]="signingOut()"
              (buttonClick)="signOut()"
              data-testid="sign-out"
            >
              <cdf-icon name="log-out" size="sm" />
              {{ 'common.signOut' | translate }}
            </cdf-app-button>
          </cdf-app-card>
        }
      </div>
    </ion-content>
  `,
  styles: [
    `
      .pf {
        max-width: 720px;
        margin: 0 auto;
        display: flex;
        flex-direction: column;
        gap: var(--cdf-space-3);
      }
      h2 {
        margin: var(--cdf-space-3) 0 0;
        font-size: var(--cdf-font-size-sm);
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: var(--cdf-color-text-muted);
      }
      .pf__hero {
        display: flex;
        align-items: center;
        gap: var(--cdf-space-3);
      }
      .pf__avatar {
        border-radius: 50%;
        display: inline-flex;
      }
      .pf__copy h1 {
        margin: 0;
        font-size: var(--cdf-font-size-lg);
      }
      .pf__muted {
        color: var(--cdf-color-text-muted);
        font-size: var(--cdf-font-size-sm);
        margin: 2px 0 6px;
      }
      .pf__public {
        display: inline-block;
        margin-top: var(--cdf-space-2);
        color: var(--cdf-color-primary);
        font-weight: 600;
        font-size: var(--cdf-font-size-sm);
      }
      .pf__links {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        gap: var(--cdf-space-1);
      }
      .pf__link {
        display: flex;
        align-items: center;
        gap: var(--cdf-space-2);
        padding: var(--cdf-space-2) var(--cdf-space-3);
        border-radius: 12px;
        background: var(--cdf-color-surface);
        border: 1px solid var(--cdf-color-border);
        color: inherit;
        text-decoration: none;
        min-height: 56px;
      }
      .pf__link span {
        flex: 1;
        display: flex;
        flex-direction: column;
      }
      .pf__link small {
        color: var(--cdf-color-text-muted);
      }
      .pf__link:focus-visible,
      .pf__avatar:focus-visible {
        outline: 2px solid var(--cdf-color-primary);
        outline-offset: 2px;
      }
      .pf__form {
        display: flex;
        gap: var(--cdf-space-2);
        align-items: flex-end;
        flex-wrap: wrap;
      }
      .pf__field {
        flex: 1 1 220px;
      }
      .pf__prefs {
        display: flex;
        flex-direction: column;
        gap: var(--cdf-space-3);
      }
      .pf__label {
        margin: 0 0 4px;
        font-size: var(--cdf-font-size-sm);
        font-weight: 600;
      }
    `,
  ],
})
export class ProfilePage {
  protected readonly auth = inject(AuthService);
  private readonly me = inject(MeClient);
  private readonly items = inject(ItemsClient);
  private readonly sound = inject(SoundService);
  private readonly motion = inject(MotionAndSoundService);
  private readonly toast = inject(AppToastService);
  private readonly session = inject(AppSessionService);
  protected readonly signingOut = this.session.signingOut;
  protected readonly xp = inject(XpService);

  protected readonly links = LINKS;
  protected readonly user = this.auth.user;
  protected readonly avatar = signal<AvatarResponse | null>(null);
  protected readonly sprites = computed(() => equippedSprites(this.avatar()));
  protected readonly soundOn = this.sound.soundEnabled;
  protected readonly reducedMotion = this.motion.reducedMotion;
  protected readonly savingName = signal(false);
  protected displayName = this.auth.user()?.displayName ?? '';

  constructor() {
    void this.loadAvatar();
  }

  private async loadAvatar(): Promise<void> {
    try {
      this.avatar.set(await this.items.avatar());
    } catch {
      // The level ring + base body still render without equipment.
      this.avatar.set(null);
    }
  }

  protected async saveName(ev: Event): Promise<void> {
    ev.preventDefault();
    const next = this.displayName.trim();
    if (!next || next === this.user()?.displayName) return;
    this.savingName.set(true);
    try {
      const me = await this.me.update({ displayName: next });
      this.auth.updateProfile({ displayName: me.displayName });
      this.toast.show({
        message: 'student.profile.nameSaved',
        kind: 'success',
      });
    } catch (err) {
      this.toast.error(err);
    } finally {
      this.savingName.set(false);
    }
  }

  protected setSound(on: boolean): void {
    this.sound.setSoundEnabled(on);
  }

  protected setReducedMotion(on: boolean): void {
    this.motion.setMotionPref(on ? 'off' : 'system');
  }

  /**
   * Explicit sign-out goes through the session service: it asks first when
   * progress is still unsynced, then clears this user's queue, identity
   * cache and downloads before ending the auth session.
   */
  protected async signOut(): Promise<void> {
    try {
      await this.session.requestSignOut();
    } catch (err) {
      this.toast.error(err);
    }
  }
}
