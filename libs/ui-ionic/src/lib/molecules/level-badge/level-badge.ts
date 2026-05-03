import {
  Component,
  ChangeDetectionStrategy,
  computed,
  input,
} from '@angular/core';
import { tierForLevel, type LevelTier } from '@codify/ui-core';

const TIER_CLASS: Record<LevelTier, string> = {
  BRONZE: 'tier-bronze',
  SILVER: 'tier-silver',
  GOLD: 'tier-gold',
  PLATINUM: 'tier-platinum',
  DIAMOND: 'tier-diamond',
  MYTHIC: 'tier-mythic',
  PRESTIGE: 'tier-prestige',
};

/**
 * Level number inside a tier-coloured ring. Used in the AppShell header,
 * profile pages, leaderboards, and as the inner element of AvatarWithFrame.
 *
 *   <cdf-level-badge [level]="user.level" size="md" />
 *
 * Tier colour is derived from `tierForLevel` — single source of truth from
 * docs/07-gamification.md §4.
 */
@Component({
  selector: 'cdf-level-badge',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[attr.data-size]': 'size()',
    '[attr.data-tier]': 'tierClass()',
  },
  template: `
    <span class="cdf-level-badge" role="img" [attr.aria-label]="ariaLabel()">
      <span class="cdf-level-badge__num">{{ level() }}</span>
    </span>
  `,
  styleUrl: './level-badge.scss',
})
export class LevelBadge {
  readonly level = input.required<number>();
  readonly size = input<'sm' | 'md' | 'lg' | 'xl'>('md');
  /** Override the auto-derived tier (rare; usually leave unset). */
  readonly tier = input<LevelTier | null>(null);

  protected readonly resolvedTier = computed<LevelTier>(
    () => this.tier() ?? tierForLevel(this.level()),
  );
  protected readonly tierClass = computed(() => TIER_CLASS[this.resolvedTier()]);
  protected readonly ariaLabel = computed(
    () => `Level ${this.level()}, ${this.resolvedTier().toLowerCase()} tier`,
  );
}
