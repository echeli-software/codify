import { Component } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { Button, EmptyState } from '@codify/ui-bootstrap';
import { AuthService } from '@codify/auth';
import { inject } from '@angular/core';

/**
 * Shown when the authGuard refuses access to the protected admin shell.
 * Most common path: a STUDENT-role account hit /playground — bounce them
 * with a sign-out affordance so they can re-auth as a staff role.
 */
@Component({
  imports: [Button, EmptyState, RouterLink],
  template: `
    <div class="forbidden-shell">
      <cdf-empty-state
        icon="x-circle"
        title="Access denied"
        description="The admin app is for staff only. Your account doesn't have the required role."
      >
        <div style="display:flex; gap:8px;">
          <cdf-button kind="primary" (click)="signOutAndRedirect()">
            Sign out
          </cdf-button>
          <cdf-button kind="ghost" routerLink="/login">Back to login</cdf-button>
        </div>
      </cdf-empty-state>
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
      .forbidden-shell {
        max-width: 520px;
        padding: var(--cdf-space-6);
        background: var(--cdf-color-surface);
        border: 1px solid var(--cdf-color-border);
        border-radius: var(--cdf-radius-lg);
      }
    `,
  ],
})
export class ForbiddenPage {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  protected signOutAndRedirect(): void {
    this.auth.signOut();
    void this.router.navigateByUrl('/login');
  }
}
