import {
  Component,
  ChangeDetectionStrategy,
  computed,
  input,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { IonItem, IonLabel, IonNote } from '@ionic/angular/standalone';
import { Icon, type IconName } from '../../atoms/icon/icon.js';
import { AppBadge } from '../../atoms/app-badge/app-badge.js';

export type LessonItemType =
  | 'reading'
  | 'quiz'
  | 'exercise'
  | 'ai-prompt'
  | 'scenario'
  | 'capstone';
export type LessonItemStatus =
  | 'not-started'
  | 'in-progress'
  | 'completed'
  | 'locked';

const TYPE_ICON: Record<LessonItemType, IconName> = {
  reading: 'school-outline',
  quiz: 'help-circle',
  exercise: 'chip',
  'ai-prompt': 'sparkles',
  scenario: 'chat-ellipses',
  capstone: 'trophy',
};

const STATUS_ICON: Record<LessonItemStatus, IconName | null> = {
  'not-started': null,
  'in-progress': 'hourglass',
  completed: 'check-circle',
  locked: 'shield',
};

/**
 * Row in a course curriculum / lesson list. Shows lesson type icon, title,
 * subtitle (e.g. "Lesson 4 of 12"), free-flag badge, status icon (locked
 * for paywalled, hourglass for in-progress, check for done), and optional
 * trailing note (e.g. "5 min" estimate).
 */
@Component({
  selector: 'cdf-lesson-item',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IonItem, IonLabel, IonNote, RouterLink, Icon, AppBadge],
  template: `
    <ion-item
      [button]="!locked()"
      [detail]="!locked()"
      [disabled]="locked()"
      [routerLink]="locked() ? null : routerLink()"
    >
      <cdf-icon slot="start" [name]="leadingIcon()" size="md" />
      <ion-label>
        <h3>{{ title() }}</h3>
        @if (subtitle()) {
          <p>{{ subtitle() }}</p>
        }
        @if (isFree()) {
          <cdf-app-badge variant="success" [subtle]="true"
            >Free preview</cdf-app-badge
          >
        }
      </ion-label>
      @if (statusIcon(); as si) {
        <cdf-icon slot="end" [name]="si" size="sm" [label]="statusLabel()" />
      }
      @if (estimateMinutes(); as min) {
        <ion-note slot="end">{{ min }} min</ion-note>
      }
    </ion-item>
  `,
  styleUrl: './lesson-item.scss',
})
export class LessonItem {
  readonly title = input.required<string>();
  readonly subtitle = input<string | null>(null);
  readonly type = input<LessonItemType>('reading');
  readonly status = input<LessonItemStatus>('not-started');
  readonly isFree = input(false);
  readonly estimateMinutes = input<number | null>(null);
  readonly routerLink = input<unknown[] | string | null>(null);

  protected readonly leadingIcon = computed<IconName>(
    () => TYPE_ICON[this.type()],
  );
  protected readonly statusIcon = computed(() => STATUS_ICON[this.status()]);
  protected readonly locked = computed(() => this.status() === 'locked');
  protected readonly statusLabel = computed(() =>
    this.status().replace('-', ' '),
  );
}
