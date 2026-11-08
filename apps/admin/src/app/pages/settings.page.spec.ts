import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideI18n } from '@codify/i18n';
import { ConfirmDialogService, ToastService } from '@codify/ui-bootstrap';
import {
  BillingClient,
  FlagsClient,
  StaffToolsClient,
  type FeatureFlag,
} from '@codify/api-client';
import {
  SettingsPage,
  experimentPolicy,
  draftFrom,
  emptyDraft,
  validateFlag,
  valueFrom,
  variantSummary,
} from './settings.page';

const flag = (over: Partial<FeatureFlag> = {}): FeatureFlag => ({
  key: 'exp.card',
  value: {
    enabled: true,
    rolloutPct: 50,
    holdoutPct: 10,
    variants: { control: 1, big: 3 },
    surface: 'student',
  },
  description: 'Card test',
  isActive: true,
  builtIn: false,
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-02T00:00:00.000Z',
  ...over,
});

describe('feature flag form helpers', () => {
  it('round-trips a flag through the draft', () => {
    const f = flag();
    expect(valueFrom(draftFrom(f))).toEqual(f.value);
    expect(valueFrom(emptyDraft())).toEqual({
      enabled: true,
      surface: 'student',
    });
  });

  it('validates key, percentages, surface and variants', () => {
    const d = {
      ...emptyDraft(),
      key: 'Bad Key',
      rolloutPct: '101',
      holdoutPct: '',
      surface: 'Not ok',
      variants: [
        { key: 'holdout', weight: 1 },
        { key: 'a', weight: 1.5 },
        { key: 'a', weight: 1 },
      ],
    };
    expect(validateFlag(d, true)).toEqual({
      key: 'admin.settings.flags.invalidKey',
      rolloutPct: 'admin.settings.flags.invalidPct',
      holdoutPct: 'admin.settings.flags.invalidPct',
      surface: 'admin.settings.flags.invalidSurface',
      variant0: 'admin.settings.flags.invalidVariant',
      variant1: 'admin.settings.flags.invalidWeight',
      variant2: 'admin.settings.flags.invalidVariant',
    });
    // The key is fixed when editing.
    expect(validateFlag({ ...emptyDraft(), key: 'Bad Key' }, false)).toEqual(
      {},
    );
  });

  it('summarises variant weights as shares', () => {
    expect(variantSummary({ control: 1, big: 3 })).toBe(
      'control 25% · big 75%',
    );
    expect(variantSummary(undefined)).toBe('');
  });
});

describe('SettingsPage', () => {
  async function setup() {
    const flags = {
      list: jest.fn().mockResolvedValue({
        items: [flag(), flag({ key: 'shop.enabled', builtIn: true })],
      }),
      create: jest.fn(async (b) => flag({ ...b, value: b.value })),
      update: jest.fn(async (key, b) => flag({ key, ...b })),
      remove: jest.fn().mockResolvedValue({ deleted: true, key: 'exp.card' }),
    };
    const staff = {
      announceTerms: jest.fn(async () => ({
        version: 'v1',
        audience: 3,
        notified: 0,
        running: true,
      })),
      termsStatus: jest.fn(async () => ({
        version: 'v1',
        audience: 3,
        notified: 3,
        running: false,
      })),
    };
    const billing = {
      stripeStatus: jest.fn().mockResolvedValue({
        mode: 'dev',
        secretKeyConfigured: false,
        webhookSecretConfigured: false,
        revenueCatWebhookConfigured: false,
        webhookPath: '/api/webhooks/stripe',
        revenueCatWebhookPath: '/api/webhooks/revenuecat',
        webhookUrl: null,
      }),
    };
    const confirm = { open: jest.fn().mockResolvedValue(true) };
    await TestBed.configureTestingModule({
      imports: [SettingsPage],
      providers: [
        provideRouter([]),
        provideI18n(),
        { provide: FlagsClient, useValue: flags },
        { provide: BillingClient, useValue: billing },
        { provide: StaffToolsClient, useValue: staff },
        { provide: ConfirmDialogService, useValue: confirm },
        {
          provide: ToastService,
          useValue: { success: jest.fn(), error: jest.fn() },
        },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(SettingsPage);
    fixture.detectChanges();
    await new Promise((r) => setTimeout(r, 0));
    fixture.detectChanges();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const page = fixture.componentInstance as any;
    return { fixture, page, flags, confirm };
  }

  it('lists flags and the Stripe status', async () => {
    const { fixture } = await setup();
    const el: HTMLElement = fixture.nativeElement;
    expect(
      el.querySelectorAll('[data-testid="flags-table"] tbody tr'),
    ).toHaveLength(2);
    expect(el.querySelector('[data-testid="stripe-status"]')).not.toBeNull();
    expect(el.textContent).toContain('/api/webhooks/stripe');
  });

  it('creates a flag with variants; blocks invalid input client-side', async () => {
    const { page, flags } = await setup();
    page.startNew();
    page.draft.key = 'Bad';
    await page.save(new Event('submit'));
    expect(flags.create).not.toHaveBeenCalled();
    expect(page.fieldErrors()['key']).toBe('admin.settings.flags.invalidKey');

    page.draft.key = 'exp.new';
    page.draft.rolloutPct = '25';
    page.addVariant();
    page.draft.variants[0].key = 'control';
    page.addVariant();
    page.draft.variants[1] = { key: 'treatment', weight: '2' };
    await page.save(new Event('submit'));
    expect(flags.create).toHaveBeenCalledWith({
      key: 'exp.new',
      value: {
        enabled: true,
        rolloutPct: 25,
        variants: { control: 1, treatment: 2 },
        surface: 'student',
      },
      description: null,
      isActive: true,
    });
    expect(page.editing()).toBeNull();
    expect(page.flags().map((f: FeatureFlag) => f.key)).toContain('exp.new');
  });

  it('edits through PATCH and deletes after confirmation (built-ins never)', async () => {
    const { page, flags, confirm } = await setup();
    page.startEdit(page.flags()[0]);
    page.draft.enabled = false;
    await page.save(new Event('submit'));
    expect(flags.update).toHaveBeenCalledWith(
      'exp.card',
      expect.objectContaining({
        value: expect.objectContaining({ enabled: false }),
      }),
    );

    await page.remove(flag({ key: 'shop.enabled', builtIn: true }));
    expect(confirm.open).not.toHaveBeenCalled();
    await page.remove(flag());
    expect(confirm.open).toHaveBeenCalled();
    expect(flags.remove).toHaveBeenCalledWith('exp.card');
  });
});

describe('experiment policy (docs/10 §9)', () => {
  it('reports the global hold-out and the per-surface priority order', () => {
    const p = experimentPolicy([
      flag({
        key: 'experiments.global_holdout',
        value: { enabled: true, holdoutPct: 5 },
      }),
      flag({ key: 'exp.newer', createdAt: '2026-11-03T00:00:00.000Z' }),
      flag({ key: 'exp.older', createdAt: '2026-10-01T00:00:00.000Z' }),
      flag({ key: 'exp.off', value: { enabled: false, variants: { a: 1 } } }),
      flag({ key: 'plain', value: { enabled: true } }),
    ]);
    expect(p.globalHoldoutPct).toBe(5);
    expect(p.surfaces).toEqual([
      { surface: 'student', experiments: ['exp.older', 'exp.newer'] },
    ]);
    expect(experimentPolicy([]).globalHoldoutPct).toBe(0);
  });
});
