import {
  Component,
  ChangeDetectionStrategy,
  computed,
  inject,
  input,
} from '@angular/core';
import { I18nService } from '@codify/i18n';
import {
  formatXp,
  levelFromXp,
  levelProgressPct,
  xpForLevel,
  xpToNextLevel,
} from '@codify/ui-core';
import { AppProgressBar } from '../../atoms/app-progress-bar/app-progress-bar.js';
import { LevelBadge } from '../level-badge/level-badge.js';

/**
 * Level + XP-progress widget. Pass total XP; the rest is computed.
 *
 *   <cdf-xp-bar [xp]="user.xpTotal" />
 *
 * Renders: [LevelBadge L]  [progress bar]  "1750 / 2000 XP"
 *
 * Compact mode hides the numeric label (used in tight spots like the
 * AppShell topbar).
 */
@Component({
  selector: 'cdf-xp-bar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AppProgressBar, LevelBadge],
  host: { '[attr.data-compact]': 'compact() ? "" : null' },
  template: `
    <cdf-level-badge [level]="level()" [size]="badgeSize()" />
    <div class="cdf-xp-bar__main">
      @if (!compact()) {
      <div class="cdf-xp-bar__row">
        <span class="cdf-xp-bar__current">{{ formattedCurrent() }}</span>
        <span class="cdf-xp-bar__sep">/</span>
        <span class="cdf-xp-bar__next">{{ formattedNext() }}</span>
        <span class="cdf-xp-bar__unit">XP</span>
      </div>
      }
      <cdf-app-progress-bar [value]="progressPct()" variant="xp" size="md" label="XP toward next level" />
    </div>
  `,
  styleUrl: './xp-bar.scss',
})
export class XpBar {
  readonly xp = input.required<number>();
  readonly compact = input(false);

  private readonly i18n = inject(I18nService);

  protected readonly level = computed(() => levelFromXp(this.xp()));
  protected readonly progressPct = computed(() => levelProgressPct(this.xp()));
  protected readonly remaining = computed(() => xpToNextLevel(this.xp()));
  protected readonly nextThreshold = computed(() => xpForLevel(this.level() + 1));

  protected readonly formattedCurrent = computed(() =>
    formatXp(this.xp(), this.i18n.currentLocale()),
  );
  protected readonly formattedNext = computed(() =>
    formatXp(this.nextThreshold(), this.i18n.currentLocale()),
  );

  protected readonly badgeSize = computed<'sm' | 'md'>(() =>
    this.compact() ? 'sm' : 'md',
  );
}
