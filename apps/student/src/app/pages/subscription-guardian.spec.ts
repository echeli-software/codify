import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  ActivatedRoute,
  convertToParamMap,
  provideRouter,
} from '@angular/router';
import { provideIonicAngular } from '@ionic/angular/standalone';
import {
  BillingClient,
  PlansClient,
  ProblemDetailsError,
  provideApiClient,
  type Plan,
  type PlanPrice,
} from '@codify/api-client';
import { provideAuth } from '@codify/auth';
import { provideI18n } from '@codify/i18n';
import { NativePlatformService } from '../native/native-platform.service';
import { DownloadService } from '../offline/download.service';
import { OfflineSyncService } from '../offline/offline-sync.service';
import { TelemetryService } from '../telemetry/telemetry.service';
import { SubscriptionPage } from './subscription.page';

/** docs/09 "Guardian step": a minor's web checkout waits for a guardian. */

const tick = () => new Promise((r) => setTimeout(r, 0));
const price: PlanPrice = {
  id: 'price-1',
  currency: 'BRL',
  amountCents: 39900,
  period: 'ANNUAL',
  maxInstallments: 12,
  isActive: true,
  stripePriceId: null,
  storeProductId: null,
};
const plan = {
  id: 'p1',
  slug: 'pro',
  name: 'Pro',
  description: null,
  tagline: null,
  isAllAccess: true,
  revenueCatEntitlementId: null,
  isActive: true,
  trialDays: 0,
  sortOrder: 0,
  categoryIds: [],
  prices: [price],
  stripeProductId: null,
  syncedToStripe: false,
  createdAt: '',
  updatedAt: '',
} as Plan;

async function mount(
  status: Record<string, unknown>,
  opts: { native?: boolean; checkout?: jest.Mock } = {},
) {
  const billing = {
    mySubscription: jest
      .fn()
      .mockResolvedValue({ subscriptions: [], activePlanIds: [] }),
    offers: jest.fn().mockRejectedValue(new Error('n/a')),
    refundEligibility: jest.fn().mockRejectedValue(new Error('n/a')),
    myPayments: jest.fn().mockResolvedValue({ items: [], total: 0 }),
    guardianConsentStatus: jest.fn().mockResolvedValue(status),
    createCheckout: opts.checkout ?? jest.fn(),
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
        useValue: { list: jest.fn().mockResolvedValue({ items: [plan] }) },
      },
      {
        provide: NativePlatformService,
        useValue: { isNative: !!opts.native },
      },
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
  await tick();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const page = fixture.componentInstance as any;
  page.selectPrice(plan, price);
  await tick();
  fixture.detectChanges();
  return { page, billing, fixture };
}

describe('SubscriptionPage guardian step', () => {
  it('blocks a minor’s web checkout until a guardian confirms', async () => {
    const { page, billing } = await mount({
      required: true,
      ageGroup: 'minor',
      consent: null,
    });
    expect(billing.guardianConsentStatus).toHaveBeenCalledWith('price-1');
    expect(page.guardianBlocks()).toBe(true);
    expect(page.guardianFor('price-1')).toMatchObject({ required: true });
    // After the confirmation the status reloads and checkout opens up.
    billing.guardianConsentStatus.mockResolvedValueOnce({
      required: false,
      ageGroup: 'minor',
      consent: { id: 'gc1', guardianName: 'Maria', planPriceId: 'price-1' },
    });
    await page.loadGuardian('price-1');
    expect(page.guardianBlocks()).toBe(false);
  });

  it('never blocks adults', async () => {
    const { page } = await mount({
      required: false,
      ageGroup: 'adult',
      consent: null,
    });
    expect(page.guardianBlocks()).toBe(false);
  });

  it('native: only the "ask a parent" note — the stores’ family controls apply', async () => {
    const { page } = await mount(
      { required: true, ageGroup: 'minor', consent: null },
      { native: true },
    );
    expect(page.guardianBlocks()).toBe(false);
    expect(page.guardianFor('price-1')).toMatchObject({ ageGroup: 'minor' });
  });

  it('a 403 GUARDIAN_CONSENT_REQUIRED at checkout re-opens the step', async () => {
    const checkout = jest.fn().mockRejectedValue(
      new ProblemDetailsError({
        status: 403,
        code: 'GUARDIAN_CONSENT_REQUIRED',
      } as never),
    );
    const { page, billing } = await mount(
      { required: false, ageGroup: 'minor', consent: null },
      { checkout },
    );
    billing.guardianConsentStatus.mockResolvedValueOnce({
      required: true,
      ageGroup: 'minor',
      consent: null,
    });
    await page.checkout();
    expect(checkout).toHaveBeenCalled();
    expect(page.guardianBlocks()).toBe(true);
  });
});
