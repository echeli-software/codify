import { Component, ChangeDetectionStrategy, computed, input } from '@angular/core';

export type SkeletonShape = 'rect' | 'text' | 'circle' | 'pill';

@Component({
  selector: 'cdf-skeleton',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<span class="cdf-skeleton" [class]="cssClass()" [style]="styleMap()" aria-hidden="true"></span>`,
  styleUrl: './skeleton.scss',
})
export class Skeleton {
  readonly shape = input<SkeletonShape>('rect');
  readonly width = input<string | number>('100%');
  readonly height = input<string | number>('1em');

  protected readonly cssClass = computed(() => `cdf-skeleton--${this.shape()}`);

  protected readonly styleMap = computed(() => {
    const w = this.width();
    const h = this.height();
    return `width: ${typeof w === 'number' ? w + 'px' : w}; height: ${
      typeof h === 'number' ? h + 'px' : h
    };`;
  });
}
