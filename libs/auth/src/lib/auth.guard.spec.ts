import { TestBed } from '@angular/core/testing';
import {
  type ActivatedRouteSnapshot,
  Router,
  type RouterStateSnapshot,
  UrlTree,
  provideRouter,
} from '@angular/router';
import { authGuard } from './auth.guard.js';
import { AuthService } from './auth.service.js';

function run(guard: ReturnType<typeof authGuard>, url: string) {
  return TestBed.runInInjectionContext(() =>
    guard({} as ActivatedRouteSnapshot, { url } as RouterStateSnapshot),
  ) as Promise<boolean | UrlTree>;
}

describe('authGuard', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
  });

  it('redirects anonymous users to /login with the attempted url', async () => {
    const result = await run(authGuard(), '/courses/abc?tab=2');
    expect(result).toBeInstanceOf(UrlTree);
    const router = TestBed.inject(Router);
    expect(router.serializeUrl(result as UrlTree)).toBe(
      '/login?redirect=%2Fcourses%2Fabc%3Ftab%3D2',
    );
  });

  it('honours a custom login path', async () => {
    const result = await run(authGuard([], { loginPath: '/sign-in' }), '/x');
    expect(TestBed.inject(Router).serializeUrl(result as UrlTree)).toBe(
      '/sign-in?redirect=%2Fx',
    );
  });

  it('sends users without the role to /forbidden', async () => {
    TestBed.inject(AuthService).signInAs('STUDENT');
    const result = await run(authGuard(['ADMIN']), '/admin');
    expect(TestBed.inject(Router).serializeUrl(result as UrlTree)).toBe(
      '/forbidden',
    );
  });

  it('lets authorized users through', async () => {
    TestBed.inject(AuthService).signInAs('ADMIN');
    await expect(run(authGuard(['ADMIN', 'SUPPORT']), '/admin')).resolves.toBe(
      true,
    );
    await expect(run(authGuard(), '/today')).resolves.toBe(true);
  });

  it('waits for the auth state before deciding', async () => {
    const auth = TestBed.inject(AuthService);
    let release!: () => void;
    jest
      .spyOn(auth, 'whenReady')
      .mockReturnValue(new Promise<void>((r) => (release = r)));
    const pending = run(authGuard(), '/today');
    auth.signInAs('STUDENT'); // session resolves while the guard waits
    release();
    await expect(pending).resolves.toBe(true);
  });
});
