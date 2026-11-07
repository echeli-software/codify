import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Router, provideRouter, type UrlTree } from '@angular/router';
import { AuthService } from '@codify/auth';
import { FlagsClient } from '@codify/api-client';
import { FeatureFlagsService, featureGuard } from './feature-flags.service';

function setup(mine: jest.Mock) {
  localStorage.clear();
  const user = signal<{ id: string } | null>({ id: 'u1' });
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: FlagsClient, useValue: { mine } },
      { provide: AuthService, useValue: { user } },
    ],
  });
  const svc = TestBed.inject(FeatureFlagsService);
  TestBed.flushEffects();
  return { svc, user };
}

describe('FeatureFlagsService', () => {
  it('built-in surfaces default on until loaded; unknown flags are off', () => {
    const { svc } = setup(jest.fn(() => new Promise(() => undefined)));
    expect(svc.leaguesEnabled()).toBe(true);
    expect(svc.shopEnabled()).toBe(true);
    expect(svc.isOn('exp.unknown')).toBe(false);
  });

  it('applies the server map, caches it and exposes variants', async () => {
    const mine = jest.fn().mockResolvedValue({
      'shop.enabled': { enabled: false, variant: null },
      'exp.card': { enabled: true, variant: 'big' },
    });
    const { svc } = setup(mine);
    await svc.whenLoaded();
    expect(svc.shopEnabled()).toBe(false);
    expect(svc.leaguesEnabled()).toBe(true);
    expect(svc.variant('exp.card')).toBe('big');
    expect(JSON.parse(localStorage.getItem('cdf.flags.v1') ?? '{}')).toEqual(
      expect.objectContaining({ 'shop.enabled': expect.anything() }),
    );
  });

  it('a failed load keeps the last known map', async () => {
    const { svc } = setup(jest.fn().mockRejectedValue(new Error('offline')));
    await svc.whenLoaded();
    expect(svc.loaded()).toBe(true);
    expect(svc.shopEnabled()).toBe(true);
  });

  it('reloads when the signed-in user changes', async () => {
    const mine = jest.fn().mockResolvedValue({});
    const { svc, user } = setup(mine);
    await svc.whenLoaded();
    user.set({ id: 'u2' });
    TestBed.flushEffects();
    await svc.whenLoaded();
    expect(mine).toHaveBeenCalledTimes(2);
  });

  it('featureGuard redirects a disabled surface to /today', async () => {
    setup(
      jest.fn().mockResolvedValue({
        'leagues.enabled': { enabled: false, variant: null },
      }),
    );
    const router = TestBed.inject(Router);
    const blocked = (await TestBed.runInInjectionContext(() =>
      featureGuard('leagues.enabled')({} as never, {} as never),
    )) as UrlTree;
    expect(router.serializeUrl(blocked)).toBe('/today');
    const allowed = await TestBed.runInInjectionContext(() =>
      featureGuard('shop.enabled')({} as never, {} as never),
    );
    expect(allowed).toBe(true);
  });
});
