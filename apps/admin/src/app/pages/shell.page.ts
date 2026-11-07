import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { Router, RouterModule } from '@angular/router';
import { I18nService, TranslatePipe } from '@codify/i18n';
import {
  AppShell,
  Avatar,
  Button,
  Icon,
  Kbd,
  LanguageSwitcher,
  type NavSection,
  Popover,
  ThemeToggle,
  ToastHost,
} from '@codify/ui-bootstrap';
import { AuthService } from '@codify/auth';
import { navForRole } from '../core/roles';
import { SearchPalette } from '../core/search-palette';
import { AdminTelemetry } from '../core/telemetry';

/** Cmd-K on Apple platforms, Ctrl-K elsewhere (both work everywhere). */
export function isPaletteShortcut(ev: KeyboardEvent): boolean {
  return (
    (ev.metaKey || ev.ctrlKey) &&
    !ev.altKey &&
    !ev.shiftKey &&
    ev.key.toLowerCase() === 'k'
  );
}

/**
 * Routing host for the admin app shell. Builds the role-aware sidebar
 * (docs/04 §2) and the topbar user menu (avatar + role + sign-out), and
 * hosts the single global toast region. Mounted under the authGuard branch.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterModule,
    AppShell,
    Avatar,
    Button,
    Icon,
    Kbd,
    LanguageSwitcher,
    Popover,
    SearchPalette,
    ThemeToggle,
    ToastHost,
    TranslatePipe,
  ],
  host: { '(document:keydown)': 'onGlobalKeydown($event)' },
  template: `
    <cdf-app-shell
      [brand]="'admin.shell.brand' | translate"
      brandIcon="gear"
      [nav]="nav()"
    >
      <ng-container appShellTopbarLeft>
        <button
          type="button"
          class="topbar-search"
          aria-haspopup="dialog"
          [attr.aria-expanded]="searchOpen()"
          [attr.aria-keyshortcuts]="'Control+K Meta+K'"
          (click)="searchOpen.set(true)"
          data-testid="open-search"
        >
          <cdf-icon name="search" size="sm" />
          <span class="topbar-search__label">{{
            'admin.search.open' | translate
          }}</span>
          <cdf-kbd class="topbar-search__kbd">{{
            (isMac ? 'admin.search.shortcutMac' : 'admin.search.shortcut')
              | translate
          }}</cdf-kbd>
        </button>
      </ng-container>
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
          <!-- < 1024 px: language, theme, user and sign-out move into this menu. -->
          <button
            type="button"
            class="topbar-menu"
            [cdfPopover]="accountMenu"
            cdfPopoverPlacement="bottom-end"
            cdfPopoverAutoClose="outside"
            [attr.aria-label]="'admin.shell.accountMenu' | translate"
            aria-haspopup="dialog"
            [attr.aria-expanded]="menuOpen()"
            (cdfPopoverShown)="menuOpen.set(true)"
            (cdfPopoverHidden)="menuOpen.set(false)"
            data-testid="account-menu"
          >
            <cdf-avatar [name]="u.displayName" size="sm" />
          </button>
          <ng-template #accountMenu>
            <div class="topbar-menu__panel" data-testid="account-menu-panel">
              <div class="topbar-menu__who">
                <span class="topbar-user__name">{{ u.displayName }}</span>
                <span class="topbar-user__role">{{
                  'admin.roles.' + u.role | translate
                }}</span>
              </div>
              <cdf-language-switcher />
              <cdf-theme-toggle />
              <cdf-button kind="ghost" size="sm" (click)="signOut()">
                {{ 'admin.shell.signOut' | translate }}
              </cdf-button>
            </div>
          </ng-template>
        }
      </ng-container>

      <router-outlet />
    </cdf-app-shell>

    <cdf-admin-search-palette
      [open]="searchOpen()"
      (closed)="searchOpen.set(false)"
    />
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
      .topbar-search {
        display: inline-flex;
        align-items: center;
        gap: var(--cdf-space-2);
        min-width: 220px;
        padding: 4px 10px;
        border: 1px solid var(--cdf-color-border);
        border-radius: var(--cdf-radius-md);
        background: var(--cdf-color-surface);
        color: var(--cdf-color-text-muted);
        font-size: var(--cdf-font-size-sm);
      }
      .topbar-search:hover {
        border-color: var(--cdf-color-primary);
      }
      .topbar-search__label {
        flex: 1;
        text-align: start;
      }
      .topbar-menu {
        display: none;
        align-items: center;
        padding: 2px;
        border: 1px solid transparent;
        border-radius: 999px;
        background: none;
      }
      .topbar-menu:hover {
        border-color: var(--cdf-color-border);
      }
      .topbar-menu:focus-visible {
        outline: 2px solid var(--cdf-color-primary);
        outline-offset: 2px;
      }
      .topbar-menu__panel {
        display: flex;
        flex-direction: column;
        align-items: stretch;
        gap: var(--cdf-space-3);
        min-width: 200px;
      }
      .topbar-menu__who {
        display: flex;
        flex-direction: column;
        line-height: 1.2;
      }
      /* Narrower desktops: icon-only search, no name next to the avatar. */
      @media (max-width: 1199.98px) {
        .topbar-user__meta,
        .topbar-search__label,
        .topbar-search__kbd {
          display: none;
        }
        .topbar-search {
          min-width: 0;
          padding: 6px 8px;
        }
      }
      /*
       * Phone + tablet (at 768 px the sidebar leaves ~530 px of topbar):
       * language / theme / user / sign-out collapse into the menu.
       */
      @media (max-width: 1023.98px) {
        :host ::ng-deep .cdf-shell__topbar-right > cdf-language-switcher,
        :host ::ng-deep .cdf-shell__topbar-right > cdf-theme-toggle,
        .topbar-user {
          display: none;
        }
        .topbar-menu {
          display: inline-flex;
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
  protected readonly searchOpen = signal(false);
  protected readonly menuOpen = signal(false);
  protected readonly isMac =
    typeof navigator !== 'undefined' &&
    /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent);

  constructor() {
    // docs/04 §8: page views (route + role + locale), batched.
    inject(AdminTelemetry).trackPageViews(this.router, inject(DestroyRef));
  }

  protected onGlobalKeydown(ev: KeyboardEvent): void {
    if (!isPaletteShortcut(ev)) return;
    ev.preventDefault();
    // Opens only; while open the palette handles the shortcut (closes).
    this.searchOpen.set(true);
  }

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
