import {
  Component,
  ChangeDetectionStrategy,
  computed,
  input,
} from '@angular/core';
import { IonSkeletonText } from '@ionic/angular/standalone';

export type AppSkeletonShape = 'rect' | 'text' | 'circle' | 'pill';

/**
 * Loading placeholder. Wraps <ion-skeleton-text animated="true"> with our
 * shape variants. Used in lesson lists, course cards, leaderboard rows
 * before data resolves. Animation slows under prefers-reduced-motion via
 * Ionic's built-in handling.
 */
@Component({
  selector: 'cdf-app-skeleton',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IonSkeletonText],
  host: { '[attr.data-shape]': 'shape()' },
  template: `<ion-skeleton-text [animated]="true" [style]="styleMap()" />`,
  styleUrl: './app-skeleton.scss',
})
export class AppSkeleton {
  readonly shape = input<AppSkeletonShape>('rect');
  readonly width = input<string | number>('100%');
  readonly height = input<string | number>('1em');

  protected readonly styleMap = computed(() => {
    const w = this.width();
    const h = this.height();
    return `width: ${typeof w === 'number' ? w + 'px' : w}; height: ${typeof h === 'number' ? h + 'px' : h};`;
  });
}
