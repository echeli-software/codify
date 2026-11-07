import { TestBed } from '@angular/core/testing';
import {
  provideRouter,
  Router,
  UrlTree,
  type ActivatedRouteSnapshot,
  type RouterStateSnapshot,
  convertToParamMap,
} from '@angular/router';
import { provideAuth, AuthService } from '@codify/auth';
import {
  LeaguesClient,
  ProblemDetailsError,
  ReferralsClient,
} from '@codify/api-client';
import { NativePlatformService } from '../../native/native-platform.service';
import { GrowthLinksService, isPlausibleCode } from './growth-links.service';
import { growthLinkGuard, rootRedirectGuard } from './route-guards';
import { describeClaim } from '../growth-link.page';

describe('growth links (referral / invite)', () => {
  let claim: jest.Mock;
  let accept: jest.Mock;

  beforeEach(() => {
    localStorage.clear();
    claim = jest.fn();
    accept = jest.fn();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideAuth(),
        { provide: ReferralsClient, useValue: { claim } },
        { provide: LeaguesClient, useValue: { acceptFriendInvite: accept } },
        { provide: NativePlatformService, useValue: { isNative: false } },
      ],
    });
  });

  it('remembers plausible codes only, and expires them after 14 days', () => {
    const svc = TestBed.inject(GrowthLinksService);
    expect(isPlausibleCode('<script>')).toBe(false);
    svc.remember('referral', '<bad>');
    expect(svc.pending('referral')).toBeNull();
    svc.remember('referral', 'ABC123');
    expect(svc.pending('referral')).toBe('ABC123');
    expect(svc.pending('referral', Date.now() + 15 * 86_400_000)).toBeNull();
    expect(svc.pending('referral')).toBeNull(); // dropped
  });

  it('claims referral + invite and forgets the codes', async () => {
    const svc = TestBed.inject(GrowthLinksService);
    svc.remember('referral', 'CODE1');
    svc.remember('invite', 'CODE1');
    claim.mockResolvedValue({ status: 'claimed' });
    accept.mockResolvedValue({
      status: 'accepted',
      friend: { userId: 'u', displayName: 'Ana' },
    });
    const res = await svc.claimPending();
    expect(claim).toHaveBeenCalledWith('CODE1');
    expect(accept).toHaveBeenCalledWith('CODE1');
    expect(res).toEqual({
      referral: 'claimed',
      invite: { status: 'accepted', friendName: 'Ana' },
    });
    expect(svc.hasPending()).toBe(false);
  });

  it('maps 404 / 400 / 409 and keeps codes on transient failures', async () => {
    const svc = TestBed.inject(GrowthLinksService);
    svc.remember('referral', 'CODE2');
    claim.mockRejectedValue(new ProblemDetailsError({ status: 400 }));
    expect((await svc.claimPending()).referral).toBe('ineligible');
    expect(svc.pending('referral')).toBeNull();

    svc.remember('referral', 'CODE3');
    claim.mockRejectedValue(new ProblemDetailsError({ status: 409 }));
    expect((await svc.claimPending()).referral).toBe('conflict');

    svc.remember('referral', 'CODE4');
    claim.mockRejectedValue(new ProblemDetailsError({ status: 0 }));
    expect((await svc.claimPending()).referral).toBe('error');
    expect(svc.pending('referral')).toBe('CODE4'); // retried next start

    svc.remember('invite', 'NOPE1');
    claim.mockResolvedValue({ status: 'already_claimed' });
    accept.mockRejectedValue(new ProblemDetailsError({ status: 404 }));
    const res = await svc.claimPending();
    expect(res).toEqual({ referral: 'already', invite: { status: 'invalid' } });
  });

  it('/r/:code stores the code before redirecting a signed-out visitor to login', async () => {
    const guard = growthLinkGuard(['referral', 'invite']);
    const route = {
      paramMap: convertToParamMap({ code: 'ZXC789' }),
    } as ActivatedRouteSnapshot;
    const result = await TestBed.runInInjectionContext(() =>
      guard(route, { url: '/r/ZXC789' } as RouterStateSnapshot),
    );
    expect(result).toBeInstanceOf(UrlTree);
    expect(TestBed.inject(Router).serializeUrl(result as UrlTree)).toBe(
      '/login?redirect=%2Fr%2FZXC789',
    );
    const svc = TestBed.inject(GrowthLinksService);
    expect(svc.pending('referral')).toBe('ZXC789');
    expect(svc.pending('invite')).toBe('ZXC789');
  });

  it('/r/:code lets a signed-in user through', async () => {
    TestBed.inject(AuthService).signInAs('STUDENT');
    const guard = growthLinkGuard(['invite']);
    const route = {
      paramMap: convertToParamMap({ code: 'QWE123' }),
    } as ActivatedRouteSnapshot;
    const result = await TestBed.runInInjectionContext(() =>
      guard(route, { url: '/invite/QWE123' } as RouterStateSnapshot),
    );
    expect(result).toBe(true);
    expect(TestBed.inject(GrowthLinksService).pending('referral')).toBeNull();
  });

  it('/ sends signed-out web visitors to /welcome and signed-in users to /today', async () => {
    const router = TestBed.inject(Router);
    const run = () =>
      TestBed.runInInjectionContext(() =>
        rootRedirectGuard(
          {} as ActivatedRouteSnapshot,
          { url: '/' } as RouterStateSnapshot,
        ),
      ) as Promise<UrlTree>;
    expect(router.serializeUrl(await run())).toBe('/welcome');
    TestBed.inject(AuthService).signInAs('STUDENT');
    expect(router.serializeUrl(await run())).toBe('/today');
  });

  it('describes claim outcomes', () => {
    expect(
      describeClaim({
        referral: 'claimed',
        invite: { status: 'accepted', friendName: 'Ana' },
      }).map((l) => l.key),
    ).toEqual([
      'student.growth.referral.claimed',
      'student.growth.invite.accepted',
    ]);
    expect(
      describeClaim({ referral: null, invite: null }).map((l) => l.key),
    ).toEqual(['student.growth.nothing']);
  });
});
