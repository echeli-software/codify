import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NotificationsClient } from '@codify/api-client';
import {
  OverlayHostService,
  RewardOrchestrator,
  type RewardToastEvent,
} from '@codify/gamification-engine';
import { TranslatePipe } from '@codify/i18n';
import { AppButton, AppCheckbox, Icon } from '@codify/ui-ionic';
import { AppToastService } from '../platform/app-toast.service.js';
import { WebPushService } from '../platform/web-push.service.js';
import { REWARD_TOAST_MS } from '../reward-overlays.component.js';
import { TelemetryService } from '../telemetry/telemetry.service.js';

/** Reward kinds that mean "the learner just finished a lesson". */
const COMPLETION_KINDS = new Set([
  'lessonComplete',
  'quizPass',
  'exercisePass',
  'aiPromptComplete',
  'scenarioComplete',
]);

/** A finished lesson or the first day of a streak — a meaningful moment. */
export function isMeaningfulMoment(t: RewardToastEvent): boolean {
  return (
    t.kinds.some((k) => COMPLETION_KINDS.has(k)) || !!t.streakChange?.extended
  );
}

type Card = 'promo' | 'webPush';

/**
 * One-time, non-blocking engagement cards shown after a meaningful moment
 * (a completed lesson / the first streak day), once the reward toast is
 * gone — never on first load (docs/10 §3):
 *
 *   1. "Get alerts about bonus events?" — adults with a completed lesson
 *      who were never asked (the server decides: GET /me/promo-prompt).
 *      Yes turns on PROMO push; the tick box adds marketing email.
 *   2. "Turn on browser notifications?" — web only, when the browser
 *      supports web push and hasn't decided yet. The browser's own prompt
 *      only opens from the "Turn on" tap.
 *
 * At most one card at a time; neither traps focus or blocks the page.
 */
@Component({
  selector: 'cdf-engagement-prompts',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, AppButton, AppCheckbox, Icon, TranslatePipe],
  template: `
    @if (card(); as c) {
      <section
        class="ep"
        role="region"
        aria-labelledby="ep-title"
        [attr.data-testid]="c === 'promo' ? 'promo-prompt' : 'web-push-prompt'"
      >
        <button
          type="button"
          class="ep__close"
          [attr.aria-label]="
            'student.notifications.promoPrompt.close' | translate
          "
          (click)="c === 'promo' ? answerPromo(false) : notNow()"
        >
          <cdf-icon name="close" size="sm" />
        </button>
        <div class="ep__head">
          <cdf-icon
            [name]="c === 'promo' ? 'sparkles' : 'notifications'"
            size="md"
          />
          <h2 id="ep-title">
            {{
              (c === 'promo'
                ? 'student.notifications.promoPrompt.title'
                : 'student.notifications.webPush.promptTitle'
              ) | translate
            }}
          </h2>
        </div>
        <p class="ep__body">
          {{
            (c === 'promo'
              ? 'student.notifications.promoPrompt.body'
              : 'student.notifications.webPush.promptBody'
            ) | translate
          }}
        </p>
        @if (c === 'promo') {
          <cdf-app-checkbox
            name="promoEmail"
            data-testid="promo-prompt-email"
            [label]="'student.notifications.promoPrompt.email' | translate"
            [(ngModel)]="email"
          />
        }
        <div class="ep__actions">
          @if (c === 'promo') {
            <cdf-app-button
              kind="ghost"
              data-testid="promo-prompt-decline"
              [disabled]="busy()"
              (buttonClick)="answerPromo(false)"
            >
              {{ 'student.notifications.promoPrompt.decline' | translate }}
            </cdf-app-button>
            <cdf-app-button
              kind="primary"
              data-testid="promo-prompt-accept"
              [loading]="busy()"
              (buttonClick)="answerPromo(true)"
            >
              {{ 'student.notifications.promoPrompt.accept' | translate }}
            </cdf-app-button>
          } @else {
            <cdf-app-button
              kind="ghost"
              data-testid="web-push-not-now"
              [disabled]="busy()"
              (buttonClick)="notNow()"
            >
              {{ 'student.notifications.webPush.notNow' | translate }}
            </cdf-app-button>
            <cdf-app-button
              kind="primary"
              data-testid="web-push-turn-on"
              [loading]="busy()"
              (buttonClick)="turnOn()"
            >
              {{ 'student.notifications.webPush.turnOn' | translate }}
            </cdf-app-button>
          }
        </div>
      </section>
    }
  `,
  styles: [
    `
      .ep {
        position: fixed;
        left: 50%;
        transform: translateX(-50%);
        bottom: calc(72px + env(safe-area-inset-bottom, 0px));
        z-index: 999;
        width: min(420px, calc(100vw - 32px));
        box-sizing: border-box;
        background: var(--cdf-color-surface);
        color: var(--cdf-color-text);
        border: 1px solid var(--cdf-color-border);
        border-radius: 14px;
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.18);
        padding: 14px 40px 12px 16px;
      }
      @media (min-width: 992px) {
        .ep {
          left: auto;
          right: 24px;
          transform: none;
          bottom: 24px;
        }
      }
      .ep__head {
        display: flex;
        align-items: center;
        gap: 8px;
        color: var(--cdf-color-primary);
      }
      h2 {
        margin: 0;
        font-size: var(--cdf-font-size-md, 16px);
        line-height: 1.3;
        color: var(--cdf-color-text);
      }
      .ep__body {
        margin: 8px 0;
        font-size: var(--cdf-font-size-sm, 14px);
        line-height: 1.45;
        color: var(--cdf-color-text-muted);
      }
      .ep__actions {
        display: flex;
        justify-content: flex-end;
        flex-wrap: wrap;
        gap: 8px;
        margin-top: 8px;
      }
      .ep__close {
        position: absolute;
        top: 6px;
        right: 6px;
        background: none;
        border: 0;
        padding: 6px;
        color: var(--cdf-color-text-muted);
        cursor: pointer;
        border-radius: 8px;
      }
      .ep__close:focus-visible {
        outline: 2px solid var(--cdf-color-primary);
        outline-offset: 2px;
      }
    `,
  ],
})
export class EngagementPrompts {
  private readonly orchestrator = inject(RewardOrchestrator);
  private readonly overlays = inject(OverlayHostService);
  private readonly notifications = inject(NotificationsClient);
  private readonly webPush = inject(WebPushService);
  private readonly toast = inject(AppToastService);
  private readonly telemetry = inject(TelemetryService);

  protected readonly card = signal<Card | null>(null);
  protected readonly busy = signal(false);
  protected email = false;

  private lastToastId = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** The server said no (already asked / not eligible) this session. */
  private promoSettled = false;
  /** Web push card shown (or not offerable) this session. */
  private webPushSettled = false;

  constructor() {
    effect(() => {
      const t = this.orchestrator.toast();
      if (!t || t.id === this.lastToastId) return;
      this.lastToastId = t.id;
      if (isMeaningfulMoment(t)) untracked(() => this.schedule());
    });
    inject(DestroyRef).onDestroy(() => {
      if (this.timer) clearTimeout(this.timer);
    });
  }

  /** After the reward toast (and any celebration) has gone. */
  private schedule(delayMs = REWARD_TOAST_MS + 600, tries = 0): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      // Wait for a level-up / badge celebration to be dismissed first.
      if (this.overlays.current() && tries < 120) {
        this.schedule(1500, tries + 1);
        return;
      }
      void this.next();
    }, delayMs);
  }

  /** Show the next card that applies, if any. */
  private async next(): Promise<void> {
    if (this.card()) return;
    if (!this.promoSettled) {
      try {
        const state = await this.notifications.promoPrompt();
        if (state.show) {
          this.email = false;
          this.card.set('promo');
          this.telemetry.track('promo_prompt_shown');
          return;
        }
        this.promoSettled = true;
      } catch {
        // Offline / transient: ask again after the next lesson.
      }
    }
    if (!this.webPushSettled) {
      const offer = await this.webPush.canOffer().catch(() => false);
      this.webPushSettled = true;
      if (offer) {
        this.card.set('webPush');
        this.telemetry.track('web_push_prompt_shown');
      }
    }
  }

  protected async answerPromo(accept: boolean): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    const email = accept && this.email;
    try {
      await this.notifications.answerPromoPrompt({ push: accept, email });
      this.telemetry.track('promo_prompt_answered', { push: accept, email });
      this.toast.show({
        message: accept
          ? 'student.notifications.promoPrompt.saved'
          : 'student.notifications.promoPrompt.declined',
        kind: 'success',
      });
    } catch (err) {
      // 409: answered on another device; 403: not eligible — either way done.
      const status = (err as { status?: number }).status;
      if (status !== 409 && status !== 403) {
        this.toast.error(err);
        this.busy.set(false);
        return;
      }
    }
    this.promoSettled = true;
    this.busy.set(false);
    this.card.set(null);
    // Accepting alerts on the web: offer the browser channel next, once
    // the confirmation toast has gone.
    if (accept) this.schedule(4000);
  }

  protected async turnOn(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    const res = await this.webPush.enable('prompt');
    this.busy.set(false);
    this.card.set(null);
    if (res === 'enabled')
      this.toast.show({
        message: 'student.notifications.webPush.enabled',
        kind: 'success',
      });
    else if (res === 'denied')
      this.toast.show({
        message: 'student.notifications.webPush.denied',
        kind: 'info',
      });
    else if (res === 'error')
      this.toast.show({
        message: 'student.notifications.webPush.error',
        kind: 'error',
      });
  }

  protected notNow(): void {
    this.webPush.dismissOffer();
    this.card.set(null);
  }
}
