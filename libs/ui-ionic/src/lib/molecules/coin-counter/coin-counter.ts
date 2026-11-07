import {
  Component,
  ChangeDetectionStrategy,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { I18nService, TranslatePipe } from '@codify/i18n';
import { formatCoins, formatCompact } from '@codify/ui-core';

function prefersReducedMotion(): boolean {
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
 * Header coin counter. Rolls the number from the previous value to the new
 * one (ease-out, ~600ms; instant under reduced motion), "bumps" on gains,
 * and announces the settled total politely to screen readers.
 *
 * It is the landing target for the reward coin-fly: put the engine's
 * `cdfCoinTarget` directive on it and bind the engine's displayed value —
 * the `RewardOrchestrator` remains the only thing that changes balances.
 *
 *   <cdf-coin-counter cdfCoinTarget [value]="coins.displayed()" />
 */
@Component({
  selector: 'cdf-coin-counter',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe],
  host: {
    '[attr.data-bump]': 'bumping() ? "" : null',
    '[attr.data-size]': 'size()',
  },
  template: `
    <span
      class="cdf-coin-counter"
      role="img"
      [attr.aria-label]="'ui.coins.total' | translate: { count: value() }"
    >
      <span class="cdf-coin-counter__icon" aria-hidden="true"></span>
      <span class="cdf-coin-counter__value" aria-hidden="true">{{
        formatted()
      }}</span>
    </span>
    <span class="cdf-coin-counter__live" aria-live="polite">{{
      announced()
    }}</span>
  `,
  styleUrl: './coin-counter.scss',
})
export class CoinCounter {
  private readonly i18n = inject(I18nService);

  /** Target balance; changes animate from the previously shown value. */
  readonly value = input.required<number>();
  /** Animate value changes (false = always snap). */
  readonly animate = input(true);
  readonly durationMs = input(600);
  readonly compact = input(false);
  readonly size = input<'sm' | 'md' | 'lg'>('md');

  protected readonly shown = signal(0);
  protected readonly bumping = signal(false);
  /** Updated after the roll settles so screen readers hear one total. */
  protected readonly announced = signal('');
  private frame: number | null = null;
  private bumpTimer: ReturnType<typeof setTimeout> | null = null;
  private first = true;

  protected readonly formatted = computed(() => {
    const locale = this.i18n.currentLocale();
    const v = this.shown();
    return this.compact() ? formatCompact(v, locale) : formatCoins(v, locale);
  });

  constructor() {
    effect(() => {
      const target = Math.max(0, Math.round(this.value()));
      untracked(() => this.roll(target));
    });
    inject(DestroyRef).onDestroy(() => {
      if (this.frame !== null && typeof cancelAnimationFrame === 'function')
        cancelAnimationFrame(this.frame);
      if (this.bumpTimer) clearTimeout(this.bumpTimer);
    });
  }

  private roll(target: number): void {
    const from = this.shown();
    if (this.frame !== null && typeof cancelAnimationFrame === 'function')
      cancelAnimationFrame(this.frame);
    const instant =
      this.first ||
      !this.animate() ||
      prefersReducedMotion() ||
      typeof requestAnimationFrame !== 'function' ||
      from === target;
    this.first = false;
    if (target > from && !instant) this.bump();
    if (instant) {
      this.shown.set(target);
      this.announce(target);
      return;
    }
    const t0 = performance.now();
    const dur = Math.max(1, this.durationMs());
    const tick = () => {
      const t = Math.min(1, (performance.now() - t0) / dur);
      const eased = 1 - Math.pow(1 - t, 4);
      this.shown.set(Math.round(from + (target - from) * eased));
      if (t < 1) this.frame = requestAnimationFrame(tick);
      else {
        this.frame = null;
        this.announce(target);
      }
    };
    this.frame = requestAnimationFrame(tick);
  }

  private bump(): void {
    this.bumping.set(true);
    if (this.bumpTimer) clearTimeout(this.bumpTimer);
    this.bumpTimer = setTimeout(() => this.bumping.set(false), 450);
  }

  private announce(v: number): void {
    this.announced.set(this.i18n.t('ui.coins.total', { count: v }));
  }
}
