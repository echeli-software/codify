import { Component } from '@angular/core';
import { AppShell, type ShellTab } from '@codify/ui-ionic';

const TABS: ShellTab[] = [
  { path: 'today', label: 'Today', icon: 'home' },
  { path: 'catalog', label: 'Catalog', icon: 'school' },
  { path: 'avatar', label: 'Avatar', icon: 'person-circle' },
  { path: 'shop', label: 'Shop', icon: 'cart' },
  { path: 'profile', label: 'Profile', icon: 'person' },
];

/**
 * Routing host for the student app shell. Owns the tabs config; the shell
 * organism handles the responsive tab-bar / sidebar swap and renders the
 * active tab through ion-tabs' internal router-outlet.
 */
@Component({
  imports: [AppShell],
  template: `<cdf-app-shell brand="Codify" [tabs]="tabs" />`,
})
export class ShellPage {
  protected readonly tabs = TABS;
}
