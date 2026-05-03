import { Component, inject, OnInit } from '@angular/core';
import { AppShell, type ShellTab } from '@codify/ui-ionic';
import { RewardOrchestrator } from '@codify/gamification-engine';
import { RewardOverlays } from '../reward-overlays.component.js';

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
 *
 * Also seeds the RewardOrchestrator with a demo opening balance and mounts
 * the RewardOverlays host so any tab can pop a level-up / badge modal via
 * the orchestrator. Real seed comes from /me on app boot in Phase 5.
 */
@Component({
  imports: [AppShell, RewardOverlays],
  template: `
    <cdf-app-shell brand="Codify" [tabs]="tabs" />
    <cdf-reward-overlays />
  `,
})
export class ShellPage implements OnInit {
  protected readonly tabs = TABS;
  private readonly orchestrator = inject(RewardOrchestrator);

  ngOnInit(): void {
    this.orchestrator.reconcile({
      totalXp: 1750,
      coins: 320,
      streakDays: 12,
      freezesAvailable: 2,
    });
  }
}
