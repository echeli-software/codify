import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideIonicAngular } from '@ionic/angular/standalone';
import { NotificationsClient, ProblemDetailsError } from '@codify/api-client';
import {
  OverlayHostService,
  RewardOrchestrator,
  type RewardToastEvent,
} from '@codify/gamification-engine';
import { provideI18n } from '@codify/i18n';
import { AppToastService } from '../platform/app-toast.service';
import { WebPushService } from '../platform/web-push.service';
import { REWARD_TOAST_MS } from '../reward-overlays.component';
import { TelemetryService } from '../telemetry/telemetry.service';
import {
  EngagementPrompts,
  isMeaningfulMoment,
} from './engagement-prompts.component';

const toast = (id: number, over: Partial<RewardToastEvent> = {}) =>
  ({
    id,
    kinds: ['lessonComplete'],
    xp: 10,
    coins: 2,
    streakChange: null,
    ...over,
  }) as unknown as RewardToastEvent;

describe('isMeaningfulMoment', () => {
  it('a finished lesson or an extended streak, not a shop purchase', () => {
    expect(isMeaningfulMoment(toast(1))).toBe(true);
    expect(isMeaningfulMoment(toast(1, { kinds: ['scenarioComplete'] }))).toBe(
      true,
    );
    expect(
      isMeaningfulMoment(
        toast(1, {
          kinds: ['promoCode'],
          streakChange: {
            extended: true,
          } as RewardToastEvent['streakChange'],
        }),
      ),
    ).toBe(true);
    expect(isMeaningfulMoment(toast(1, { kinds: ['promoCode'] }))).toBe(false);
  });
});

describe('EngagementPrompts', () => {
  const toastSig = signal<RewardToastEvent | null>(null);
  let notifications: { promoPrompt: jest.Mock; answerPromoPrompt: jest.Mock };
  let webPush: {
    canOffer: jest.Mock;
    enable: jest.Mock;
    dismissOffer: jest.Mock;
  };
  let show: jest.Mock;

  async function setup(promoShow = true, offer = true) {
    jest.useFakeTimers();
    toastSig.set(null);
    notifications = {
      promoPrompt: jest.fn(async () => ({ show: promoShow, promptedAt: null })),
      answerPromoPrompt: jest.fn(async (a) => ({ promptedAt: 'x', ...a })),
    };
    webPush = {
      canOffer: jest.fn(async () => offer),
      enable: jest.fn(async () => 'enabled'),
      dismissOffer: jest.fn(),
    };
    show = jest.fn();
    await TestBed.configureTestingModule({
      imports: [EngagementPrompts],
      providers: [
        provideIonicAngular(),
        provideI18n(),
        { provide: RewardOrchestrator, useValue: { toast: toastSig } },
        { provide: OverlayHostService, useValue: { current: signal(null) } },
        { provide: NotificationsClient, useValue: notifications },
        { provide: WebPushService, useValue: webPush },
        { provide: AppToastService, useValue: { show, error: jest.fn() } },
        { provide: TelemetryService, useValue: { track: jest.fn() } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(EngagementPrompts);
    fixture.detectChanges();
    return fixture;
  }

  async function settle(fixture: { detectChanges(): void }, ms: number) {
    await jest.advanceTimersByTimeAsync(ms);
    fixture.detectChanges();
  }

  afterEach(() => {
    jest.useRealTimers();
    TestBed.resetTestingModule();
  });

  const el = (f: { nativeElement: HTMLElement }, id: string) =>
    f.nativeElement.querySelector(`[data-testid="${id}"]`);

  it('shows nothing on load, then the promo card after a lesson once the toast is gone', async () => {
    const f = await setup();
    await settle(f, 10_000);
    expect(notifications.promoPrompt).not.toHaveBeenCalled();
    toastSig.set(toast(1));
    f.detectChanges();
    await settle(f, REWARD_TOAST_MS - 100);
    expect(el(f, 'promo-prompt')).toBeNull();
    await settle(f, 1000);
    expect(el(f, 'promo-prompt')).not.toBeNull();
    expect(f.nativeElement.textContent).toContain(
      'Get alerts about bonus events?',
    );
  });

  it('accepting with the email box ticked sends push + email, then offers browser notifications', async () => {
    const f = await setup();
    toastSig.set(toast(1));
    f.detectChanges();
    await settle(f, REWARD_TOAST_MS + 700);
    const cmp = f.componentInstance as unknown as {
      email: boolean;
      answerPromo(a: boolean): Promise<void>;
    };
    cmp.email = true;
    await cmp.answerPromo(true);
    expect(notifications.answerPromoPrompt).toHaveBeenCalledWith({
      push: true,
      email: true,
    });
    f.detectChanges();
    expect(el(f, 'promo-prompt')).toBeNull();
    await settle(f, 1000);
    expect(el(f, 'web-push-prompt')).toBeNull(); // not over the toast
    await settle(f, 3500);
    expect(el(f, 'web-push-prompt')).not.toBeNull();
  });

  it('declining never sends email consent, even with the box ticked', async () => {
    const f = await setup(true, false);
    toastSig.set(toast(1));
    f.detectChanges();
    await settle(f, REWARD_TOAST_MS + 700);
    const cmp = f.componentInstance as unknown as {
      email: boolean;
      answerPromo(a: boolean): Promise<void>;
    };
    cmp.email = true;
    await cmp.answerPromo(false);
    expect(notifications.answerPromoPrompt).toHaveBeenCalledWith({
      push: false,
      email: false,
    });
  });

  it('not eligible for the promo card → the browser notifications card; "Turn on" enables', async () => {
    const f = await setup(false, true);
    toastSig.set(toast(1));
    f.detectChanges();
    await settle(f, REWARD_TOAST_MS + 700);
    expect(el(f, 'promo-prompt')).toBeNull();
    expect(el(f, 'web-push-prompt')).not.toBeNull();
    await (
      f.componentInstance as unknown as { turnOn(): Promise<void> }
    ).turnOn();
    expect(webPush.enable).toHaveBeenCalledWith('prompt');
    f.detectChanges();
    expect(el(f, 'web-push-prompt')).toBeNull();
  });

  it('an answer from another device (409) just closes the card', async () => {
    const f = await setup(true, false);
    notifications.answerPromoPrompt.mockRejectedValue(
      new ProblemDetailsError({
        type: 'about:blank',
        title: 'Conflict',
        status: 409,
        code: 'PROMO_PROMPT_ANSWERED',
      }),
    );
    toastSig.set(toast(1));
    f.detectChanges();
    await settle(f, REWARD_TOAST_MS + 700);
    await (
      f.componentInstance as unknown as {
        answerPromo(a: boolean): Promise<void>;
      }
    ).answerPromo(true);
    f.detectChanges();
    expect(el(f, 'promo-prompt')).toBeNull();
  });
});
