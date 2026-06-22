import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { Router, RouterModule } from '@angular/router';
import {
  AppShell,
  Avatar,
  Button,
  type NavSection,
  ToastHost,
} from '@codify/ui-bootstrap';
import { AuthService } from '@codify/auth';

const NAV: NavSection[] = [
  {
    items: [{ label: 'Playground', icon: 'gear', routerLink: ['/playground'] }],
  },
  {
    label: 'Catalog',
    items: [
      { label: 'Courses', icon: 'pencil', routerLink: ['/courses'] },
      { label: 'Categories', icon: 'gear', routerLink: ['/categories'] },
      { label: 'Plans', icon: 'credit-card', routerLink: ['/plans'] },
      { label: 'Gamification', icon: 'trophy', routerLink: ['/gamification'] },
      { label: 'Shop items', icon: 'gift', routerLink: ['/items'] },
    ],
  },
  {
    label: 'Account',
    items: [{ label: 'Profile', icon: 'user-circle', routerLink: ['/profile'] }],
  },
];

/**
 * Routing host for the admin app shell. Owns the sidebar nav config and
 * the topbar user menu (avatar + role + sign-out). Mounted under the
 * authGuard-protected branch so unauthenticated traffic never sees it.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterModule, AppShell, Avatar, Button, ToastHost],
  template: `
    <cdf-app-shell brand="Codify · Admin" brandIcon="gear" [nav]="nav">
      <ng-container appShellTopbarRight>
        @if (user(); as u) {
        <span class="topbar-user">
          <cdf-avatar [name]="u.displayName" size="sm" />
          <span class="topbar-user__meta">
            <span class="topbar-user__name">{{ u.displayName }}</span>
            <span class="topbar-user__role">{{ u.role }}</span>
          </span>
          <cdf-button kind="ghost" size="sm" (click)="signOut()">
            Sign out
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
    `,
  ],
})
export class ShellPage {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  protected readonly nav = NAV;
  protected readonly user = computed(() => this.auth.user());

  protected signOut(): void {
    this.auth.signOut();
    void this.router.navigateByUrl('/login');
  }
}
