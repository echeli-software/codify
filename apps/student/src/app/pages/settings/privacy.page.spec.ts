import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { provideIonicAngular } from '@ionic/angular/standalone';
import { provideI18n } from '@codify/i18n';
import {
  AccountClient,
  BillingClient,
  ProblemDetailsError,
  type DeleteAccountResult,
} from '@codify/api-client';
import { AppToastService } from '../../platform/app-toast.service';
import { TelemetryService } from '../../telemetry/telemetry.service';
import { AccountStateService } from '../account/account-state';
import { PrivacyPage } from './privacy.page';

const deleted: DeleteAccountResult = {
  status: 'deleted',
  deletedAt: '2026-11-07T00:00:00.000Z',
  deletionRequestedAt: '2026-11-07T00:00:00.000Z',
  restorableUntil: '2026-11-21T00:00:00.000Z',
  purgeAt: '2026-12-07T00:00:00.000Z',
  suspendedAt: null,
  autoRenewStopped: [],
  storeSubscriptions: [{ id: 's2', planName: 'Pro', source: 'APPLE_IAP' }],
};

async function setup(over: { exportData?: jest.Mock } = {}) {
  const account = {
    exportData:
      over.exportData ??
      jest.fn().mockResolvedValue({
        formatVersion: 1,
        exportedAt: '2026-11-07T10:00:00.000Z',
        userId: 'u1',
      }),
    deleteAccount: jest.fn().mockResolvedValue(deleted),
  };
  const billing = {
    mySubscription: jest.fn().mockResolvedValue({
      activePlanIds: ['p1'],
      subscriptions: [
        { source: 'APPLE_IAP', renews: true, grantsAccess: true },
        { source: 'STRIPE_WEB', renews: false, grantsAccess: true },
      ],
    }),
  };
  const toast = { show: jest.fn(), error: jest.fn() };
  await TestBed.configureTestingModule({
    imports: [PrivacyPage],
    providers: [
      provideRouter([]),
      provideIonicAngular(),
      provideI18n(),
      { provide: AccountClient, useValue: account },
      { provide: BillingClient, useValue: billing },
      { provide: AppToastService, useValue: toast },
      { provide: TelemetryService, useValue: { track: jest.fn() } },
    ],
  }).compileComponents();
  const fixture = TestBed.createComponent(PrivacyPage);
  fixture.detectChanges();
  const nav = jest
    .spyOn(TestBed.inject(Router), 'navigateByUrl')
    .mockResolvedValue(true);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const page = fixture.componentInstance as any;
  return { fixture, page, account, billing, toast, nav };
}

describe('PrivacyPage', () => {
  beforeAll(() => {
    URL.createObjectURL = jest.fn(() => 'blob:x');
    URL.revokeObjectURL = jest.fn();
  });

  it('downloads the export as a JSON file', async () => {
    const click = jest
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);
    const { page, account, toast } = await setup();
    await page.exportData();
    expect(account.exportData).toHaveBeenCalled();
    expect(click).toHaveBeenCalled();
    expect(toast.show).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'student.privacy.export.done' }),
    );
    click.mockRestore();
  });

  it('explains the export throttle in minutes', async () => {
    const { page, toast } = await setup({
      exportData: jest.fn().mockRejectedValue(
        new ProblemDetailsError({
          status: 429,
          code: 'EXPORT_RATE_LIMITED',
          data: { retryAfter: 290 },
        }),
      ),
    });
    await page.exportData();
    expect(toast.show).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'student.privacy.export.rateLimited',
        params: { minutes: 5 },
      }),
    );
  });

  it('delete needs the acknowledgement, warns about store subscriptions, then goes to restore', async () => {
    const { fixture, page, account, nav } = await setup();
    page.openConfirm();
    await new Promise((r) => setTimeout(r, 0));
    fixture.detectChanges();
    expect(page.hasStoreSubscription()).toBe(true);
    expect(page.hasWebRenewal()).toBe(false);

    await page.deleteAccount();
    expect(account.deleteAccount).not.toHaveBeenCalled();

    page.acknowledged.set(true);
    await page.deleteAccount();
    expect(account.deleteAccount).toHaveBeenCalled();
    expect(TestBed.inject(AccountStateService).block()).toEqual({
      kind: 'deleted',
      restorableUntil: deleted.restorableUntil,
    });
    expect(nav).toHaveBeenCalledWith('/account/restore');
  });
});
