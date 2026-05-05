import { ProblemDetailsError, toProblemDetails } from './problem-details.js';

describe('ProblemDetailsError', () => {
  it('reports common HTTP class shortcuts', () => {
    expect(new ProblemDetailsError({ status: 401 }).isUnauthorized).toBe(true);
    expect(new ProblemDetailsError({ status: 403 }).isForbidden).toBe(true);
    expect(new ProblemDetailsError({ status: 404 }).isNotFound).toBe(true);
    expect(new ProblemDetailsError({ status: 422 }).isValidation).toBe(true);
    expect(new ProblemDetailsError({ status: 500 }).isServerError).toBe(true);
  });
});

describe('toProblemDetails', () => {
  it('passes through an existing ProblemDetailsError', () => {
    const original = new ProblemDetailsError({ status: 418, title: 'Teapot' });
    expect(toProblemDetails(original)).toBe(original);
  });

  it('maps a Nest-style HttpErrorResponse body', () => {
    const err = {
      status: 401,
      statusText: 'Unauthorized',
      error: { statusCode: 401, message: 'Authentication required', error: 'Unauthorized' },
    };
    const p = toProblemDetails(err);
    expect(p.status).toBe(401);
    expect(p.title).toBe('Unauthorized');
    expect(p.message).toContain('Authentication required');
    expect(p.isUnauthorized).toBe(true);
  });

  it('handles missing body gracefully', () => {
    const err = { status: 0, message: 'Network error' };
    const p = toProblemDetails(err);
    expect(p.status).toBe(0);
    expect(p.message).toContain('Network error');
  });

  it('promotes RFC 7807 fields when present', () => {
    const err = {
      status: 422,
      error: {
        type: 'urn:codify:validation',
        title: 'Validation failed',
        status: 422,
        detail: 'displayName too short',
        code: 'validation.failed',
        errors: { displayName: ['min length 1'] },
      },
    };
    const p = toProblemDetails(err);
    expect(p.title).toBe('Validation failed');
    expect(p.code).toBe('validation.failed');
    expect(p.errors?.['displayName']).toEqual(['min length 1']);
  });
});
