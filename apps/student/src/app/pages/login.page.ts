import {
  ChangeDetectionStrategy,
  Component,
  type ElementRef,
  type OnDestroy,
  afterNextRender,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import {
  IonContent,
  IonHeader,
  IonTitle,
  IonToolbar,
} from '@ionic/angular/standalone';
import { TranslatePipe } from '@codify/i18n';
import { AppCard, AppInput, FormField, Icon } from '@codify/ui-ionic';
import { AuthService, safeRedirect, type UserRole } from '@codify/auth';
import { NetworkStatusService } from '../offline/network-status.service.js';
import { TelemetryService } from '../telemetry/telemetry.service.js';

interface DevAccount {
  role: UserRole;
  /** Dev-token suffix (`dev-token-<id>`); omitted → the role's default user. */
  id?: string;
  key: string;
}

/** Dev role picker — only shown when Clerk isn't configured. */
const DEV_ACCOUNTS: DevAccount[] = [
  { role: 'STUDENT', key: 'student' },
  { role: 'STUDENT', id: 'student2', key: 'student2' },
  { role: 'TEACHER', key: 'teacher' },
  { role: 'SUPPORT', key: 'support' },
  { role: 'ADMIN', key: 'admin' },
];

const DEFAULT_TARGET = '/today';

/**
 * Student login. With Clerk configured it mounts Clerk's sign-in (magic
 * link / Google / Apple per docs/14 §1); otherwise it shows the dev account
 * picker. Either way it returns to `?redirect=` (in-app paths only). Sign-in
 * needs connectivity (docs/16 §4) — offline we say so instead of failing.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonContent,
    AppCard,
    AppInput,
    FormField,
    Icon,
    TranslatePipe,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-title>{{ 'common.signIn' | translate }}</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content class="ion-padding">
      <div class="wrap">
        @if (!online()) {
          <p class="offline" role="status" data-testid="login-offline">
            <cdf-icon name="cloud-offline" size="sm" />
            {{ 'studentPlatform.login.offline' | translate }}
          </p>
        }
        <cdf-app-card padding="spacious">
          <header class="head">
            <cdf-icon name="rocket" size="lg" />
            <div>
              @if (clerkMode) {
                <h1>{{ 'studentPlatform.login.welcome' | translate }}</h1>
                <p class="muted">
                  {{ 'studentPlatform.login.clerkBody' | translate }}
                </p>
              } @else {
                <h1>{{ 'studentPlatform.login.devTitle' | translate }}</h1>
                <p class="muted">
                  {{ 'studentPlatform.login.devBody' | translate }}
                </p>
              }
            </div>
          </header>

          @if (clerkMode) {
            <div
              #clerkSignIn
              class="clerk-sign-in"
              data-testid="clerk-sign-in"
            ></div>
          } @else {
            <cdf-form-field
              [label]="'studentPlatform.login.displayName' | translate"
            >
              <cdf-app-input
                [(ngModel)]="displayNameModel"
                [placeholder]="
                  'studentPlatform.login.displayNamePlaceholder' | translate
                "
              />
            </cdf-form-field>

            <ul class="roles">
              @for (a of accounts; track a.key) {
                <li>
                  <button
                    type="button"
                    class="role-btn"
                    [attr.data-account]="a.key"
                    [disabled]="!online()"
                    (click)="signIn(a)"
                  >
                    <span class="role-btn__name">{{
                      'studentPlatform.login.account.' + a.key + '.name'
                        | translate
                    }}</span>
                    <span class="role-btn__desc">{{
                      'studentPlatform.login.account.' + a.key + '.description'
                        | translate
                    }}</span>
                  </button>
                </li>
              }
            </ul>
          }

          @if (errorKey(); as key) {
            <p class="error" role="alert">{{ key | translate }}</p>
          }
        </cdf-app-card>
      </div>
    </ion-content>
  `,
  styles: [
    `
      .wrap {
        max-width: 540px;
        margin: 0 auto;
      }
      .head {
        display: flex;
        align-items: center;
        gap: 12px;
        margin-bottom: 16px;
      }
      .head h1 {
        margin: 0;
        font-size: 20px;
      }
      .muted {
        margin: 0;
        color: var(--cdf-color-text-muted);
        font-size: 13px;
      }
      .offline {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 10px 12px;
        border-radius: 10px;
        background: var(--cdf-color-warning-subtle, #fff4d6);
        color: var(--cdf-color-warning-strong, #8a5a00);
        font-size: 14px;
      }
      .roles {
        list-style: none;
        padding: 0;
        margin: 16px 0 0;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .role-btn {
        all: unset;
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
        gap: 2px;
        width: 100%;
        padding: 12px 16px;
        border-radius: 8px;
        border: 1px solid var(--cdf-color-border);
        cursor: pointer;
        transition: background-color 120ms;
      }
      .role-btn:hover {
        background: var(--cdf-color-primary-subtle);
      }
      .role-btn:focus-visible {
        outline: 2px solid var(--cdf-color-primary);
        outline-offset: 2px;
      }
      .role-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
      .role-btn__name {
        font-weight: 600;
      }
      .role-btn__desc {
        font-size: 13px;
        color: var(--cdf-color-text-muted);
      }
      .clerk-sign-in {
        display: flex;
        justify-content: center;
        min-height: 320px;
      }
      .error {
        color: var(--cdf-color-danger);
        font-size: 13px;
        margin-top: 12px;
      }
    `,
  ],
})
export class LoginPage implements OnDestroy {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly network = inject(NetworkStatusService);
  private readonly telemetry = inject(TelemetryService);
  protected readonly accounts = DEV_ACCOUNTS;
  protected readonly clerkMode = this.auth.mode === 'clerk';
  protected readonly online = this.network.online;
  protected displayNameModel = '';
  protected readonly errorKey = signal<string | null>(null);
  private readonly clerkHost =
    viewChild<ElementRef<HTMLDivElement>>('clerkSignIn');
  private mountedNode: HTMLDivElement | null = null;

  constructor() {
    this.telemetry.track('login_viewed', { mode: this.auth.mode });
    // Already signed in (or Clerk finished asynchronously) → go back.
    effect(() => {
      if (this.auth.isAuthenticated())
        void this.router.navigateByUrl(this.target());
    });
    if (!this.clerkMode) return;
    afterNextRender(() => void this.mountClerk());
    // Came back online → mount the sign-in widget if it failed earlier.
    effect(() => {
      if (this.online() && this.errorKey() && !this.mountedNode)
        void this.mountClerk();
    });
  }

  ngOnDestroy(): void {
    if (this.mountedNode) this.auth.unmountSignIn(this.mountedNode);
  }

  protected signIn(account: DevAccount): void {
    this.errorKey.set(null);
    if (!this.online()) {
      this.errorKey.set('studentPlatform.login.offline');
      return;
    }
    const name = this.displayNameModel.trim();
    this.auth.signInAs(account.role, {
      ...(account.id ? { id: account.id } : {}),
      ...(name ? { displayName: name } : {}),
    });
    this.telemetry.track('sign_in_completed', {
      mode: 'dev',
      role: account.role,
    });
    void this.router.navigateByUrl(this.target());
  }

  private async mountClerk(): Promise<void> {
    const node = this.clerkHost()?.nativeElement;
    if (!node || this.mountedNode) return;
    try {
      await this.auth.mountSignIn(node, { redirectUrl: this.target() });
      this.mountedNode = node;
      this.errorKey.set(null);
    } catch {
      this.errorKey.set(
        this.online()
          ? 'studentPlatform.login.unavailable'
          : 'studentPlatform.login.offline',
      );
    }
  }

  /** `/login?redirect=/today` — in-app paths only (no open redirects). */
  private target(): string {
    return safeRedirect(
      this.route.snapshot.queryParamMap.get('redirect'),
      DEFAULT_TARGET,
    );
  }
}
