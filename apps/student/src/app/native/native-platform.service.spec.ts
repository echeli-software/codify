import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { DevicesClient, ProblemDetailsError } from '@codify/api-client';
import { TelemetryService } from '../telemetry/telemetry.service';
import {
  NativePlatformService,
  StoreProductMissingError,
} from './native-platform.service';

describe('NativePlatformService', () => {
  let register: jest.Mock;

  function setup() {
    register = jest.fn();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        {
          provide: DevicesClient,
          useValue: { register, unregister: jest.fn() },
        },
        {
          provide: TelemetryService,
          useValue: { track: jest.fn(), flush: jest.fn() },
        },
      ],
    });
    return TestBed.inject(NativePlatformService);
  }

  afterEach(() => {
    TestBed.resetTestingModule();
    delete (globalThis as { Capacitor?: unknown }).Capacitor;
  });

  it('is a web no-op outside the Capacitor shell', async () => {
    const svc = setup();
    expect(svc.isNative).toBe(false);
    expect(svc.platform()).toBe('WEB');
    expect(svc.storePurchasesAvailable).toBe(false);
    await expect(svc.restorePurchases()).resolves.toBe(false);
    await expect(svc.onSignedIn('u1')).resolves.toBeUndefined();
  });

  it('detects the native platform from the Capacitor bridge', () => {
    (globalThis as { Capacitor?: unknown }).Capacitor = {
      isNativePlatform: () => true,
      getPlatform: () => 'android',
    };
    const svc = setup();
    expect(svc.isNative).toBe(true);
    expect(svc.platform()).toBe('ANDROID');
  });

  it('re-registers the push token once on 409 device.rebind_required', async () => {
    const svc = setup();
    register
      .mockRejectedValueOnce(
        new ProblemDetailsError({
          status: 409,
          code: 'device.rebind_required',
        }),
      )
      .mockResolvedValueOnce({ id: 'd1' });
    await expect(svc.bindToken('tok')).resolves.toBe(true);
    expect(register).toHaveBeenCalledTimes(2);
  });

  it('gives up after a second failure and on other errors', async () => {
    const svc = setup();
    register.mockRejectedValue(
      new ProblemDetailsError({ status: 409, code: 'device.rebind_required' }),
    );
    await expect(svc.bindToken('tok')).resolves.toBe(false);
    expect(register).toHaveBeenCalledTimes(2);
    register
      .mockReset()
      .mockRejectedValue(new ProblemDetailsError({ status: 500 }));
    await expect(svc.bindToken('tok')).resolves.toBe(false);
    expect(register).toHaveBeenCalledTimes(1);
  });

  it('refuses to buy a price without a store product id (no UUID-as-product)', async () => {
    const svc = setup();
    await expect(
      svc.purchasePrice({ storeProductId: null }),
    ).rejects.toBeInstanceOf(StoreProductMissingError);
  });
});
