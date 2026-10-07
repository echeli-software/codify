import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
} from '@angular/core';
import { Router, RouterModule } from '@angular/router';
import { I18nService, TranslatePipe } from '@codify/i18n';
import {
  AppShell,
  Avatar,
  Button,
  type NavSection,
  ToastHost,
} from '@codify/ui-bootstrap';
import { AuthService } from '@codify/auth';
import { navForRole } from '../core/roles';

/**
 * Routing host for the admin app shell. Builds the role-aware sidebar
 * (docs/04 §2) and the topbar user menu (avatar + role + sign-out), and
 * hosts the single global toast region. Mounted under the authGuard branch.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterModule, AppShell, Avatar, Button, ToastHost, TranslatePipe],
  template: `
    <cdf-app-shell
      [brand]="'admin.shell.brand' | translate"
      brandIcon="gear"
      [nav]="nav()"
    >
      <ng-container appShellTopbarRight>
        @if (user(); as u) {
          <span class="topbar-user">
            <cdf-avatar [name]="u.displayName" size="sm" />
            <span class="topbar-user__meta">
              <span class="topbar-user__name">{{ u.displayName }}</span>
              <span class="topbar-user__role">{{
                'admin.roles.' + u.role | translate
              }}</span>
            </span>
            <cdf-button kind="ghost" size="sm" (click)="signOut()">
              {{ 'admin.shell.signOut' | translate }}
            </cdf-button>
          </span>
        }
      </ng-container>

      <router-outlet />
    </cdf-app-shell>

    <cdf-toast-host />
  `,
  styles: [
    `
      .topbar-user {
        display: inline-flex;
        align-items: center;
        gap: var(--cdf-space-2);
      }
      .topbar-user__meta {
        display: inline-flex;
        flex-direction: column;
        line-height: 1.1;
      }
      .topbar-user__name {
        font-weight: 600;
        font-size: var(--cdf-font-size-sm);
      }
      .topbar-user__role {
        font-size: 11px;
        color: var(--cdf-color-text-muted);
        text-transform: uppercase;
        letter-spacing: 0.06em;
      }
      @media (max-width: 640px) {
        .topbar-user__meta {
          display: none;
        }
      }
    `,
  ],
})
export class ShellPage {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly i18n = inject(I18nService);
  protected readonly user = computed(() => this.auth.user());

  protected readonly nav = computed<NavSection[]>(() => {
    this.i18n.currentLocale(); // re-label on locale switch
    return navForRole(this.auth.role()).map((g) => ({
      label: g.labelKey ? this.i18n.t(g.labelKey) : undefined,
      items: g.items.map((i) => ({
        label: this.i18n.t(i.labelKey),
        icon: i.icon,
        routerLink: [i.link],
      })),
    }));
  });

  protected async signOut(): Promise<void> {
    await this.auth.signOut();
    void this.router.navigateByUrl('/login');
  }
}
