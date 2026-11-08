import { TestBed } from '@angular/core/testing';
import {
  HttpClient,
  HttpErrorResponse,
  provideHttpClient,
  withInterceptors,
} from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { Router } from '@angular/router';
import { staffSessionCode, staffSessionInterceptor } from './staff-session';

const httpError = (status: number, body: unknown) =>
  new HttpErrorResponse({ status, error: body });

describe('staffSessionCode', () => {
  it('recognises the two staff-session 403 codes only', () => {
    expect(staffSessionCode(httpError(403, { code: 'MFA_REQUIRED' }))).toBe(
      'MFA_REQUIRED',
    );
    expect(staffSessionCode(httpError(403, { code: 'SESSION_TOO_OLD' }))).toBe(
      'SESSION_TOO_OLD',
    );
    expect(
      staffSessionCode(httpError(403, { code: 'ACCOUNT_SUSPENDED' })),
    ).toBeNull();
    expect(
      staffSessionCode(httpError(401, { code: 'MFA_REQUIRED' })),
    ).toBeNull();
    expect(staffSessionCode(new Error('x'))).toBeNull();
  });
});

describe('staffSessionInterceptor', () => {
  it('routes to /reauth with the reason and the session limit, and rethrows', async () => {
    const navigate = jest.fn(async () => true);
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([staffSessionInterceptor])),
        provideHttpClientTesting(),
        { provide: Router, useValue: { url: '/dashboard', navigate } },
      ],
    });
    const http = TestBed.inject(HttpClient);
    const ctrl = TestBed.inject(HttpTestingController);
    const done = new Promise<unknown>((resolve) =>
      http.get('/api/admin/users').subscribe({ error: resolve }),
    );
    ctrl
      .expectOne('/api/admin/users')
      .flush(
        { code: 'SESSION_TOO_OLD', maxSessionHours: 12 },
        { status: 403, statusText: 'Forbidden' },
      );
    expect(await done).toBeInstanceOf(HttpErrorResponse);
    expect(navigate).toHaveBeenCalledWith(['/reauth'], {
      queryParams: { reason: 'SESSION_TOO_OLD', hours: 12 },
    });

    // Other errors pass straight through.
    const other = new Promise<unknown>((resolve) =>
      http.get('/api/courses').subscribe({ error: resolve }),
    );
    ctrl
      .expectOne('/api/courses')
      .flush({ code: 'NOPE' }, { status: 403, statusText: 'Forbidden' });
    await other;
    expect(navigate).toHaveBeenCalledTimes(1);
  });
});
