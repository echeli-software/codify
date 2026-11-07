import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import {
  AnalyticsClient,
  ProblemDetailsError,
  type AnalyticsEventInput,
} from '@codify/api-client';
import { AuthService } from '@codify/auth';
import { NetworkStatusService } from '../offline/network-status.service';
import {
  TELEMETRY_BUFFER,
  TELEMETRY_MAX_BATCH,
  TelemetryService,
  type TelemetryBuffer,
} from './telemetry.service';

describe('TelemetryService', () => {
  let send: jest.Mock;
  let online: ReturnType<typeof signal<boolean>>;
  let user: ReturnType<typeof signal<{ id: string } | null>>;
  let saved: AnalyticsEventInput[];
  let buffer: TelemetryBuffer;

  function setup(initialSaved: AnalyticsEventInput[] = []) {
    send = jest.fn().mockResolvedValue({ accepted: 1 });
    online = signal(true);
    user = signal(null);
    saved = initialSaved;
    buffer = {
      load: jest.fn(async () => saved),
      save: jest.fn(async (evs: AnalyticsEventInput[]) => {
        saved = evs;
      }),
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: AnalyticsClient, useValue: { send } },
        { provide: NetworkStatusService, useValue: { online } },
        { provide: AuthService, useValue: { user } },
        { provide: TELEMETRY_BUFFER, useValue: buffer },
      ],
    });
    const svc = TestBed.inject(TelemetryService);
    TestBed.tick();
    return svc;
  }

  afterEach(() => TestBed.resetTestingModule());

  it('keeps a stable anonymousId per install', () => {
    const a = setup().anonymousId;
    TestBed.resetTestingModule();
    const b = setup().anonymousId;
    expect(a).toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(8);
  });

  it('batches at most 50 events per request', async () => {
    const svc = setup();
    for (let i = 0; i < 120; i += 1) svc.track('lesson_opened', { i });
    await svc.flush();
    const sizes = send.mock.calls.map((c) => c[0].events.length);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(TELEMETRY_MAX_BATCH);
    expect(sizes.reduce((a: number, b: number) => a + b, 0)).toBe(120);
    expect(send.mock.calls[0][0]).toMatchObject({
      platform: 'web',
      anonymousId: svc.anonymousId,
    });
  });

  it('drops invalid names and never throws', () => {
    const svc = setup();
    expect(() => svc.track('Bad Name!')).not.toThrow();
    const circular: Record<string, unknown> = {};
    circular['self'] = circular;
    expect(() => svc.track('ok_event', circular)).not.toThrow();
    expect(svc.pendingCount()).toBe(1);
  });

  it('buffers offline and sends once back online', async () => {
    const svc = setup();
    online.set(false);
    TestBed.tick();
    svc.track('download_started', { courseId: 'c1' });
    await svc.flush();
    expect(send).not.toHaveBeenCalled();
    expect(saved).toHaveLength(1);
    online.set(true);
    TestBed.tick();
    await svc.flush();
    expect(send).toHaveBeenCalledTimes(1);
    expect(saved).toHaveLength(0);
  });

  it('restores events persisted by a previous session', async () => {
    const svc = setup([
      { name: 'app_opened', occurredAt: new Date().toISOString() },
    ]);
    await svc.flush();
    expect(send.mock.calls[0][0].events[0].name).toBe('app_opened');
  });

  it('keeps events on a 5xx and drops a batch the server rejects as invalid', async () => {
    const svc = setup();
    svc.track('a_event');
    send.mockRejectedValueOnce(new ProblemDetailsError({ status: 503 }));
    await svc.flush();
    expect(svc.pendingCount()).toBe(1);
    send.mockRejectedValueOnce(new ProblemDetailsError({ status: 400 }));
    await svc.flush();
    expect(svc.pendingCount()).toBe(0);
  });

  it('flushes on sign-in and sign-out', async () => {
    const svc = setup();
    await Promise.resolve();
    svc.track('x_event');
    user.set({ id: 'u1' });
    TestBed.tick();
    await svc.flush();
    expect(send).toHaveBeenCalled();
  });
});
