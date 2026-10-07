import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { TranslatePipe } from '@codify/i18n';
import { Button, EmptyState } from '@codify/ui-bootstrap';
import { AuthService } from '@codify/auth';

/**
 * Shown when the authGuard refuses access to the protected admin shell —
 * typically a STUDENT account. Offers sign-out so staff can re-authenticate.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Button, EmptyState, RouterLink, TranslatePipe],
  template: `
    <main class="forbidden-shell">
      <cdf-empty-state
        icon="x-circle"
        [title]="'admin.forbidden.title' | translate"
        [description]="'admin.forbidden.description' | translate"
      >
        <div class="row-actions">
          <cdf-button kind="primary" (click)="signOutAndRedirect()">
            {{ 'admin.shell.signOut' | translate }}
          </cdf-button>
          <cdf-button kind="ghost" routerLink="/login">
            {{ 'admin.forbidden.backToLogin' | translate }}
          </cdf-button>
        </div>
      </cdf-empty-state>
    </main>
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

  protected async signOutAndRedirect(): Promise<void> {
    await this.auth.signOut();
    void this.router.navigateByUrl('/login');
  }
}
