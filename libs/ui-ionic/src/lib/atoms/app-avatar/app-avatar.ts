import { Component, ChangeDetectionStrategy, computed, input } from '@angular/core';
import { IonAvatar } from '@ionic/angular/standalone';

export type AppAvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

/**
 * Generic avatar with image-or-initials fallback. Used for user thumbnails
 * across the student app (friends, leaderboard, profile previews). The
 * richer Codify "2D character" used for the dressing-room shop ships in
 * Phase 8 as `AvatarRenderer`.
 */
@Component({
  selector: 'cdf-app-avatar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IonAvatar],
  host: { '[attr.data-size]': 'size()' },
  template: `
    <ion-avatar [style.background]="background()">
      @if (src(); as imgSrc) {
      <img [src]="imgSrc" [alt]="name() || ''" />
      } @else {
      <span class="cdf-avatar__initials" aria-hidden="true">{{ initials() }}</span>
      <span class="visually-hidden">{{ name() }}</span>
      }
    </ion-avatar>
  `,
  styleUrl: './app-avatar.scss',
})
export class AppAvatar {
  readonly src = input<string | null>(null);
  readonly name = input('');
  readonly size = input<AppAvatarSize>('md');

  protected readonly initials = computed(() => {
    const n = this.name().trim();
    if (!n) return '?';
    const parts = n.split(/\s+/);
    if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
    return ((parts[0]?.[0] ?? '') + (parts[parts.length - 1]?.[0] ?? '')).toUpperCase();
  });

  protected readonly background = computed(() => {
    if (this.src()) return null;
    const n = this.name();
    let hash = 0;
    for (let i = 0; i < n.length; i++) hash = (hash * 31 + n.charCodeAt(i)) >>> 0;
    const hue = hash % 360;
    return `hsl(${hue} 70% 88%)`;
  });
}
