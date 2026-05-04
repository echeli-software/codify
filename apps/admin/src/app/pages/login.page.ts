import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import {
  Button,
  FormField,
  Icon,
  Input,
} from '@codify/ui-bootstrap';
import { AuthService, type UserRole } from '@codify/auth';

const ROLES: { role: UserRole; label: string; description: string }[] = [
  { role: 'ADMIN', label: 'Admin', description: 'Full administrative access.' },
  { role: 'TEACHER', label: 'Teacher', description: 'Author + edit own courses.' },
  { role: 'SUPPORT', label: 'Support', description: 'Read-only across the catalog.' },
  { role: 'STUDENT', label: 'Student', description: 'Will be denied — admin app is staff-only.' },
];

/**
 * Dev-only login page for the admin app. Real auth lands in Phase 4b
 * with Clerk; this is a one-click role flip backed by AuthService stub
 * mode so dev work isn't blocked.
 *
 * Per docs/04, the admin app is staff-only — STUDENT role is included
 * in the picker so we can verify the guard rejects it, not because it's
 * a valid sign-in target.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, Button, FormField, Icon, Input],
  template: `
    <div class="login-shell">
      <header class="login-shell__header">
        <cdf-icon name="gear" size="lg" />
        <div>
          <h1>Codify · Admin</h1>
          <p class="text-muted mb-0">Sign in to manage content and analytics.</p>
        </div>
      </header>

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
export class LoginPage {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  protected readonly roles = ROLES;
  protected displayName = '';

  protected signIn(role: UserRole): void {
    const name = this.displayName.trim();
    this.auth.signInAs(role, name ? { displayName: name } : {});
    const target =
      new URL(window.location.href).searchParams.get('redirect') ?? '/playground';
    void this.router.navigateByUrl(target);
  }
}
