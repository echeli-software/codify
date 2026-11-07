import {
  HttpClient,
  provideHttpClient,
  withInterceptors,
} from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { authInterceptor } from './auth.interceptor.js';
import { AuthService } from './auth.service.js';
import { AUTH_CONFIG, type AuthConfig } from './config.js';

const API = 'http://api.test/api';

function setup(config: AuthConfig = { apiBaseUrl: API }) {
  localStorage.clear();
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      provideHttpClient(withInterceptors([authInterceptor()])),
      provideHttpClientTesting(),
      { provide: AUTH_CONFIG, useValue: config },
    ],
  });
  return {
    http: TestBed.inject(HttpClient),
    ctrl: TestBed.inject(HttpTestingController),
    auth: TestBed.inject(AuthService),
    router: TestBed.inject(Router),
  };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

describe('authInterceptor', () => {
  it('attaches the bearer token to API requests', async () => {
    const { http, ctrl, auth } = setup();
    auth.signInAs('STUDENT');
    const p = firstValueFrom(http.get(`${API}/me`));
    await settle();
    const req = ctrl.expectOne(`${API}/me`);
    expect(req.request.headers.get('Authorization')).toBe(
      'Bearer dev-token-student',
    );
    req.flush({});
    await p;
    ctrl.verify();
  });

  it('never sends the token to other origins', async () => {
    const { http, ctrl, auth } = setup();
    auth.signInAs('STUDENT');
    const p = firstValueFrom(http.get('https://cdn.example.com/file.json'));
    await settle();
    const req = ctrl.expectOne('https://cdn.example.com/file.json');
    expect(req.request.headers.has('Authorization')).toBe(false);
    req.flush({});
    await p;
  });

  it('does not match look-alike prefixes', async () => {
    const { http, ctrl, auth } = setup();
    auth.signInAs('STUDENT');
    const p = firstValueFrom(http.get('http://api.test/api-evil/x'));
    await settle();
    const req = ctrl.expectOne('http://api.test/api-evil/x');
    expect(req.request.headers.has('Authorization')).toBe(false);
    req.flush({});
    await p;
  });

  it('honours an explicit allowlist', async () => {
    const { http, ctrl, auth } = setup({
      apiBaseUrl: API,
      tokenAllowlist: ['https://uploads.codify.app'],
    });
    auth.signInAs('ADMIN');
    const p = firstValueFrom(http.get('https://uploads.codify.app/sign'));
    await settle();
    const req = ctrl.expectOne('https://uploads.codify.app/sign');
    expect(req.request.headers.get('Authorization')).toBe(
      'Bearer dev-token-admin',
    );
    req.flush({});
    await p;
  });

  it('only sends the token to relative URLs when no API base is configured', async () => {
    const { http, ctrl, auth } = setup({});
    auth.signInAs('STUDENT');
    const rel = firstValueFrom(http.get('/api/me'));
    const abs = firstValueFrom(http.get('http://other.test/api/me'));
    await settle();
    const relReq = ctrl.expectOne('/api/me');
    const absReq = ctrl.expectOne('http://other.test/api/me');
    expect(relReq.request.headers.has('Authorization')).toBe(true);
    expect(absReq.request.headers.has('Authorization')).toBe(false);
    relReq.flush({});
    absReq.flush({});
    await Promise.all([rel, abs]);
  });

  it('on 401 signs out and redirects to /login with the current url', async () => {
    const { http, ctrl, auth, router } = setup();
    auth.signInAs('STUDENT');
    jest.spyOn(router, 'url', 'get').mockReturnValue('/lessons/42?tab=quiz');
    const navigate = jest.spyOn(router, 'navigate').mockResolvedValue(true);
    const p = firstValueFrom(http.get(`${API}/me`)).catch((e) => e);
    await settle();
    ctrl
      .expectOne(`${API}/me`)
      .flush({}, { status: 401, statusText: 'Unauthorized' });
    const err = await p;
    expect(err.status).toBe(401);
    expect(auth.isAuthenticated()).toBe(false);
    expect(navigate).toHaveBeenCalledWith(['/login'], {
      queryParams: { redirect: '/lessons/42?tab=quiz' },
    });
  });

  it('does not redirect for anonymous 401s or when already on /login', async () => {
    const { http, ctrl, auth, router } = setup();
    const navigate = jest.spyOn(router, 'navigate').mockResolvedValue(true);
    const anon = firstValueFrom(http.get(`${API}/me`)).catch((e) => e);
    await settle();
    ctrl
      .expectOne(`${API}/me`)
      .flush({}, { status: 401, statusText: 'Unauthorized' });
    await anon;
    expect(navigate).not.toHaveBeenCalled();

    auth.signInAs('STUDENT');
    jest
      .spyOn(router, 'url', 'get')
      .mockReturnValue('/login?redirect=%2Ftoday');
    const onLogin = firstValueFrom(http.get(`${API}/me`)).catch((e) => e);
    await settle();
    ctrl
      .expectOne(`${API}/me`)
      .flush({}, { status: 401, statusText: 'Unauthorized' });
    await onLogin;
    expect(navigate).not.toHaveBeenCalled();
  });
});
