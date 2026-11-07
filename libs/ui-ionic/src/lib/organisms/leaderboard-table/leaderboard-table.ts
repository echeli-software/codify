import {
  Component,
  ChangeDetectionStrategy,
  Directive,
  TemplateRef,
  computed,
  contentChild,
  inject,
  input,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { ScrollingModule } from '@angular/cdk/scrolling';
import { I18nService, TranslatePipe } from '@codify/i18n';
import { formatXp } from '@codify/ui-core';
import { Icon } from '../../atoms/icon/icon.js';
import { LevelBadge } from '../../molecules/level-badge/level-badge.js';

export interface LeaderboardRow {
  userId: string;
  displayName: string;
  weeklyXp: number;
  level: number;
  rank: number;
  isMe: boolean;
}

export type LeaderboardZone = 'promote' | 'safe' | 'demote';

/** Zone for a 1-based rank (mirrors gamification-engine `zoneForRank`). */
export function leaderboardZone(
  rank: number,
  size: number,
  promoteCount: number,
  demoteCount: number,
): LeaderboardZone {
  if (rank >= 1 && rank <= promoteCount) return 'promote';
  if (demoteCount > 0 && rank > size - demoteCount) return 'demote';
  return 'safe';
}

/**
 * Optional avatar slot:
 *   <cdf-leaderboard-table [rows]="rows">
 *     <ng-template cdfLeaderboardAvatar let-row>
 *       <cdf-app-avatar [name]="row.displayName" size="sm" />
 *     </ng-template>
 *   </cdf-leaderboard-table>
 */
@Directive({ selector: 'ng-template[cdfLeaderboardAvatar]' })
export class LeaderboardAvatar {
  readonly template =
    inject<TemplateRef<{ $implicit: LeaderboardRow }>>(TemplateRef);
}

/**
 * Weekly league standings (docs/07 §9). Virtualized with CDK virtual
 * scrolling so 30-person cohorts and full global boards stay cheap; the
 * current user is highlighted and, when scrolled out of view, pinned in a
 * footer row. Promotion / demotion zones are marked with a label + icon
 * (not colour alone).
 */
@Component({
  selector: 'cdf-leaderboard-table',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ScrollingModule, NgTemplateOutlet, Icon, LevelBadge, TranslatePipe],
  template: `
    <section
      class="cdf-board"
      [attr.aria-label]="title() ?? ('ui.leaderboard.title' | translate)"
    >
      <cdk-virtual-scroll-viewport
        class="cdf-board__viewport"
        [itemSize]="rowHeight()"
        [style.height.px]="viewportHeight()"
        [minBufferPx]="rowHeight() * 4"
        [maxBufferPx]="rowHeight() * 8"
        tabindex="0"
        role="list"
        [attr.aria-label]="
          'ui.leaderboard.rows' | translate: { count: sorted().length }
        "
      >
        <div
          *cdkVirtualFor="
            let row of sorted();
            trackBy: trackRow;
            templateCacheSize: 0
          "
          class="cdf-board__row"
          role="listitem"
          [attr.aria-posinset]="row.rank"
          [attr.aria-setsize]="sorted().length"
          [attr.aria-current]="row.isMe ? 'true' : null"
          [attr.data-zone]="zoneOf(row)"
          [class.cdf-board__row--me]="row.isMe"
          [style.height.px]="rowHeight()"
        >
          <ng-container
            *ngTemplateOutlet="rowTpl; context: { $implicit: row }"
          />
        </div>
      </cdk-virtual-scroll-viewport>

      @if (pinnedMe(); as me) {
        <div class="cdf-board__pinned" [attr.data-zone]="zoneOf(me)">
          <span class="cdf-board__pinned-label">{{
            'ui.leaderboard.you' | translate
          }}</span>
          <div
            class="cdf-board__row cdf-board__row--me"
            [style.height.px]="rowHeight()"
          >
            <ng-container
              *ngTemplateOutlet="rowTpl; context: { $implicit: me }"
            />
          </div>
        </div>
      }
    </section>

    <ng-template #rowTpl let-row>
      <span class="cdf-board__rank">{{ row.rank }}</span>
      @if (avatarTpl(); as tpl) {
        <span class="cdf-board__avatar">
          <ng-container
            *ngTemplateOutlet="tpl.template; context: { $implicit: row }"
          />
        </span>
      }
      <span class="cdf-board__name">
        {{ row.displayName }}
        @if (row.isMe) {
          <span class="cdf-board__me-tag"
            >({{ 'ui.leaderboard.youShort' | translate }})</span
          >
        }
      </span>
      <cdf-level-badge [level]="row.level" size="sm" />
      <span class="cdf-board__xp">{{
        'gamification.xp.earned' | translate: { value: fmtXp(row.weeklyXp) }
      }}</span>
      @switch (zoneOf(row)) {
        @case ('promote') {
          <span class="cdf-board__zone cdf-board__zone--promote">
            <cdf-icon name="chevron-up" size="xs" />
            <span class="cdf-board__zone-text">{{
              'ui.leaderboard.promote' | translate
            }}</span>
          </span>
        }
        @case ('demote') {
          <span class="cdf-board__zone cdf-board__zone--demote">
            <cdf-icon name="chevron-down" size="xs" />
            <span class="cdf-board__zone-text">{{
              'ui.leaderboard.demote' | translate
            }}</span>
          </span>
        }
      }
    </ng-template>
  `,
  styleUrl: './leaderboard-table.scss',
})
export class LeaderboardTable {
  private readonly i18n = inject(I18nService);

  readonly rows = input.required<LeaderboardRow[]>();
  readonly promoteCount = input(0);
  readonly demoteCount = input(0);
  readonly title = input<string | null>(null);
  readonly rowHeight = input(56);
  /** Visible rows before scrolling. */
  readonly visibleRows = input(8);
  /** Pin the current user when they are outside the first `visibleRows`. */
  readonly pinMe = input(true);

  protected readonly avatarTpl = contentChild(LeaderboardAvatar);

  protected readonly sorted = computed(() =>
    [...this.rows()].sort((a, b) => a.rank - b.rank),
  );
  protected readonly viewportHeight = computed(
    () =>
      Math.min(this.sorted().length || 1, this.visibleRows()) *
      this.rowHeight(),
  );
  protected readonly pinnedMe = computed(() => {
    if (!this.pinMe()) return null;
    const list = this.sorted();
    const i = list.findIndex((r) => r.isMe);
    return i >= this.visibleRows() ? list[i] : null;
  });

  protected readonly trackRow = (_: number, row: LeaderboardRow) => row.userId;

  protected zoneOf(row: LeaderboardRow): LeaderboardZone {
    return leaderboardZone(
      row.rank,
      this.sorted().length,
      this.promoteCount(),
      this.demoteCount(),
    );
  }

  protected fmtXp(v: number): string {
    return formatXp(v, this.i18n.currentLocale());
  }
}
