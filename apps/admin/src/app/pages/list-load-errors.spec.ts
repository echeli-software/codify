import type { Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  ActivatedRoute,
  convertToParamMap,
  provideRouter,
} from '@angular/router';
import { ContentTranslationService, provideI18n } from '@codify/i18n';
import { AuthService } from '@codify/auth';
import { ConfirmDialogService, ToastService } from '@codify/ui-bootstrap';
import {
  AdminCatalogClient,
  CategoriesClient,
  GamificationClient,
  ItemsClient,
  LeaguesClient,
  OpsClient,
  PlansClient,
  ReferralsClient,
  TranslationsClient,
  UsersClient,
  type Plan,
} from '@codify/api-client';
import { UsersPage } from './users.page';
import { PlansPage } from './plans.page';
import { GamificationPage } from './gamification.page';
import { TranslationsPage } from './translations.page';

/** ADM-10: list pages show an inline error with Retry, not only a toast. */

const settle = async () => {
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
};

const toast = () => ({
  success: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
});

const auth = (role = 'ADMIN') => ({
  role: () => role,
  hasAnyRole: (roles: readonly string[]) => roles.includes(role),
  user: () => ({ id: 'me', email: 'me@x.y' }),
  whenReady: () => Promise.resolve(),
});

async function render<T>(cmp: Type<T>, providers: unknown[]) {
  await TestBed.configureTestingModule({
    imports: [cmp],
    providers: [provideRouter([]), provideI18n(), ...(providers as never[])],
  }).compileComponents();
  const fixture = TestBed.createComponent(cmp);
  fixture.detectChanges();
  await settle();
  fixture.detectChanges();
  const el: HTMLElement = fixture.nativeElement;
  const retry = async (scope: ParentNode | null = el) => {
    if (!scope) throw new Error('retry scope not rendered');
    (
      scope.querySelector(
        '[data-testid="load-error"] cdf-button button',
      ) as HTMLElement
    ).click();
    await settle();
    fixture.detectChanges();
  };
  return { fixture, el, retry };
}

/** A client double whose every method resolves to an empty list. */
const resolvesEmpty = () =>
  new Proxy({}, { get: () => jest.fn().mockResolvedValue([]) });

const boom = () => Object.assign(new Error('offline'), { status: 0 });

describe('UsersPage load error', () => {
  it('shows the error inline and retries', async () => {
    const users = {
      list: jest
        .fn()
        .mockRejectedValueOnce(boom())
        .mockResolvedValue({ items: [], total: 0 }),
    };
    const t = toast();
    const { el, retry } = await render(UsersPage, [
      { provide: UsersClient, useValue: users },
      { provide: ToastService, useValue: t },
    ]);
    expect(el.querySelector('[data-testid="load-error"]')).not.toBeNull();
    expect(t.error).not.toHaveBeenCalled();
    await retry();
    expect(users.list).toHaveBeenCalledTimes(2);
    expect(el.querySelector('[data-testid="load-error"]')).toBeNull();
    expect(el.querySelector('cdf-empty-state')).not.toBeNull();
  });
});

const plan = (over: Partial<Plan> = {}): Plan =>
  ({
    id: 'p1',
    slug: 'pro',
    name: 'Pro',
    description: null,
    tagline: null,
    isAllAccess: false,
    revenueCatEntitlementId: null,
    isActive: true,
    trialDays: 7,
    sortOrder: 0,
    categoryIds: [],
    prices: [],
    stripeProductId: null,
    syncedToStripe: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  }) as Plan;

describe('PlansPage', () => {
  async function mount(opts: { fail?: boolean; role?: string } = {}) {
    const plans = {
      list: opts.fail
        ? jest
            .fn()
            .mockRejectedValueOnce(boom())
            .mockResolvedValue({ items: [plan()], total: 1 })
        : jest.fn().mockResolvedValue({ items: [plan()], total: 1 }),
      update: jest.fn(async (_id: string, body: Partial<Plan>) =>
        plan({ ...body }),
      ),
    };
    const confirm = { open: jest.fn().mockResolvedValue(false) };
    const r = await render(PlansPage, [
      { provide: PlansClient, useValue: plans },
      {
        provide: CategoriesClient,
        useValue: {
          list: jest.fn().mockResolvedValue({
            items: [{ id: 'c1', name: 'Web' }],
            total: 1,
          }),
        },
      },
      { provide: AuthService, useValue: auth(opts.role) },
      { provide: ConfirmDialogService, useValue: confirm },
      { provide: ToastService, useValue: toast() },
    ]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const page = r.fixture.componentInstance as any;
    return { ...r, page, plans, confirm };
  }

  it('shows a load error inline and retries', async () => {
    const { el, retry, plans } = await mount({ fail: true });
    expect(el.querySelector('[data-testid="load-error"]')).not.toBeNull();
    await retry();
    expect(plans.list).toHaveBeenCalledTimes(2);
    expect(el.querySelector('[data-testid="load-error"]')).toBeNull();
    expect(el.textContent).toContain('Pro');
  });

  it('tracks unsaved plan edits and asks before switching plans', async () => {
    const { page, confirm } = await mount();
    expect(page.hasUnsavedChanges()).toBe(false);
    await page.select(page.plans()[0]);
    expect(page.hasUnsavedChanges()).toBe(false);
    page.form.name = 'Pro+';
    expect(page.hasUnsavedChanges()).toBe(true);
    // Staying (dialog dismissed) keeps the edit.
    await page.startCreate();
    expect(confirm.open).toHaveBeenCalledTimes(1);
    expect(page.form.name).toBe('Pro+');
    // Saving makes the form clean again.
    await page.savePlan();
    expect(page.hasUnsavedChanges()).toBe(false);
  });

  it('counts price-line drafts and unsaved category matrix changes', async () => {
    const { page } = await mount();
    page.plans.set([
      plan({
        prices: [
          {
            id: 'pr1',
            currency: 'BRL',
            amountCents: 2990,
            period: 'MONTHLY',
            maxInstallments: null,
            isActive: true,
            stripePriceId: null,
            storeProductId: null,
          },
        ],
      }),
    ]);
    await page.select(page.plans()[0]);
    page.priceDrafts['pr1'].isActive = false;
    expect(page.hasUnsavedChanges()).toBe(true);
    page.priceDrafts['pr1'].isActive = true;
    expect(page.hasUnsavedChanges()).toBe(false);
    page.assignments.set({ p1: ['c1'] });
    expect(page.hasUnsavedChanges()).toBe(true);
  });

  it('read-only viewers never hold unsaved changes', async () => {
    const { page } = await mount({ role: 'SUPPORT' });
    await page.select(page.plans()[0]);
    page.form.name = 'changed';
    expect(page.hasUnsavedChanges()).toBe(false);
  });
});

describe('GamificationPage load errors', () => {
  it('config and badge/quest lists fail inline and retry', async () => {
    const client = {
      getConfig: jest.fn().mockRejectedValueOnce(boom()).mockResolvedValue([]),
      listBadges: jest.fn().mockRejectedValueOnce(boom()).mockResolvedValue([]),
      listQuestTemplates: jest.fn().mockResolvedValue([]),
    };
    const { el, fixture, retry } = await render(GamificationPage, [
      { provide: GamificationClient, useValue: client },
      { provide: AdminCatalogClient, useValue: resolvesEmpty() },
      { provide: LeaguesClient, useValue: {} },
      { provide: ReferralsClient, useValue: {} },
      { provide: ItemsClient, useValue: {} },
      {
        provide: OpsClient,
        useValue: { lastDrift: jest.fn().mockResolvedValue({ report: null }) },
      },
      {
        provide: ActivatedRoute,
        useValue: { snapshot: { queryParamMap: convertToParamMap({}) } },
      },
      { provide: ConfirmDialogService, useValue: { open: jest.fn() } },
      { provide: ToastService, useValue: toast() },
    ]);
    // Defaults tab.
    expect(
      el.querySelector('#gpanel-defaults [data-testid="load-error"]'),
    ).not.toBeNull();
    await retry(el.querySelector('#gpanel-defaults'));
    expect(client.getConfig).toHaveBeenCalledTimes(2);
    expect(
      el.querySelector('#gpanel-defaults [data-testid="load-error"]'),
    ).toBeNull();

    // Badges tab shares the badge/quest load.
    (el.querySelector('#gtab-badges') as HTMLElement).click();
    fixture.detectChanges();
    expect(
      el.querySelector('#gpanel-badges [data-testid="load-error"]'),
    ).not.toBeNull();
    await retry(el.querySelector('#gpanel-badges'));
    expect(client.listBadges).toHaveBeenCalledTimes(2);
    expect(el.querySelector('#gpanel-badges table')).not.toBeNull();
  });
});

describe('TranslationsPage load errors', () => {
  it('the row list and completeness fail inline and retry', async () => {
    const client = {
      list: jest
        .fn()
        .mockRejectedValueOnce(boom())
        .mockResolvedValue({ items: [], total: 0 }),
      completeness: jest
        .fn()
        .mockRejectedValueOnce(boom())
        .mockResolvedValue({ locales: {}, entities: [] }),
    };
    const t = toast();
    const { el, retry } = await render(TranslationsPage, [
      { provide: TranslationsClient, useValue: client },
      {
        provide: ContentTranslationService,
        useValue: { invalidate: jest.fn() },
      },
      { provide: ToastService, useValue: t },
    ]);
    expect(el.querySelectorAll('[data-testid="load-error"]').length).toBe(2);
    expect(t.error).not.toHaveBeenCalled();
    await retry();
    await retry();
    expect(client.list).toHaveBeenCalledTimes(2);
    expect(client.completeness).toHaveBeenCalledTimes(2);
    expect(el.querySelector('[data-testid="load-error"]')).toBeNull();
  });
});
