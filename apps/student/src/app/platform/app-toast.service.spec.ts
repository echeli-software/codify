import { TestBed } from '@angular/core/testing';
import { ProblemDetailsError } from '@codify/api-client';
import { AppToastService, errorMessageKey } from './app-toast.service';

describe('errorMessageKey', () => {
  const p = (status: number, code?: string) =>
    new ProblemDetailsError({ status, code });

  it.each([
    [p(0), 'network'],
    [p(400), 'validation'],
    [p(401), 'unauthorized'],
    [p(402), 'paywall'],
    [p(403), 'forbidden'],
    [p(404), 'notFound'],
    [p(409), 'conflict'],
    [p(429), 'rateLimited'],
    [p(500), 'server'],
    [p(503), 'unavailable'],
    [p(429, 'QUIZ_ATTEMPT_COOLDOWN'), 'quizCooldown'],
    [p(409, 'device.rebind_required'), 'deviceRebind'],
    [p(409, 'LESSON_ALREADY_COMPLETED'), 'alreadyCompleted'],
    [{ status: 404, error: { code: 'not_found' } }, 'notFound'],
    [new Error('boom'), 'unknown'],
    ['weird', 'unknown'],
  ])('maps %p to %s', (err, key) => {
    expect(errorMessageKey(err)).toBe(`studentPlatform.errors.${key}`);
  });
});

describe('AppToastService', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('shows, auto-dismisses and caps visible toasts', () => {
    const svc = TestBed.inject(AppToastService);
    svc.show({ message: 'a', kind: 'info', durationMs: 1000 });
    expect(svc.toasts()).toHaveLength(1);
    jest.advanceTimersByTime(1001);
    expect(svc.toasts()).toHaveLength(0);
    for (let i = 0; i < 5; i += 1)
      svc.show({ message: `m${i}`, kind: 'success' });
    expect(svc.toasts().map((t) => t.message)).toEqual(['m2', 'm3', 'm4']);
  });

  it('error() maps the problem to a translated key', () => {
    const svc = TestBed.inject(AppToastService);
    svc.error(new ProblemDetailsError({ status: 403 }));
    expect(svc.toasts()[0]).toMatchObject({
      kind: 'error',
      message: 'studentPlatform.errors.forbidden',
    });
  });
});
