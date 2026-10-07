import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { AuthService } from './auth.service.js';
import { AUTH_CONFIG, CLERK_LOADER, type ClerkLike } from './config.js';

describe('AuthService (dev mode)', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({});
  });

  it('starts unauthenticated when storage is empty', async () => {
    const auth = TestBed.inject(AuthService);
    expect(auth.mode).toBe('dev');
    expect(auth.isAuthenticated()).toBe(false);
    expect(auth.role()).toBeNull();
    expect(auth.loading()).toBe(false);
    await expect(auth.whenReady()).resolves.toBeUndefined();
  });

  it('signInAs() sets the role and persists to localStorage', async () => {
    const auth = TestBed.inject(AuthService);
    auth.signInAs('TEACHER', { displayName: 'Lucas' });
    expect(auth.isAuthenticated()).toBe(true);
    expect(auth.role()).toBe('TEACHER');
    expect(auth.user()?.displayName).toBe('Lucas');
    expect(auth.currentToken()).toBe('dev-token-teacher');
    await expect(auth.getToken()).resolves.toBe('dev-token-teacher');
    expect(localStorage.getItem('codify.auth.user')).toBeTruthy();
  });

  it('signOut() clears state and storage', async () => {
    const auth = TestBed.inject(AuthService);
    auth.signInAs('STUDENT');
    await auth.signOut();
    expect(auth.isAuthenticated()).toBe(false);
    expect(localStorage.getItem('codify.auth.user')).toBeNull();
  });

  it('updateProfile() merges fields into the signed-in user', () => {
    const auth = TestBed.inject(AuthService);
    auth.signInAs('STUDENT');
    auth.updateProfile({ displayName: 'Renamed', locale: 'en-US' });
    expect(auth.user()?.displayName).toBe('Renamed');
    expect(auth.user()?.locale).toBe('en-US');
    expect(auth.user()?.role).toBe('STUDENT');
    const persisted = JSON.parse(localStorage.getItem('codify.auth.user')!);
    expect(persisted.displayName).toBe('Renamed');
  });

  it('updateProfile() is a no-op when unauthenticated', () => {
    const auth = TestBed.inject(AuthService);
    auth.updateProfile({ displayName: 'Ghost' });
    expect(auth.user()).toBeNull();
  });

  it('hasAnyRole(): empty list = any authenticated user qualifies', () => {
    const auth = TestBed.inject(AuthService);
    expect(auth.hasAnyRole([])).toBe(false); // unauthenticated
    auth.signInAs('SUPPORT');
    expect(auth.hasAnyRole([])).toBe(true);
    expect(auth.hasAnyRole(['ADMIN'])).toBe(false);
    expect(auth.hasAnyRole(['SUPPORT', 'ADMIN'])).toBe(true);
  });
});

/** Minimal controllable Clerk double. */
class FakeClerk implements ClerkLike {
  user: ClerkLike['user'] = null;
  session: ClerkLike['session'] = null;
  loadOptions: Record<string, unknown> | undefined;
  private listeners: ((r: { user?: unknown }) => void)[] = [];
  readonly getToken = jest.fn(async () => 'clerk-jwt-1');
  readonly mountSignIn = jest.fn();
  readonly unmountSignIn = jest.fn();
  readonly openUserProfile = jest.fn();
  readonly signOut = jest.fn(async () => {
    this.user = null;
    this.session = null;
    this.emit();
  });

  async load(options?: Record<string, unknown>) {
    this.loadOptions = options;
  }
  addListener(l: (r: { user?: unknown }) => void) {
    this.listeners.push(l);
    return () => undefined;
  }
  signIn(id = 'user_1') {
    this.user = { id, imageUrl: 'https://img/a.png' };
    this.session = { getToken: this.getToken };
    this.emit();
  }
  emit() {
    this.listeners.forEach((l) => l({ user: this.user }));
  }
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('AuthService (Clerk mode)', () => {
  let clerk: FakeClerk;
  let http: HttpTestingController;

  function setup() {
    localStorage.clear();
    clerk = new FakeClerk();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: AUTH_CONFIG,
          useValue: {
            clerkPublishableKey: 'pk_test_x',
            apiBaseUrl: 'http://api.test/api',
          },
        },
        { provide: CLERK_LOADER, useValue: async () => clerk },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    return TestBed.inject(AuthService);
  }

  afterEach(() => http.verify());

  it('loads Clerk and resolves to signed-out when there is no session', async () => {
    const auth = setup();
    expect(auth.mode).toBe('clerk');
    expect(auth.loading()).toBe(true);
    await auth.whenReady();
    expect(auth.loading()).toBe(false);
    expect(auth.isAuthenticated()).toBe(false);
    expect(clerk.loadOptions?.['routerPush']).toBeInstanceOf(Function);
    expect(() => auth.signInAs('ADMIN')).toThrow();
  });

  it('takes the role from GET /me (not from Clerk) after sign-in', async () => {
    const auth = setup();
    await auth.whenReady();
    clerk.signIn();
    await flush();
    const req = http.expectOne('http://api.test/api/me');
    expect(req.request.headers.get('Authorization')).toBe('Bearer clerk-jwt-1');
    req.flush({
      id: 'db-1',
      email: 'ana@x.com',
      displayName: 'Ana',
      role: 'TEACHER',
      locale: 'en-US',
    });
    await flush();
    expect(auth.isAuthenticated()).toBe(true);
    expect(auth.role()).toBe('TEACHER');
    expect(auth.user()).toMatchObject({
      id: 'db-1',
      avatarUrl: 'https://img/a.png',
      locale: 'en-US',
    });
  });

  it('getToken() asks Clerk for a fresh token every time', async () => {
    const auth = setup();
    await auth.whenReady();
    clerk.signIn();
    await flush();
    http
      .expectOne('http://api.test/api/me')
      .flush({ id: 'db-1', email: 'a', displayName: 'A', role: 'STUDENT' });
    clerk.getToken.mockResolvedValueOnce('clerk-jwt-2');
    await expect(auth.getToken()).resolves.toBe('clerk-jwt-2');
  });

  it('signs out of Clerk when the API rejects the identity', async () => {
    const auth = setup();
    await auth.whenReady();
    clerk.signIn();
    await flush();
    http
      .expectOne('http://api.test/api/me')
      .flush({}, { status: 401, statusText: 'Unauthorized' });
    await flush();
    expect(auth.isAuthenticated()).toBe(false);
    expect(clerk.signOut).toHaveBeenCalled();
  });

  it('falls back to the cached profile when the API is unreachable', async () => {
    localStorage.clear();
    const auth = setup();
    localStorage.setItem(
      'codify.auth.profile',
      JSON.stringify({
        clerkUserId: 'user_1',
        user: {
          id: 'db-1',
          email: 'a',
          displayName: 'Cached',
          role: 'STUDENT',
        },
      }),
    );
    await auth.whenReady();
    clerk.signIn();
    await flush();
    http
      .expectOne('http://api.test/api/me')
      .error(new ProgressEvent('error'), { status: 0 });
    await flush();
    expect(auth.user()?.displayName).toBe('Cached');
  });

  it('mounts sign-in with the redirect and signs out through Clerk', async () => {
    const auth = setup();
    const node = document.createElement('div');
    await auth.mountSignIn(node, { redirectUrl: '/today' });
    expect(clerk.mountSignIn).toHaveBeenCalledWith(
      node,
      expect.objectContaining({ forceRedirectUrl: '/today' }),
    );
    auth.openUserProfile();
    expect(clerk.openUserProfile).toHaveBeenCalled();
    await auth.signOut();
    expect(clerk.signOut).toHaveBeenCalled();
  });

  it('settles signed-out when Clerk fails to load', async () => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        {
          provide: AUTH_CONFIG,
          useValue: {
            clerkPublishableKey: 'pk',
            apiBaseUrl: 'http://api.test/api',
          },
        },
        {
          provide: CLERK_LOADER,
          useValue: async () => Promise.reject(new Error('offline')),
        },
      ],
    });
    http = { verify: () => undefined } as unknown as HttpTestingController;
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const auth = TestBed.inject(AuthService);
    await auth.whenReady();
    expect(auth.loading()).toBe(false);
    expect(auth.isAuthenticated()).toBe(false);
  });
});
