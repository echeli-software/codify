import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { ProblemDetailsError } from '@codify/api-client';
import { I18nService, provideI18n } from '@codify/i18n';
import { ToastService } from '@codify/ui-bootstrap';
import {
  AdminErrors,
  contentIssuesOf,
  formatResolvedError,
  resolveError,
  validationProblemsOf,
} from './errors';

const problem = (p: ConstructorParameters<typeof ProblemDetailsError>[0]) =>
  new ProblemDetailsError(p);

describe('resolveError', () => {
  it('maps known problem codes to their own key', () => {
    const r = resolveError(
      problem({ status: 400, code: 'ASSET_TYPE_NOT_ALLOWED', detail: 'svg' }),
      'admin.errors.saveFailed',
    );
    expect(r.key).toBe('admin.errors.code.ASSET_TYPE_NOT_ALLOWED');
    expect(r.detail).toBeNull();
  });

  it('keeps the list of problems for rubric / scenario validation', () => {
    const r = resolveError(
      problem({
        status: 400,
        code: 'INVALID_RUBRIC',
        detail: 'Invalid rubric: a; b',
      }),
      'x',
    );
    expect(r.key).toBe('admin.errors.code.INVALID_RUBRIC');
    expect(r.detail).toBe('Invalid rubric: a; b');
  });

  it('surfaces the API message on a 403 (e.g. the SUPPORT 31-day cap)', () => {
    const msg =
      'Support can grant at most 31 days; ask an admin for longer grants';
    const r = resolveError(
      problem({ status: 403, code: 'auth.forbidden', detail: msg }),
      'x',
    );
    expect(r.key).toBe('admin.errors.forbidden');
    expect(r.detail).toBe(msg);
  });

  it('drops generic details that add nothing', () => {
    const r = resolveError(
      problem({ status: 403, detail: 'Forbidden resource' }),
      'x',
    );
    expect(r.detail).toBeNull();
  });

  it.each([
    [0, 'admin.errors.network'],
    [401, 'admin.errors.unauthorized'],
    [404, 'admin.errors.notFound'],
    [409, 'admin.errors.conflict'],
    [413, 'admin.errors.code.ASSET_TOO_LARGE'],
    [422, 'admin.errors.validation'],
    [429, 'admin.errors.rateLimited'],
    [503, 'admin.errors.server'],
  ])('status %s → %s', (status, key) => {
    expect(resolveError(problem({ status }), 'x').key).toBe(key);
  });

  it('normalises raw HttpErrorResponses', () => {
    const http = new HttpErrorResponse({
      status: 409,
      error: { status: 409, code: 'conflict.unique', detail: 'dup' },
    });
    expect(resolveError(http, 'x').key).toBe(
      'admin.errors.code.conflict_unique',
    );
  });

  it('falls back to the operation key for non-HTTP errors', () => {
    expect(resolveError(new Error('boom'), 'admin.errors.saveFailed')).toEqual({
      key: 'admin.errors.saveFailed',
      detail: null,
      status: 0,
      code: null,
    });
  });
});

describe('formatResolvedError', () => {
  const t = (k: string, p?: Record<string, unknown>) =>
    p ? `${k}(${JSON.stringify(p)})` : k;

  it('returns the translated message alone without detail', () => {
    expect(
      formatResolvedError({ key: 'k', detail: null, status: 0, code: null }, t),
    ).toBe('k');
  });

  it('appends the detail through admin.errors.withDetail', () => {
    expect(
      formatResolvedError(
        { key: 'k', detail: 'd', status: 403, code: null },
        t,
      ),
    ).toBe('admin.errors.withDetail({"message":"k","detail":"d"})');
  });
});

describe('problem payload helpers', () => {
  it('reads lesson content issues from the 400 body', () => {
    const err = new HttpErrorResponse({
      status: 400,
      error: {
        status: 400,
        detail: 'invalid',
        issues: [
          { path: 'content.0', code: 'invalid_type', message: 'Expected' },
        ],
      },
    });
    expect(contentIssuesOf(err)).toEqual([
      { path: 'content.0', code: 'invalid_type', message: 'Expected' },
    ]);
    expect(contentIssuesOf(new Error('x'))).toEqual([]);
  });

  it('splits INVALID_SCENARIO detail into problems', () => {
    const err = problem({
      status: 400,
      code: 'INVALID_SCENARIO',
      detail: 'Invalid scenario: start node is missing; scenario has no ending',
    });
    expect(validationProblemsOf(err, 'INVALID_SCENARIO')).toEqual([
      'start node is missing',
      'scenario has no ending',
    ]);
    expect(validationProblemsOf(err, 'INVALID_RUBRIC')).toEqual([]);
  });

  it('prefers the API problems list over the joined detail', () => {
    const err = problem({
      status: 400,
      code: 'INVALID_RUBRIC',
      detail: 'Invalid rubric: a; b; with a semicolon',
      data: { problems: ['a', 'b; with a semicolon'] },
    });
    expect(validationProblemsOf(err, 'INVALID_RUBRIC')).toEqual([
      'a',
      'b; with a semicolon',
    ]);
  });
});

describe('AdminErrors', () => {
  it('translates and raises toasts', () => {
    const error = jest.fn();
    TestBed.configureTestingModule({
      providers: [
        provideI18n(),
        { provide: ToastService, useValue: { error } },
      ],
    });
    TestBed.inject(I18nService).setLocale('en-US');
    const svc = TestBed.inject(AdminErrors);
    expect(svc.message(problem({ status: 401 }))).toBe(
      'Your session expired. Please sign in again.',
    );
    svc.toast(problem({ status: 400, code: 'ASSET_TOO_LARGE' }));
    expect(error).toHaveBeenCalledWith('The file is too large.');
  });
});
