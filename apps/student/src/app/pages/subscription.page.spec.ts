import { TestBed } from '@angular/core/testing';
import {
  ActivatedRoute,
  convertToParamMap,
  provideRouter,
} from '@angular/router';
import { provideIonicAngular } from '@ionic/angular/standalone';
import { signal } from '@angular/core';
import { provideI18n } from '@codify/i18n';
import { provideAuth } from '@codify/auth';
import { provideApiClient } from '@codify/api-client';
import { OfflineSyncService } from '../offline/offline-sync.service';
import { DownloadService } from '../offline/download.service';
import {
  BillingClient,
  PlansClient,
  type SubscriptionView,
} from '@codify/api-client';
import { NativePlatformService } from '../native/native-platform.service';
import { TelemetryService } from '../telemetry/telemetry.service';
import { SubscriptionPage } from './subscription.page';
import { methodsFor, subscriptionActions } from './billing/subscription-view';

const future = new Date(Date.now() + 20 * 86_400_000).toISOString();
const sub = (over: Partial<SubscriptionView> = {}): SubscriptionView => ({
  id: 's1',
  planId: 'p1',
  planName: 'Pro',
  status: 'ACTIVE',
  source: 'STRIPE_WEB',
  currentPeriodStart: new Date().toISOString(),
  currentPeriodEnd: future,
  cancelAtPeriodEnd: false,
  trialEndsAt: null,
  canceledAt: null,
  pastDueSince: null,
  renews: true,
  grantsAccess: true,
  ...over,
});

describe('subscriptionActions', () => {
  it('renewing web subscription: cancel only', () => {
    expect(subscriptionActions(sub())).toMatchObject({
      canCancel: true,
      canResume: false,
      store: null,
    });
  });
  it('pending cancellation: resume only', () => {
    const a = subscriptionActions(
      sub({
        cancelAtPeriodEnd: true,
        canceledAt: new Date().toISOString(),
        renews: false,
      }),
    );
    expect(a).toMatchObject({
      canCancel: false,
      canResume: true,
      prepaid: false,
    });
  });
  it('PIX / Boleto prepay: neither (renew by buying again)', () => {
    expect(
      subscriptionActions(sub({ cancelAtPeriodEnd: true, renews: false })),
    ).toMatchObject({
      canCancel: false,
      canResume: false,
      prepaid: true,
    });
  });
  it('store-bought and granted subscriptions are managed elsewhere', () => {
    expect(subscriptionActions(sub({ source: 'APPLE_IAP' }))).toMatchObject({
      canCancel: false,
      store: 'APPLE',
    });
    expect(subscriptionActions(sub({ source: 'GOOGLE_PLAY' })).store).toBe(
      'GOOGLE',
    );
    expect(
      subscriptionActions(sub({ source: 'ADMIN_GRANT', renews: false })),
    ).toMatchObject({ canCancel: false, grant: true });
  });
  it('flags past due', () => {
    expect(subscriptionActions(sub({ status: 'PAST_DUE' })).pastDue).toBe(true);
  });
  it('offers PIX / Boleto only for the annual BRL price', () => {
    expect(methodsFor({ period: 'ANNUAL', currency: 'BRL' }, false)).toEqual([
      'card',
      'pix',
      'boleto',
    ]);
    expect(methodsFor({ period: 'MONTHLY', currency: 'BRL' }, false)).toEqual([
      'card',
    ]);
    expect(methodsFor({ period: 'ANNUAL', currency: 'USD' }, false)).toEqual([
      'card',
    ]);
    expect(methodsFor({ period: 'ANNUAL', currency: 'BRL' }, true)).toEqual([]);
  });
});

describe('SubscriptionPage cancel / resume flow', () => {
  it('cancels with the optional reason, then resumes', async () => {
    const canceled = sub({
      cancelAtPeriodEnd: true,
      canceledAt: new Date().toISOString(),
      renews: false,
    });
    const billing = {
      mySubscription: jest
        .fn()
        .mockResolvedValue({ subscriptions: [sub()], activePlanIds: ['p1'] }),
      cancelSubscription: jest.fn().mockResolvedValue(canceled),
      resumeSubscription: jest.fn().mockResolvedValue(sub()),
    };
    await TestBed.configureTestingModule({
      imports: [SubscriptionPage],
      providers: [
        provideRouter([]),
        provideIonicAngular(),
        provideI18n(),
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { queryParamMap: convertToParamMap({}) } },
        },
        { provide: BillingClient, useValue: billing },
        {
          provide: PlansClient,
          useValue: { list: jest.fn().mockResolvedValue({ items: [] }) },
        },
        { provide: NativePlatformService, useValue: { isNative: false } },
        { provide: TelemetryService, useValue: { track: jest.fn() } },
        provideAuth(),
        provideApiClient({ baseUrl: 'http://api.test' }),
        {
          provide: OfflineSyncService,
          useValue: { pendingCount: signal(0), flush: jest.fn() },
        },
        {
          provide: DownloadService,
          useValue: {
            downloads: signal([]),
            hydrate: jest.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(SubscriptionPage);
    fixture.detectChanges();
    await new Promise((r) => setTimeout(r, 0));
    const page = fixture.componentInstance as any;
    expect(page.actions()).toMatchObject({ canCancel: true, canResume: false });

    page.confirmOpen.set(true);
    page.reason = 'notUsing';
    await page.cancel();
    expect(billing.cancelSubscription).toHaveBeenCalledWith({
      subscriptionId: 's1',
      reason: 'notUsing',
    });
    expect(page.confirmOpen()).toBe(false);
    expect(page.actions()).toMatchObject({ canCancel: false, canResume: true });

    await page.resume();
    expect(billing.resumeSubscription).toHaveBeenCalledWith({
      subscriptionId: 's1',
    });
    expect(page.actions()).toMatchObject({ canCancel: true, canResume: false });
  });

  it('cancel without a reason sends no reason (skippable survey)', async () => {
    const billing = {
      mySubscription: jest
        .fn()
        .mockResolvedValue({ subscriptions: [sub()], activePlanIds: ['p1'] }),
      cancelSubscription: jest
        .fn()
        .mockResolvedValue(
          sub({ cancelAtPeriodEnd: true, canceledAt: 'x', renews: false }),
        ),
    };
    await TestBed.configureTestingModule({
      imports: [SubscriptionPage],
      providers: [
        provideRouter([]),
        provideIonicAngular(),
        provideI18n(),
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { queryParamMap: convertToParamMap({}) } },
        },
        { provide: BillingClient, useValue: billing },
        {
          provide: PlansClient,
          useValue: { list: jest.fn().mockResolvedValue({ items: [] }) },
        },
        { provide: NativePlatformService, useValue: { isNative: false } },
        { provide: TelemetryService, useValue: { track: jest.fn() } },
        provideAuth(),
        provideApiClient({ baseUrl: 'http://api.test' }),
        {
          provide: OfflineSyncService,
          useValue: { pendingCount: signal(0), flush: jest.fn() },
        },
        {
          provide: DownloadService,
          useValue: {
            downloads: signal([]),
            hydrate: jest.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(SubscriptionPage);
    await new Promise((r) => setTimeout(r, 0));
    await (fixture.componentInstance as any).cancel();
    expect(billing.cancelSubscription).toHaveBeenCalledWith({
      subscriptionId: 's1',
    });
  });
});

describe('SubscriptionPage refund + win-back (docs/09 §5, docs/10 §13)', () => {
  async function mount(
    billingOver: Record<string, unknown>,
    query: Record<string, string> = {},
  ) {
    const billing = {
      mySubscription: jest
        .fn()
        .mockResolvedValue({ subscriptions: [sub()], activePlanIds: ['p1'] }),
      refundEligibility: jest.fn().mockResolvedValue({
        eligible: true,
        reason: null,
        windowDays: 7,
        payment: {
          id: 'pay1',
          amountCents: 3990,
          currency: 'BRL',
          paidAt: '2026-11-07T00:00:00.000Z',
          planName: 'Pro',
        },
        deadline: '2026-11-14T00:00:00.000Z',
      }),
      offers: jest.fn().mockResolvedValue({
        winback: {
          offer: 'winback',
          eligible: false,
          reason: 'NO_OFFER',
          percentOff: 20,
          appliesTo: 'ANNUAL',
          expiresAt: null,
        },
      }),
      requestRefund: jest.fn().mockResolvedValue({
        paymentId: 'pay1',
        refund: {
          id: 're',
          status: 'succeeded',
          amountCents: 3990,
          currency: 'BRL',
        },
        before: { status: 'PAID', refundedCents: 0 },
        after: { status: 'REFUNDED', refundedCents: 3990 },
        accessEnded: true,
      }),
      createCheckout: jest
        .fn()
        .mockResolvedValue({ url: 'about:blank', sessionId: 's', mode: 'dev' }),
      ...billingOver,
    };
    const plans = {
      list: jest.fn().mockResolvedValue({
        items: [
          {
            id: 'p1',
            name: 'Pro',
            isActive: true,
            isAllAccess: true,
            trialDays: 0,
            description: null,
            tagline: null,
            prices: [
              {
                id: 'pm',
                period: 'MONTHLY',
                currency: 'BRL',
                amountCents: 3990,
                isActive: true,
                maxInstallments: null,
              },
              {
                id: 'pa',
                period: 'ANNUAL',
                currency: 'BRL',
                amountCents: 39900,
                isActive: true,
                maxInstallments: 12,
              },
            ],
          },
        ],
      }),
    };
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [SubscriptionPage],
      providers: [
        provideRouter([]),
        provideIonicAngular(),
        provideI18n(),
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { queryParamMap: convertToParamMap(query) } },
        },
        { provide: BillingClient, useValue: billing },
        { provide: PlansClient, useValue: plans },
        { provide: NativePlatformService, useValue: { isNative: false } },
        { provide: TelemetryService, useValue: { track: jest.fn() } },
        provideAuth(),
        provideApiClient({ baseUrl: 'http://api.test' }),
        {
          provide: OfflineSyncService,
          useValue: { pendingCount: signal(0), flush: jest.fn() },
        },
        {
          provide: DownloadService,
          useValue: {
            downloads: signal([]),
            hydrate: jest.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(SubscriptionPage);
    fixture.detectChanges();
    for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
    fixture.detectChanges();
    return { fixture, billing, page: fixture.componentInstance as any };
  }

  it('offers the refund, requires the typed word, then refunds', async () => {
    const { fixture, billing, page } = await mount({});
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[data-testid="refund-btn"]')).not.toBeNull();
    page.openRefund();
    page.refundTyped = 'nope';
    await page.refund();
    expect(billing.requestRefund).not.toHaveBeenCalled();
    page.refundTyped = 'refund';
    await page.refund();
    expect(billing.requestRefund).toHaveBeenCalledWith({ confirm: 'REFUND' });
    expect(page.refundOpen()).toBe(false);
  });

  it('no refund button when not eligible', async () => {
    const { fixture } = await mount({
      refundEligibility: jest.fn().mockResolvedValue({
        eligible: false,
        reason: 'WINDOW_PASSED',
        windowDays: 7,
        payment: null,
        deadline: null,
      }),
    });
    expect(
      fixture.nativeElement.querySelector('[data-testid="refund-btn"]'),
    ).toBeNull();
  });

  it('?offer=winback: shows the offer, switches to annual and checks out with it', async () => {
    const { fixture, billing, page } = await mount(
      {
        mySubscription: jest
          .fn()
          .mockResolvedValue({ subscriptions: [], activePlanIds: [] }),
        offers: jest.fn().mockResolvedValue({
          winback: {
            offer: 'winback',
            eligible: true,
            reason: null,
            percentOff: 20,
            appliesTo: 'ANNUAL',
            expiresAt: '2026-11-22T00:00:00.000Z',
          },
        }),
      },
      { offer: 'winback' },
    );
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[data-testid="winback-offer"]')).not.toBeNull();
    expect(page.period()).toBe('ANNUAL');
    const offer = page.offers()[0];
    expect(offer.amountCents).toBe(31920);
    const plan = offer.plan;
    page.selectPrice(plan, offer.price);
    expect(page.priceLabel(offer.price, false)).toContain('319');
    const origin = window.location;
    try {
      await page.checkout();
    } catch {
      /* jsdom navigation */
    }
    void origin;
    expect(billing.createCheckout).toHaveBeenCalledWith(
      expect.objectContaining({ planPriceId: 'pa', offer: 'winback' }),
    );
  });

  it('?offer=winback that is no longer available says so', async () => {
    const { fixture } = await mount({}, { offer: 'winback' });
    expect(
      fixture.nativeElement.querySelector('[data-testid="winback-gone"]'),
    ).not.toBeNull();
  });
});
