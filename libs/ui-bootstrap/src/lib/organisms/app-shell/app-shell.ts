import {
  Component,
  ChangeDetectionStrategy,
  ElementRef,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { CdkTrapFocus } from '@angular/cdk/a11y';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { TranslatePipe } from '@codify/i18n';
import { Icon, type IconName } from '../../atoms/icon/icon.js';
import { IconButton } from '../../atoms/icon-button/icon-button.js';
import { LanguageSwitcher } from '../../molecules/language-switcher/language-switcher.js';
import { ThemeToggle } from '../../molecules/theme-toggle/theme-toggle.js';

export interface NavItem {
  label: string;
  icon: IconName;
  routerLink: unknown[];
  badge?: string;
}

export interface NavSection {
  label?: string;
  items: NavItem[];
}

/**
 * Admin app shell: collapsible sidebar + sticky topbar + scrollable content.
 *
 * Responsive:
 *   - ≥ md: persistent sidebar (240px); collapses to 64px (icons only) when
 *     `collapsed` toggled.
 *   - < md: sidebar hidden by default; opens as a drawer overlay when
 *     `mobileOpen` toggled (hamburger in topbar).
 *
 * Slots (via projected content):
 *   - <ng-content select="[appShellTopbarRight]"> — extra topbar items
 *     (avatar, search, user menu); rendered after the language/theme controls.
 *   - default — page content.
 */
let shellSeq = 0;

@Component({
  selector: 'cdf-app-shell',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    RouterLinkActive,
    Icon,
    IconButton,
    LanguageSwitcher,
    ThemeToggle,
    CdkTrapFocus,
    TranslatePipe,
  ],
  template: `
    <div
      class="cdf-shell"
      [class.cdf-shell--collapsed]="collapsed()"
      [class.cdf-shell--mobile-open]="mobileOpen()"
    >
      <!-- eslint-disable-next-line @angular-eslint/template/interactive-supports-focus -- Esc bubbles up from the focused nav link -->
      <aside
        class="cdf-shell__sidebar"
        [id]="sidebarId"
        [attr.aria-label]="'ui.shell.primaryNav' | translate"
        [cdkTrapFocus]="mobileOpen()"
        [cdkTrapFocusAutoCapture]="true"
        (keydown.escape)="closeMobile(true)"
      >
        <div class="cdf-shell__brand">
          <cdf-icon [name]="brandIcon()" size="lg" />
          @if (!collapsed()) {
            <span class="cdf-shell__brand-label">{{ brand() }}</span>
          }
        </div>

        <nav class="cdf-shell__nav">
          @for (section of nav(); track $index) {
            <div class="cdf-shell__section">
              @if (section.label && !collapsed()) {
                <h3 class="cdf-shell__section-label">{{ section.label }}</h3>
              }
              <ul>
                @for (item of section.items; track item.routerLink) {
                  <li>
                    <a
                      class="cdf-shell__nav-link"
                      [routerLink]="item.routerLink"
                      routerLinkActive="cdf-shell__nav-link--active"
                      [routerLinkActiveOptions]="{ exact: false }"
                      (click)="closeMobile()"
                    >
                      <cdf-icon [name]="item.icon" size="sm" />
                      @if (!collapsed()) {
                        <span class="cdf-shell__nav-label">{{
                          item.label
                        }}</span>
                        @if (item.badge) {
                          <span class="cdf-shell__nav-badge">{{
                            item.badge
                          }}</span>
                        }
                      }
                    </a>
                  </li>
                }
              </ul>
            </div>
          }
        </nav>

        <div class="cdf-shell__sidebar-foot">
          <cdf-icon-button
            [icon]="collapsed() ? 'caret-right' : 'caret-left'"
            kind="ghost"
            size="sm"
            [ariaLabel]="
              (collapsed()
                ? 'ui.shell.expandSidebar'
                : 'ui.shell.collapseSidebar'
              ) | translate
            "
            (click)="toggleCollapsed()"
          />
        </div>
      </aside>

      @if (mobileOpen()) {
        <div
          class="cdf-shell__mobile-backdrop"
          (click)="closeMobile()"
          aria-hidden="true"
        ></div>
      }

      <div class="cdf-shell__main">
        <header class="cdf-shell__topbar">
          <cdf-icon-button
            class="cdf-shell__mobile-menu"
            icon="menu"
            kind="ghost"
            [ariaLabel]="'ui.shell.openMenu' | translate"
            [ariaExpanded]="mobileOpen()"
            [ariaControls]="sidebarId"
            (click)="openMobile()"
          />

          <div class="cdf-shell__topbar-left">
            <ng-content select="[appShellTopbarLeft]" />
          </div>

          <div class="cdf-shell__topbar-right">
            <cdf-language-switcher />
            <cdf-theme-toggle />
            <ng-content select="[appShellTopbarRight]" />
          </div>
        </header>

        <main class="cdf-shell__content">
          <ng-content />
        </main>
      </div>
    </div>
  `,
  styleUrl: './app-shell.scss',
})
export class AppShell {
  private readonly host = inject(ElementRef<HTMLElement>);
  protected readonly sidebarId = `cdf-shell-sidebar-${++shellSeq}`;

  readonly brand = input.required<string>();
  readonly brandIcon = input<IconName>('gear');
  readonly nav = input.required<NavSection[]>();

  /** Two-way bindable collapsed state (persisted by the consumer if needed). */
  readonly collapsed = signal(false);
  /** Toggle for mobile drawer state. */
  readonly mobileOpen = signal(false);

  readonly collapsedChange = output<boolean>();

  protected toggleCollapsed(): void {
    this.collapsed.update((v) => !v);
    this.collapsedChange.emit(this.collapsed());
  }
  protected openMobile(): void {
    this.mobileOpen.set(true);
  }
  /** Close the mobile drawer; on Esc, return focus to the menu button. */
  protected closeMobile(restoreFocus = false): void {
    if (!this.mobileOpen()) return;
    this.mobileOpen.set(false);
    if (restoreFocus) {
      (this.host.nativeElement as HTMLElement)
        .querySelector<HTMLElement>('.cdf-shell__mobile-menu button')
        ?.focus();
    }
  }
}
