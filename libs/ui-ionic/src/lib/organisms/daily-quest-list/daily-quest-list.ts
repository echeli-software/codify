import { Component, ChangeDetectionStrategy, input } from '@angular/core';
import { TranslatePipe } from '@codify/i18n';
import { IonList, IonItem, IonLabel } from '@ionic/angular/standalone';
import { Icon, type IconName } from '../../atoms/icon/icon.js';
import { CoinBadge } from '../../atoms/coin-badge/coin-badge.js';
import { XpBadge } from '../../atoms/xp-badge/xp-badge.js';
import { AppProgressBar } from '../../atoms/app-progress-bar/app-progress-bar.js';

export type DailyQuestKind =
  | 'lesson-count'
  | 'category-lesson-count'
  | 'xp-amount'
  | 'streak-maintain'
  | 'exercise-pass';

export interface DailyQuest {
  id: string;
  title: string;
  /** Current progress count toward the target. */
  progress: number;
  target: number;
  /** XP rewarded on completion. 0 = no XP. */
  xpReward: number;
  /** Coins rewarded on completion. */
  coinReward: number;
  kind: DailyQuestKind;
  completed?: boolean;
}

const KIND_ICON: Record<DailyQuestKind, IconName> = {
  'lesson-count': 'school-outline',
  'category-lesson-count': 'school',
  'xp-amount': 'sparkles',
  'streak-maintain': 'flame',
  'exercise-pass': 'chip',
};

/**
 * The day's three quests rendered as a list. Each row shows the quest
 * icon, title, inline progress bar with N/M, and the reward stack on the
 * trailing slot. Completed quests get a check icon and muted styling.
 *
 *   <cdf-daily-quest-list [quests]="quests()" />
 *
 * Quest assignment lives on the server (docs/07-gamification §8); this
 * organism is pure presentation.
 */
@Component({
  selector: 'cdf-daily-quest-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    IonList,
    IonItem,
    IonLabel,
    Icon,
    CoinBadge,
    XpBadge,
    AppProgressBar,
    TranslatePipe,
  ],
  template: `
    <ion-list inset="true">
      @for (quest of quests(); track quest.id) {
        <ion-item class="cdf-quest" [class.cdf-quest--done]="quest.completed">
          <cdf-icon
            slot="start"
            [name]="quest.completed ? 'check-circle' : iconFor(quest.kind)"
            size="md"
          />
          <ion-label>
            <h3>{{ quest.title }}</h3>
            <p class="cdf-quest__progress-row">
              <span class="cdf-quest__count"
                >{{ quest.progress }} / {{ quest.target }}</span
              >
            </p>
            <cdf-app-progress-bar
              [value]="pct(quest)"
              [variant]="quest.completed ? 'success' : 'primary'"
              size="sm"
              [label]="'ui.quests.progress' | translate: { title: quest.title }"
            />
          </ion-label>
          <div slot="end" class="cdf-quest__rewards">
            @if (quest.xpReward > 0) {
              <cdf-xp-badge
                [value]="quest.xpReward"
                size="sm"
                [showLabel]="false"
              />
            }
            <cdf-coin-badge [value]="quest.coinReward" size="sm" />
          </div>
        </ion-item>
      }
    </ion-list>
  `,
  styleUrl: './daily-quest-list.scss',
})
export class DailyQuestList {
  readonly quests = input.required<DailyQuest[]>();

  protected iconFor(kind: DailyQuestKind): IconName {
    return KIND_ICON[kind];
  }

  protected pct(q: DailyQuest): number {
    if (q.target <= 0) return q.completed ? 100 : 0;
    const v = (q.progress / q.target) * 100;
    return Math.max(0, Math.min(100, v));
  }
}
