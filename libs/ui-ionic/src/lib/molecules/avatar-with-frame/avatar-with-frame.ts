import { Component, ChangeDetectionStrategy, input } from '@angular/core';
import { AppAvatar, type AppAvatarSize } from '../../atoms/app-avatar/app-avatar.js';
import { LevelBadge } from '../level-badge/level-badge.js';

/**
 * Avatar with optional decorative frame and corner level badge. Used in
 * the AppShell topbar, Today header, profile, and friend cards.
 *
 *   <cdf-avatar-with-frame name="Maria Souza" [level]="14" size="lg" />
 *
 * The Phase 8 dressing-room AvatarRenderer (with composited SVG sprite
 * stack for clothes/pets/etc.) ships later — this molecule is the
 * placeholder shape for now.
 */
@Component({
  selector: 'cdf-avatar-with-frame',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AppAvatar, LevelBadge],
  host: { '[attr.data-size]': 'size()' },
  template: `
    <span class="cdf-avatar-frame">
      <cdf-app-avatar [name]="name()" [src]="src()" [size]="size()" />
      @if (level() !== null) {
      <span class="cdf-avatar-frame__level">
        <cdf-level-badge [level]="level()!" [size]="badgeSize()" />
      </span>
      }
    </span>
  `,
  styleUrl: './avatar-with-frame.scss',
})
export class AvatarWithFrame {
  readonly name = input.required<string>();
  readonly src = input<string | null>(null);
  readonly size = input<AppAvatarSize>('md');
  /** Optional level — when null the badge corner is hidden. */
  readonly level = input<number | null>(null);

  protected badgeSize(): 'sm' | 'md' {
    const s = this.size();
    return s === 'xs' || s === 'sm' || s === 'md' ? 'sm' : 'md';
  }
}
