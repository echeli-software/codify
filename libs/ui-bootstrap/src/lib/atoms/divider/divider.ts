import { Component, ChangeDetectionStrategy, computed, input } from '@angular/core';

@Component({
  selector: 'cdf-divider',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (label()) {
    <span class="cdf-divider" [class]="cssClass()" role="separator">
      <span class="cdf-divider__line"></span>
      <span class="cdf-divider__label">{{ label() }}</span>
      <span class="cdf-divider__line"></span>
    </span>
    } @else {
    <hr class="cdf-divider" [class]="cssClass()" />
    }
  `,
  styleUrl: './divider.scss',
})
export class Divider {
  readonly orientation = input<'horizontal' | 'vertical'>('horizontal');
  readonly label = input<string | null>(null);
  readonly inset = input(false);

  protected readonly cssClass = computed(() => {
    const cls = [`cdf-divider--${this.orientation()}`];
    if (this.label()) cls.push('cdf-divider--with-label');
    if (this.inset()) cls.push('cdf-divider--inset');
    return cls.join(' ');
  });
}
