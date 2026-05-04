import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import {
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
} from '@ionic/angular/standalone';
import { AppButton, AppCard, AppInput, FormField, Icon } from '@codify/ui-ionic';
import { AuthService, type UserRole } from '@codify/auth';

const ROLES: { role: UserRole; label: string; description: string }[] = [
  { role: 'STUDENT', label: 'Student', description: 'Default — access learning surfaces.' },
  { role: 'TEACHER', label: 'Teacher', description: 'Author + edit own courses.' },
  { role: 'SUPPORT', label: 'Support', description: 'Read-only across the catalog.' },
  { role: 'ADMIN', label: 'Admin', description: 'Full administrative access.' },
];

/**
 * Dev-only login page. No real auth provider yet — clicking a role flips
 * `AuthService` state via `signInAs()`. Phase 4b replaces this with a
 * Clerk-hosted sign-in flow; the route stays at `/login` so deep-linked
 * `redirect_to` URLs continue to work.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonContent,
    AppButton,
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
        <header style="display:flex; align-items:center; gap:12px; margin-bottom:16px;">
          <cdf-icon name="rocket" size="lg" />
          <div>
            <h2 style="margin:0;">Codify dev login</h2>
            <p style="margin:0; color:var(--cdf-color-text-muted); font-size:13px;">
              Real auth lands in Phase 4b. For now, pick a role to continue.
            </p>
          </div>
        </header>

        <cdf-form-field label="Display name (optional)">
          <cdf-app-input
            [(ngModel)]="displayNameModel"
            placeholder="Maria Souza"
          />
        </cdf-form-field>

        <ul style="list-style:none; padding:0; margin: 16px 0 0; display:flex; flex-direction:column; gap:8px;">
          @for (r of roles; track r.role) {
          <li>
            <button type="button" class="role-btn" (click)="signIn(r.role)">
              <span class="role-btn__name">{{ r.label }}</span>
              <span class="role-btn__desc">{{ r.description }}</span>
            </button>
          </li>
          }
        </ul>

        @if (errorMessage(); as msg) {
        <p class="error">{{ msg }}</p>
        }
      </cdf-app-card>
    </ion-content>
  `,
  styles: [
    `
      :host { display: block; max-width: 540px; margin: 0 auto; }
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
      .role-btn:hover { background: var(--cdf-color-primary-subtle); }
      .role-btn:focus-visible { outline: 2px solid var(--cdf-color-primary); outline-offset: 2px; }
      .role-btn__name { font-weight: 600; }
      .role-btn__desc { font-size: 13px; color: var(--cdf-color-text-muted); }
      .error { color: var(--cdf-color-danger); font-size: 13px; margin-top: 12px; }
    `,
  ],
})
export class LoginPage {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  protected readonly roles = ROLES;
  protected displayNameModel = '';
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly currentRole = computed(() => this.auth.role());

  protected signIn(role: UserRole): void {
    this.errorMessage.set(null);
    const name = this.displayNameModel.trim();
    this.auth.signInAs(role, name ? { displayName: name } : {});
    // Read the redirect target from the URL — `/login?redirect=/today`.
    const target = new URL(window.location.href).searchParams.get('redirect') ?? '/today';
    void this.router.navigateByUrl(target);
  }
}
