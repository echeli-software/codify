import { Component, ChangeDetectionStrategy, computed, input } from '@angular/core';

export type AvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

/**
 * Generic avatar with image-or-initials fallback. Used for user thumbnails
 * across the admin app; the rich Codify "2D character" used in the student
 * app comes later as `AvatarRenderer` in the shared visuals.
 */
@Component({
  selector: 'cdf-avatar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="cdf-avatar" [class]="cssClass()" [style.background]="background()">
      @if (src(); as imgSrc) {
      <img class="cdf-avatar__img" [src]="imgSrc" [alt]="name() || ''" />
      } @else {
      <span class="cdf-avatar__initials" aria-hidden="true">{{ initials() }}</span>
      <span class="visually-hidden">{{ name() }}</span>
      }
    </span>
  `,
  styleUrl: './avatar.scss',
})
export class Avatar {
  readonly src = input<string | null>(null);
  readonly name = input('');
  readonly size = input<AvatarSize>('md');

  protected readonly initials = computed(() => {
    const n = this.name().trim();
    if (!n) return '?';
    const parts = n.split(/\s+/);
    if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
    return ((parts[0]?.[0] ?? '') + (parts[parts.length - 1]?.[0] ?? '')).toUpperCase();
  });

  protected readonly cssClass = computed(() => `cdf-avatar--${this.size()}`);

  /** Stable hue derived from the name so each user gets a consistent color. */
  protected readonly background = computed(() => {
    if (this.src()) return null;
    const n = this.name();
    let hash = 0;
    for (let i = 0; i < n.length; i++) hash = (hash * 31 + n.charCodeAt(i)) >>> 0;
    const hue = hash % 360;
    return `hsl(${hue} 70% 88%)`;
  });
}
