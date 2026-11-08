import { TestBed } from '@angular/core/testing';
import { HttpRequest } from '@angular/common/http';
import { signal } from '@angular/core';
import type { ActivatedRouteSnapshot } from '@angular/router';
import { AuthService } from '@codify/auth';
import { I18nService } from '@codify/i18n';
import { AnalyticsClient } from '@codify/api-client';
import {
  AdminTelemetry,
  FLUSH_DELAY_MS,
  FLUSH_SIZE,
  apiPath,
  featureEventFor,
  routePattern,
} from './telemetry';

const req = (method: string, url: string, body: unknown = null) =>
  new HttpRequest(method, url, body);

describe('featureEventFor', () => {
  it('maps admin mutations to docs/04 §8 events', () => {
    expect(featureEventFor(req('POST', 'http://x/api/courses', {}))).toEqual({
      name: 'course_created',
      props: {},
    });
    expect(
      featureEventFor(req('POST', '/api/courses/c%201/publish', {})),
    ).toEqual({ name: 'course_published', props: { courseId: 'c 1' } });
    expect(featureEventFor(req('POST', '/api/multipliers', {}))?.name).toBe(
      'multiplier_created',
    );
    expect(
      featureEventFor(req('POST', '/api/admin/users/u1/suspend', {}))?.name,
    ).toBe('user_suspended');
    expect(
      featureEventFor(
        req('POST', '/api/admin/users/u1/grants', { coins: 50, reason: 'x' }),
      ),
    ).toEqual({ name: 'coins_granted', props: { amount: 50 } });
    expect(
      featureEventFor(
        req('POST', '/api/admin/users/u1/grants', { xp: 5, reason: 'x' }),
      ),
    ).toEqual({ name: 'coins_granted', props: { xp: 5 } });
    expect(
      featureEventFor(
        req('PUT', '/api/admin/translations', { items: [1, 2, 3] }),
      ),
    ).toEqual({ name: 'translation_completed', props: { count: 3 } });
    expect(
      featureEventFor(
        req('POST', '/api/admin/translations/complete', { items: [1, 2] }),
      ),
    ).toEqual({
      name: 'translation_completed',
      props: { via: 'mark_complete', count: 2 },
    });
    expect(
      featureEventFor(
        req('POST', '/api/admin/translations/import', {
          entityType: 'LESSON',
          locale: 'en-US',
          dryRun: false,
        }),
      ),
    ).toEqual({
      name: 'translation_completed',
      props: { via: 'import', entityType: 'LESSON', locale: 'en-US' },
    });
    expect(
      featureEventFor(
        req('POST', '/api/admin/translations/import', { dryRun: true }),
      ),
    ).toBeNull();
  });

  it('ignores reads, other paths and non-API urls', () => {
    expect(featureEventFor(req('GET', '/api/courses'))).toBeNull();
    expect(featureEventFor(req('PATCH', '/api/courses/x', {}))).toBeNull();
    expect(
      featureEventFor(req('POST', '/api/analytics/events', {})),
    ).toBeNull();
    expect(featureEventFor(req('POST', 'https://cdn/x', {}))).toBeNull();
  });

  it('extracts the API path', () => {
    expect(apiPath('http://h:3000/api/users?x=1')).toBe('/users');
    expect(apiPath('/elsewhere')).toBeNull();
  });
});

describe('routePattern', () => {
  it('joins the configured paths down to the deepest child', () => {
    const leaf = { routeConfig: { path: 'users/:id' }, firstChild: null };
    const shell = { routeConfig: { path: '' }, firstChild: leaf };
    const root = { routeConfig: null, firstChild: shell };
    expect(routePattern(root as unknown as ActivatedRouteSnapshot)).toBe(
      '/users/:id',
    );
  });
});

describe('AdminTelemetry', () => {
  let send: jest.Mock;
  let svc: AdminTelemetry;

  beforeEach(() => {
    jest.useFakeTimers();
    send = jest.fn(async () => ({ accepted: 1 }));
    TestBed.configureTestingModule({
      providers: [
        { provide: AnalyticsClient, useValue: { send } },
        { provide: AuthService, useValue: { role: signal('ADMIN') } },
        { provide: I18nService, useValue: { currentLocale: signal('en-US') } },
      ],
    });
    svc = TestBed.inject(AdminTelemetry);
  });

  afterEach(() => jest.useRealTimers());

  it('batches after a delay, adding role + locale', () => {
    svc.track('admin_page_view', { route: '/dashboard' });
    svc.track('course_created');
    expect(send).not.toHaveBeenCalled();
    jest.advanceTimersByTime(FLUSH_DELAY_MS);
    expect(send).toHaveBeenCalledTimes(1);
    const batch = send.mock.calls[0][0];
    expect(batch.platform).toBe('admin-web');
    expect(batch.events).toHaveLength(2);
    expect(batch.events[0]).toMatchObject({
      name: 'admin_page_view',
      props: { route: '/dashboard', role: 'ADMIN', locale: 'en-US' },
    });
  });

  it('flushes immediately once the batch is full', () => {
    for (let i = 0; i < FLUSH_SIZE; i += 1) svc.track('admin_page_view');
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0].events).toHaveLength(FLUSH_SIZE);
  });

  it('never throws when the ingest fails', async () => {
    send.mockRejectedValueOnce(new Error('offline'));
    svc.track('course_created');
    expect(() => svc.flush()).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
  });
});
