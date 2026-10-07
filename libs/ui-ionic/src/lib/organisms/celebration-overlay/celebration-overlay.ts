import {
  Component,
  ChangeDetectionStrategy,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  output,
  untracked,
} from '@angular/core';
import { CdkTrapFocus } from '@angular/cdk/a11y';
import { TranslatePipe } from '@codify/i18n';
import { mulberry32 } from '@codify/ui-core';
import { AppButton } from '../../atoms/app-button/app-button.js';
import { CoinBadge } from '../../atoms/coin-badge/coin-badge.js';
import { Icon, type IconName } from '../../atoms/icon/icon.js';
import { XpBadge } from '../../atoms/xp-badge/xp-badge.js';

let celebrateSeq = 0;

export interface ConfettiPiece {
  left: number;
  delayMs: number;
  durationMs: number;
  rotate: number;
  hue: number;
  size: number;
}

/** Deterministic CSS-confetti layout for a seed (pure, unit-testable). */
export function confettiPieces(seed: number, count: number): ConfettiPiece[] {
  const rand = mulberry32(seed);
  return Array.from({ length: count }, () => ({
    left: Math.round(rand() * 1000) / 10,
    delayMs: Math.round(rand() * 600),
    durationMs: 1400 + Math.round(rand() * 900),
    rotate: Math.round((rand() - 0.5) * 720),
    hue: Math.round(rand() * 360),
    size: 6 + Math.round(rand() * 6),
  }));
}

function reducedMotion(): boolean {
  try {
    return (
      typeof matchMedia === 'function' &&
      matchMedia('(prefers-reduced-motion: reduce)').matches
    );
  } catch {
    return false;
  }
}

/**
 * Generic full-screen celebration (milestones, streaks, league promotion,
 * first lesson): title + message + optional XP/coin totals over a burst of
 * CSS confetti. Confetti is seeded (reproducible) and skipped entirely under
 * reduced motion. Sound / haptics stay with the RewardOrchestrator — this
 * is the visual layer only.
 *
 *   <cdf-celebration-overlay [open]="show()" [title]="'…' | translate" [xp]="240" (dismissed)="show.set(false)" />
 */
@Component({
  selector: 'cdf-celebration-overlay',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CdkTrapFocus, AppButton, CoinBadge, Icon, XpBadge, TranslatePipe],
  template: `
    @if (open()) {
      <div
        class="cdf-celebrate"
        role="dialog"
        aria-modal="true"
        [attr.aria-labelledby]="titleId"
        [attr.aria-describedby]="message() ? messageId : null"
        cdkTrapFocus
        [cdkTrapFocusAutoCapture]="true"
        (keydown.escape)="dismissed.emit()"
      >
        @if (!calm) {
          <div class="cdf-celebrate__confetti" aria-hidden="true">
            @for (p of pieces(); track $index) {
              <span
                class="cdf-celebrate__piece"
                [style.left.%]="p.left"
                [style.width.px]="p.size"
                [style.height.px]="p.size * 0.45"
                [style.background]="'hsl(' + p.hue + ' 85% 60%)'"
                [style.animation-delay.ms]="p.delayMs"
                [style.animation-duration.ms]="p.durationMs"
                [style.--rot]="p.rotate + 'deg'"
              ></span>
            }
          </div>
        }
        <div class="cdf-celebrate__card">
          <div class="cdf-celebrate__icon">
            <cdf-icon [name]="icon()" size="xl" />
          </div>
          <h2 class="cdf-celebrate__title" [id]="titleId">{{ title() }}</h2>
          @if (message(); as m) {
            <p class="cdf-celebrate__message" [id]="messageId">{{ m }}</p>
          }
          @if (xp() || coins()) {
            <div class="cdf-celebrate__totals">
              @if (xp(); as x) {
                <cdf-xp-badge [value]="x" tone="gain" size="lg" />
              }
              @if (coins(); as c) {
                <cdf-coin-badge
                  [value]="c"
                  tone="gain"
                  size="lg"
                  [showLabel]="true"
                />
              }
            </div>
          }
          <cdf-app-button
            kind="primary"
            size="lg"
            (buttonClick)="dismissed.emit()"
          >
            {{ ctaLabel() ?? ('common.continue' | translate) }}
          </cdf-app-button>
        </div>
      </div>
    }
  `,
  styleUrl: './celebration-overlay.scss',
})
export class CelebrationOverlay {
  readonly open = input.required<boolean>();
  readonly title = input.required<string>();
  readonly message = input<string | null>(null);
  readonly icon = input<IconName>('trophy');
  readonly xp = input<number | null>(null);
  readonly coins = input<number | null>(null);
  readonly ctaLabel = input<string | null>(null);
  /** Confetti seed — same seed, same burst. */
  readonly seed = input(1);
  readonly confettiCount = input(48);
  /** Auto-dismiss after N ms (0 = wait for the user). */
  readonly autoDismissMs = input(0);

  readonly dismissed = output<void>();

  protected readonly titleId = `cdf-celebrate-title-${++celebrateSeq}`;
  protected readonly messageId = `cdf-celebrate-msg-${celebrateSeq}`;
  protected readonly calm = reducedMotion();
  protected readonly pieces = computed(() =>
    confettiPieces(this.seed(), this.confettiCount()),
  );
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    effect(() => {
      const open = this.open();
      const ms = this.autoDismissMs();
      untracked(() => {
        if (this.timer) clearTimeout(this.timer);
        this.timer =
          open && ms > 0 ? setTimeout(() => this.dismissed.emit(), ms) : null;
      });
    });
    inject(DestroyRef).onDestroy(() => {
      if (this.timer) clearTimeout(this.timer);
    });
  }
}
