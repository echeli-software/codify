import { Component, inject, OnInit } from '@angular/core';
import { AppShell, type ShellTab } from '@codify/ui-ionic';
import { RewardOrchestrator } from '@codify/gamification-engine';
import { RewardOverlays } from '../reward-overlays.component.js';
import { IdentityCacheService } from '../offline/identity-cache.service.js';
import { OfflineIndicator } from '../offline/offline-indicator.component.js';
import { OfflineSyncService } from '../offline/offline-sync.service.js';

const TABS: ShellTab[] = [
  { path: 'today', label: 'Today', icon: 'home' },
  { path: 'catalog', label: 'Catalog', icon: 'school' },
  { path: 'league', label: 'League', icon: 'podium' },
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
  imports: [AppShell, RewardOverlays, OfflineIndicator],
  template: `
    <cdf-app-shell brand="Codify" [tabs]="tabs" />
    <cdf-offline-indicator />
    <cdf-reward-overlays />
  `,
})
export class ShellPage implements OnInit {
  protected readonly tabs = TABS;
  private readonly orchestrator = inject(RewardOrchestrator);
  private readonly identity = inject(IdentityCacheService);
  // Inject to instantiate so its constructor effect arms the auto-flush.
  protected readonly sync = inject(OfflineSyncService);

  async ngOnInit(): Promise<void> {
    // Cache /me into IndexedDB so the future offline-boot path
    // (per /docs/16-offline §4) has the data ready. Fire-and-forget;
    // failures fall back to the existing in-memory AuthService.
    const cached = await this.identity.prime();
    this.orchestrator.reconcile({
      totalXp: cached?.totalXp ?? 0,
      coins: cached?.coins ?? 0,
      streakDays: 12,
      freezesAvailable: 2,
    });
  }
}
