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
