import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import {
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
} from '@ionic/angular/standalone';
import {
  AppBadge,
  AppCard,
  AppSkeleton,
  EmptyState,
} from '@codify/ui-ionic';
import { LeaguesClient, type CurrentLeague, type LeagueMember } from '@codify/api-client';

const TIER_EMOJI: Record<string, string> = {
  BRONZE: '🥉', SILVER: '🥈', GOLD: '🥇', PLATINUM: '💠', DIAMOND: '💎',
};

/**
 * Weekly league — cohort leaderboard with promotion/demotion zones, the
 * caller's rank, and a live countdown to the Sunday reset (docs/07 §9).
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IonHeader, IonToolbar, IonTitle, IonContent, AppBadge, AppCard, AppSkeleton, EmptyState],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-title>League</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content class="ion-padding">
      @if (loading()) {
      <cdf-app-skeleton shape="rect" />
      } @else if (league(); as lg) {
      <cdf-app-card padding="normal" class="hero" data-testid="league-hero">
        <div class="hero__tier">{{ tierEmoji(lg.tier) }}</div>
        <div>
          <h2>{{ titleCase(lg.tier) }} League</h2>
          <p class="muted" data-testid="league-reset">Resets in {{ countdown() }}</p>
        </div>
        <div class="hero__rank">
          <span class="hero__rank-num" data-testid="my-rank">#{{ lg.myRank }}</span>
          <span class="muted">{{ lg.myWeeklyXp }} XP</span>
        </div>
      </cdf-app-card>

      <p class="legend">
        <span class="dot dot--up"></span> Top {{ lg.promoteCount }} promote
        <span class="dot dot--down"></span> Bottom {{ lg.demoteCount }} demote
      </p>

      <div class="board" data-testid="leaderboard">
        @for (m of lg.members; track m.userId) {
        <button
          class="row"
          [class.row--me]="m.isMe"
          [class.row--up]="zone(m, lg) === 'up'"
          [class.row--down]="zone(m, lg) === 'down'"
          [attr.data-user-id]="m.userId"
          [attr.data-rank]="m.rank"
          (click)="openProfile(m.userId)"
        >
          <span class="row__rank">{{ m.rank }}</span>
          <span class="row__name">{{ m.displayName }}@if (m.isMe) { <em>(you)</em> }</span>
          <cdf-app-badge variant="neutral" [subtle]="true">Lv {{ m.level }}</cdf-app-badge>
          <span class="row__xp">{{ m.weeklyXp }} XP</span>
        </button>
        }
      </div>
      } @else {
      <cdf-empty-state icon="podium" title="No league yet" description="Earn some XP to join this week's cohort." />
      }
    </ion-content>
  `,
  styles: [
    `
      .hero { display: flex; align-items: center; gap: var(--cdf-space-3); }
      .hero__tier { font-size: 40px; }
      .hero h2 { margin: 0; }
      .hero__rank { margin-left: auto; text-align: right; display: flex; flex-direction: column; }
      .hero__rank-num { font-size: 24px; font-weight: 800; }
      .muted { color: var(--cdf-color-text-muted); font-size: 13px; margin: 2px 0 0; }
      .legend { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--cdf-color-text-muted); margin: var(--cdf-space-3) 0 var(--cdf-space-2); flex-wrap: wrap; }
      .dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; margin-left: var(--cdf-space-2); }
      .dot--up { background: #2e9e5b; }
      .dot--down { background: #d0454c; }
      .board { display: flex; flex-direction: column; gap: 4px; }
      .row { display: flex; align-items: center; gap: var(--cdf-space-2); width: 100%; text-align: left; padding: 10px var(--cdf-space-2); border: none; border-left: 3px solid transparent; border-radius: 8px; background: var(--cdf-color-surface, #fff); }
      .row--up { border-left-color: #2e9e5b; }
      .row--down { border-left-color: #d0454c; }
      .row--me { background: var(--cdf-color-surface-2, #eef3ff); font-weight: 700; }
      .row__rank { width: 28px; font-weight: 700; color: var(--cdf-color-text-muted); }
      .row__name { flex: 1; } .row__name em { color: var(--cdf-color-text-muted); font-weight: 400; }
      .row__xp { font-weight: 600; }
    `,
  ],
})
export class LeaguePage {
  private readonly client = inject(LeaguesClient);
  private readonly router = inject(Router);

  protected readonly loading = signal(true);
  protected readonly league = signal<CurrentLeague | null>(null);
  protected readonly now = signal(Date.now());

  protected readonly countdown = computed(() => {
    const lg = this.league();
    if (!lg) return '—';
    const ms = Math.max(0, new Date(lg.resetAt).getTime() - this.now());
    const d = Math.floor(ms / 86_400_000);
    const h = Math.floor((ms % 86_400_000) / 3_600_000);
    const m = Math.floor((ms % 3_600_000) / 60_000);
    return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`;
  });

  constructor() {
    void this.load();
    const t = setInterval(() => this.now.set(Date.now()), 1000);
    inject(DestroyRef).onDestroy(() => clearInterval(t));
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      this.league.set(await this.client.currentLeague());
    } catch {
      this.league.set(null);
    } finally {
      this.loading.set(false);
    }
  }

  protected zone(m: LeagueMember, lg: CurrentLeague): 'up' | 'down' | 'hold' {
    if (m.rank <= lg.promoteCount && lg.tier !== 'DIAMOND') return 'up';
    if (m.rank > lg.cohortSize - lg.demoteCount && lg.tier !== 'BRONZE') return 'down';
    return 'hold';
  }
  protected tierEmoji(tier: string): string {
    return TIER_EMOJI[tier] ?? '🏅';
  }
  protected titleCase(s: string): string {
    return s.charAt(0) + s.slice(1).toLowerCase();
  }
  protected openProfile(userId: string): void {
    void this.router.navigate(['/u', userId]);
  }
}
