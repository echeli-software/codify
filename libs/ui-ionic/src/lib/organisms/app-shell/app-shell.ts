import { Component, ChangeDetectionStrategy, input } from '@angular/core';
import { TranslatePipe } from '@codify/i18n';
import { RouterLink, RouterLinkActive } from '@angular/router';
import {
  IonTabs,
  IonTabBar,
  IonTabButton,
  IonLabel,
} from '@ionic/angular/standalone';
import { Icon, type IconName } from '../../atoms/icon/icon.js';

export interface ShellTab {
  /** URL path (no leading slash) — also used as the IonTab's `tab` id. */
  path: string;
  label: string;
  icon: IconName;
  /** Optional iconActive when selected (e.g. solid vs outline). */
  iconActive?: IconName;
  /** Optional badge text (notification count, "NEW", etc.). */
  badge?: string | null;
}

/**
 * Student app shell. Mobile-first: bottom tab bar + ion-router-outlet for
 * each tab's stack. Desktop (≥ md): the same router-outlet routes are
 * presented through a sidebar nav while the bottom tab bar visually hides.
 *
 * Per docs/05-student-app §1: "Bottom tabs → side rail: <ion-tab-bar slot=
 * 'bottom'> shown < md; sidebar nav shown ≥ md. Implemented with a single
 * AppShell organism that swaps internally."
 *
 *   <cdf-app-shell [tabs]="tabs" />
 *
 * Routes for each tab live in app.routes.ts. The shell delegates content
 * rendering to ion-router-outlet — drop-in for any number of tabs.
 */
@Component({
  selector: 'cdf-app-shell',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    RouterLinkActive,
    IonTabs,
    IonTabBar,
    IonTabButton,
    IonLabel,
    Icon,
    TranslatePipe,
  ],
  template: `
    <div class="cdf-shell">
      <aside
        class="cdf-shell__sidebar"
        [attr.aria-label]="'ui.shell.primaryNav' | translate"
      >
        <div class="cdf-shell__brand">{{ brand() }}</div>
        <nav>
          <ul>
            @for (t of tabs(); track t.path) {
              <li>
                <a
                  class="cdf-shell__sidebar-link"
                  [routerLink]="['/', t.path]"
                  routerLinkActive="cdf-shell__sidebar-link--active"
                  [routerLinkActiveOptions]="{ exact: false }"
                >
                  <cdf-icon [name]="t.icon" size="md" />
                  <span>{{ t.label }}</span>
                  @if (t.badge) {
                    <span class="cdf-shell__sidebar-badge">{{ t.badge }}</span>
                  }
                </a>
              </li>
            }
          </ul>
        </nav>
      </aside>

      <ion-tabs class="cdf-shell__tabs">
        <ion-tab-bar slot="bottom" class="cdf-shell__tab-bar">
          @for (t of tabs(); track t.path) {
            <ion-tab-button [tab]="t.path" [href]="'/' + t.path">
              <cdf-icon [name]="t.icon" size="md" />
              <ion-label>{{ t.label }}</ion-label>
              @if (t.badge) {
                <span class="cdf-shell__tab-badge">{{ t.badge }}</span>
              }
            </ion-tab-button>
          }
        </ion-tab-bar>
      </ion-tabs>
    </div>
  `,
  styleUrl: './app-shell.scss',
})
export class AppShell {
  readonly brand = input.required<string>();
  readonly tabs = input.required<ShellTab[]>();
}
