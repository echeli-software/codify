import { TestBed } from '@angular/core/testing';
import {
  HttpClient,
  provideHttpClient,
  withInterceptors,
} from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { Router, provideRouter } from '@angular/router';
import { ProblemDetailsError } from '@codify/api-client';
import {
  AccountStateService,
  accountBlockOf,
  accountStateInterceptor,
} from './account-state';

describe('accountBlockOf', () => {
  it('reads ProblemDetailsError and raw HttpErrorResponse shapes', () => {
    expect(
      accountBlockOf(
        new ProblemDetailsError({
          status: 403,
          code: 'ACCOUNT_DELETED',
          data: { restorableUntil: '2026-11-21T00:00:00.000Z' },
        }),
      ),
    ).toEqual({ kind: 'deleted', restorableUntil: '2026-11-21T00:00:00.000Z' });
    expect(
      accountBlockOf({
        status: 403,
        error: { code: 'ACCOUNT_DELETED', restorableUntil: null },
      }),
    ).toEqual({ kind: 'deleted', restorableUntil: null });
    expect(
      accountBlockOf({ status: 403, error: { code: 'ACCOUNT_SUSPENDED' } }),
    ).toEqual({ kind: 'suspended' });
    expect(
      accountBlockOf({ status: 403, error: { code: 'auth.forbidden' } }),
    ).toBeNull();
    expect(
      accountBlockOf({ status: 404, error: { code: 'ACCOUNT_DELETED' } }),
    ).toBeNull();
  });
});

describe('accountStateInterceptor', () => {
  function setup() {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(withInterceptors([accountStateInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    const router = TestBed.inject(Router);
    const nav = jest
      .spyOn(router, 'navigateByUrl')
      .mockResolvedValue(true as never);
    return {
      http: TestBed.inject(HttpClient),
      ctrl: TestBed.inject(HttpTestingController),
      state: TestBed.inject(AccountStateService),
      nav,
    };
  }

  it('routes a deleted account to the restore screen and re-throws', async () => {
    const { http, ctrl, state, nav } = setup();
    const p = new Promise((resolve) =>
      http.get('/api/me').subscribe({ error: resolve }),
    );
    ctrl
      .expectOne('/api/me')
      .flush(
        { code: 'ACCOUNT_DELETED', restorableUntil: '2026-11-21T00:00:00Z' },
        { status: 403, statusText: 'Forbidden' },
      );
    expect(((await p) as { status: number }).status).toBe(403);
    expect(state.block()).toEqual({
      kind: 'deleted',
      restorableUntil: '2026-11-21T00:00:00Z',
    });
    expect(nav).toHaveBeenCalledWith('/account/restore');
  });

  it('routes a suspended account; leaves other errors alone', async () => {
    const { http, ctrl, state, nav } = setup();
    const a = new Promise((r) => http.get('/a').subscribe({ error: r }));
    ctrl
      .expectOne('/a')
      .flush(
        { code: 'ACCOUNT_SUSPENDED' },
        { status: 403, statusText: 'Forbidden' },
      );
    await a;
    expect(state.block()).toEqual({ kind: 'suspended' });
    expect(nav).toHaveBeenCalledWith('/account/suspended');

    nav.mockClear();
    state.clear();
    const b = new Promise((r) => http.get('/b').subscribe({ error: r }));
    ctrl
      .expectOne('/b')
      .flush({ code: 'nope' }, { status: 403, statusText: 'Forbidden' });
    await b;
    expect(state.block()).toBeNull();
    expect(nav).not.toHaveBeenCalled();
  });
});
