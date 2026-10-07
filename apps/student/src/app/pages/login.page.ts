import {
  ChangeDetectionStrategy,
  Component,
  type ElementRef,
  type OnDestroy,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import {
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
} from '@ionic/angular/standalone';
import { AppCard, AppInput, FormField, Icon } from '@codify/ui-ionic';
import { AuthService, safeRedirect, type UserRole } from '@codify/auth';

const ROLES: { role: UserRole; label: string; description: string }[] = [
  {
    role: 'STUDENT',
    label: 'Student',
    description: 'Default — access learning surfaces.',
  },
  {
    role: 'TEACHER',
    label: 'Teacher',
    description: 'Author + edit own courses.',
  },
  {
    role: 'SUPPORT',
    label: 'Support',
    description: 'Read-only across the catalog.',
  },
  { role: 'ADMIN', label: 'Admin', description: 'Full administrative access.' },
];

const DEFAULT_TARGET = '/today';

/**
 * Student login. With Clerk configured (`provideAuth({ clerkPublishableKey })`)
 * it mounts Clerk's sign-in (magic link / Google / Apple per docs/14 §1);
 * otherwise it shows the dev role picker. Either way it returns to
 * `?redirect=` (in-app paths only) once signed in.
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
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-title>Sign in</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content class="ion-padding">
      <cdf-app-card padding="spacious">
        <header
          style="display:flex; align-items:center; gap:12px; margin-bottom:16px;"
        >
          <cdf-icon name="rocket" size="lg" />
          <div>
            @if (clerkMode) {
              <h2 style="margin:0;">Welcome to Codify</h2>
              <p
                style="margin:0; color:var(--cdf-color-text-muted); font-size:13px;"
              >
                Sign in or create your account to keep learning.
              </p>
            } @else {
              <h2 style="margin:0;">Codify dev login</h2>
              <p
                style="margin:0; color:var(--cdf-color-text-muted); font-size:13px;"
              >
                Clerk is not configured — pick a role to continue.
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
          <cdf-form-field label="Display name (optional)">
            <cdf-app-input
              [(ngModel)]="displayNameModel"
              placeholder="Maria Souza"
            />
          </cdf-form-field>

          <ul
            style="list-style:none; padding:0; margin: 16px 0 0; display:flex; flex-direction:column; gap:8px;"
          >
            @for (r of roles; track r.role) {
              <li>
                <button type="button" class="role-btn" (click)="signIn(r.role)">
                  <span class="role-btn__name">{{ r.label }}</span>
                  <span class="role-btn__desc">{{ r.description }}</span>
                </button>
              </li>
            }
          </ul>
        }

        @if (errorMessage(); as msg) {
          <p class="error" role="alert">{{ msg }}</p>
        }
      </cdf-app-card>
    </ion-content>
  `,
  styles: [
    `
      :host {
        display: block;
        max-width: 540px;
        margin: 0 auto;
      }
      .role-btn {
        all: unset;
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
  protected readonly roles = ROLES;
  protected readonly clerkMode = this.auth.mode === 'clerk';
  protected displayNameModel = '';
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly currentRole = computed(() => this.auth.role());
  private readonly clerkHost =
    viewChild<ElementRef<HTMLDivElement>>('clerkSignIn');
  private mountedNode: HTMLDivElement | null = null;

  constructor() {
    if (!this.clerkMode) return;
    // Clerk sign-in completes asynchronously; leave once the session (and
    // the API role) resolves — also covers arriving here already signed in.
    effect(() => {
      if (this.auth.isAuthenticated())
        void this.router.navigateByUrl(this.target());
    });
    afterNextRender(() => {
      const node = this.clerkHost()?.nativeElement;
      if (!node) return;
      this.mountedNode = node;
      this.auth.mountSignIn(node, { redirectUrl: this.target() }).catch(() => {
        this.errorMessage.set(
          'Sign-in is unavailable right now. Check your connection and try again.',
        );
      });
    });
  }

  ngOnDestroy(): void {
    if (this.mountedNode) this.auth.unmountSignIn(this.mountedNode);
  }

  protected signIn(role: UserRole): void {
    this.errorMessage.set(null);
    const name = this.displayNameModel.trim();
    this.auth.signInAs(role, name ? { displayName: name } : {});
    void this.router.navigateByUrl(this.target());
  }

  /** `/login?redirect=/today` — in-app paths only (no open redirects). */
  private target(): string {
    return safeRedirect(
      this.route.snapshot.queryParamMap.get('redirect'),
      DEFAULT_TARGET,
    );
  }
}
