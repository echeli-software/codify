import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { LocalePipe, TranslatePipe } from '@codify/i18n';
import { Icon } from '@codify/ui-ionic';

/**
 * "Offline · saved 2 h ago" — marks a screen rendered from the last cached
 * response (docs/16 §3, §10 offline indicator).
 *
 *   <cdf-cached-data-chip [savedAt]="fromCache()" />
 */
@Component({
  selector: 'cdf-cached-data-chip',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, LocalePipe, TranslatePipe],
  template: `
    @if (savedAt(); as at) {
      <p class="chip" role="status" data-testid="cached-data-chip">
        <cdf-icon name="cloud-offline" size="xs" />
        <span>{{
          'studentPlatform.offline.cachedData'
            | translate: { when: (at | locale: 'relative') }
        }}</span>
      </p>
    }
  `,
  styles: [
    `
      .chip {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        margin: 0 0 var(--cdf-space-2, 8px);
        padding: 4px 10px;
        border-radius: 999px;
        font-size: var(--cdf-font-size-xs, 12px);
        color: var(--cdf-color-text-muted);
        background: var(--cdf-color-surface-2, rgba(0, 0, 0, 0.05));
      }
    `,
  ],
})
export class CachedDataChip {
  /** Epoch ms the shown data was saved; null hides the chip. */
  readonly savedAt = input<number | null>(null);
}
