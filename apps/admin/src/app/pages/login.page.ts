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
import { FormField, Icon, Input } from '@codify/ui-bootstrap';
import { AuthService, safeRedirect, type UserRole } from '@codify/auth';

const ROLES: { role: UserRole; label: string; description: string }[] = [
  { role: 'ADMIN', label: 'Admin', description: 'Full administrative access.' },
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
  {
    role: 'STUDENT',
    label: 'Student',
    description: 'Will be denied — admin app is staff-only.',
  },
];

const DEFAULT_TARGET = '/playground';

/**
 * Admin login. With Clerk configured (`provideAuth({ clerkPublishableKey })`)
 * it mounts Clerk's sign-in; otherwise it shows the dev role picker backed
 * by AuthService dev mode. Either way it returns to `?redirect=` (in-app
 * paths only) once signed in.
 *
 * Per docs/04, the admin app is staff-only — STUDENT role is included
 * in the dev picker so we can verify the guard rejects it, not because
 * it's a valid sign-in target.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, FormField, Icon, Input],
  template: `
    <div class="login-shell">
      <header class="login-shell__header">
        <cdf-icon name="gear" size="lg" />
        <div>
          <h1>Codify · Admin</h1>
          <p class="text-muted mb-0">
            Sign in to manage content and analytics.
          </p>
        </div>
      </header>

      @if (clerkMode) {
        <div
          #clerkSignIn
          class="clerk-sign-in"
          data-testid="clerk-sign-in"
        ></div>
        @if (clerkError(); as msg) {
          <p class="text-danger mb-0" role="alert">{{ msg }}</p>
        }
      } @else {
        <cdf-form-field label="Display name (optional)">
          <cdf-input [(ngModel)]="displayName" placeholder="Maria Souza" />
        </cdf-form-field>

        <ul class="role-list">
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
    </div>
  `,
  styles: [
    `
      :host {
        display: flex;
        align-items: center;
        justify-content: center;
        min-height: 100vh;
        padding: var(--cdf-space-6);
      }
      .login-shell {
        display: flex;
        flex-direction: column;
        gap: var(--cdf-space-4);
        width: 100%;
        max-width: 480px;
        background: var(--cdf-color-surface);
        border: 1px solid var(--cdf-color-border);
        border-radius: var(--cdf-radius-lg);
        padding: var(--cdf-space-6);
        box-shadow: var(--cdf-shadow-sm);
      }
      .login-shell__header {
        display: flex;
        align-items: center;
        gap: var(--cdf-space-3);
        h1 {
          margin: 0 0 4px;
          font-size: var(--cdf-font-size-lg);
          font-weight: 700;
        }
      }
      .clerk-sign-in {
        display: flex;
        justify-content: center;
        min-height: 320px;
      }
      .role-list {
        list-style: none;
        padding: 0;
        margin: 0;
        display: flex;
        flex-direction: column;
        gap: var(--cdf-space-2);
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
    `,
  ],
})
export class LoginPage implements OnDestroy {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  protected readonly roles = ROLES;
  protected readonly clerkMode = this.auth.mode === 'clerk';
  protected readonly clerkError = signal<string | null>(null);
  protected displayName = '';
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
        this.clerkError.set(
          'Sign-in is unavailable right now. Please try again shortly.',
        );
      });
    });
  }

  ngOnDestroy(): void {
    if (this.mountedNode) this.auth.unmountSignIn(this.mountedNode);
  }

  protected signIn(role: UserRole): void {
    const name = this.displayName.trim();
    this.auth.signInAs(role, name ? { displayName: name } : {});
    void this.router.navigateByUrl(this.target());
  }

  private target(): string {
    return safeRedirect(
      this.route.snapshot.queryParamMap.get('redirect'),
      DEFAULT_TARGET,
    );
  }
}
