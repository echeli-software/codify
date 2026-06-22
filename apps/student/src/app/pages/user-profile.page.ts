import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  IonHeader,
  IonToolbar,
  IonTitle,
  IonButtons,
  IonBackButton,
  IonContent,
} from '@ionic/angular/standalone';
import {
  AppBadge,
  AppCard,
  AppSkeleton,
  AvatarRenderer,
  type AvatarSlot,
  type AvatarSprite,
  EmptyState,
  Icon,
} from '@codify/ui-ionic';
import { LeaguesClient, type PublicProfile } from '@codify/api-client';

/** Public profile page — avatar, badges, level, and stats for any user. */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IonHeader, IonToolbar, IonTitle, IonButtons, IonBackButton, IonContent, AppBadge, AppCard, AppSkeleton, AvatarRenderer, EmptyState, Icon],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start"><ion-back-button defaultHref="/league" /></ion-buttons>
        <ion-title>{{ profile()?.displayName ?? 'Profile' }}</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content class="ion-padding">
      @if (loading()) {
      <cdf-app-skeleton shape="rect" />
      } @else if (profile(); as p) {
      <div class="hero" data-testid="profile-hero">
        <cdf-avatar-renderer [config]="p.avatar.config" [equipped]="equippedSprites()" [size]="160" [showLevelRing]="true" [level]="p.level" />
        <h1>{{ p.displayName }}</h1>
        <cdf-app-badge variant="primary" [subtle]="true">{{ titleCase(p.tier) }} · Lv {{ p.level }}</cdf-app-badge>
      </div>

      <div class="stats" data-testid="profile-stats">
        <div class="stat"><span class="stat__n">{{ p.stats.lessonsCompleted }}</span><span class="stat__l">Lessons</span></div>
        <div class="stat"><span class="stat__n">{{ p.stats.streakDays }}</span><span class="stat__l">Streak</span></div>
        <div class="stat"><span class="stat__n">{{ p.stats.longestStreak }}</span><span class="stat__l">Best</span></div>
        <div class="stat"><span class="stat__n">{{ p.stats.friends }}</span><span class="stat__l">Friends</span></div>
      </div>

      <h3>Badges ({{ p.badges.length }})</h3>
      @if (p.badges.length === 0) {
      <p class="muted">No badges yet.</p>
      } @else {
      <div class="badges" data-testid="profile-badges">
        @for (b of p.badges; track b.slug) {
        <cdf-app-card padding="normal" class="badge">
          <cdf-icon name="trophy" size="md" />
          <span>{{ b.name }}</span>
        </cdf-app-card>
        }
      </div>
      }
      } @else {
      <cdf-empty-state icon="person" title="Profile not found" description="This user may not exist." />
      }
    </ion-content>
  `,
  styles: [
    `
      .hero { display: flex; flex-direction: column; align-items: center; gap: var(--cdf-space-2); margin-bottom: var(--cdf-space-4); }
      .hero h1 { margin: var(--cdf-space-2) 0 0; font-size: var(--cdf-font-size-xl); }
      .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: var(--cdf-space-2); margin-bottom: var(--cdf-space-4); }
      .stat { text-align: center; background: var(--cdf-color-surface-2, #eef1f6); border-radius: 12px; padding: var(--cdf-space-2); }
      .stat__n { display: block; font-size: 22px; font-weight: 800; }
      .stat__l { font-size: 12px; color: var(--cdf-color-text-muted); }
      .muted { color: var(--cdf-color-text-muted); }
      h3 { font-size: var(--cdf-font-size-md); margin: 0 0 var(--cdf-space-2); }
      .badges { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: var(--cdf-space-2); }
      .badge { display: flex; flex-direction: column; align-items: center; gap: 4px; text-align: center; }
    `,
  ],
})
export class UserProfilePage {
  private readonly route = inject(ActivatedRoute);
  private readonly client = inject(LeaguesClient);

  protected readonly loading = signal(true);
  protected readonly profile = signal<PublicProfile | null>(null);

  protected readonly equippedSprites = computed<Partial<Record<AvatarSlot, AvatarSprite>>>(() => {
    const out: Partial<Record<AvatarSlot, AvatarSprite>> = {};
    const eq = this.profile()?.avatar.equipped ?? {};
    for (const [slot, ref] of Object.entries(eq)) {
      out[slot as AvatarSlot] = { spriteAssetId: ref.spriteAssetId, name: ref.name };
    }
    return out;
  });

  constructor() {
    this.route.paramMap.pipe(takeUntilDestroyed()).subscribe((pm) => {
      const id = pm.get('id');
      if (id) void this.load(id);
    });
  }

  private async load(id: string): Promise<void> {
    this.loading.set(true);
    try {
      this.profile.set(await this.client.profile(id));
    } catch {
      this.profile.set(null);
    } finally {
      this.loading.set(false);
    }
  }

  protected titleCase(s: string): string {
    return s.charAt(0) + s.slice(1).toLowerCase();
  }
}
