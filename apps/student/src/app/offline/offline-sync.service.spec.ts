import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import {
  GamificationClient,
  ProblemDetailsError,
  ProgressClient,
  QuizzesClient,
} from '@codify/api-client';
import { AuthService } from '@codify/auth';
import { RewardOrchestrator } from '@codify/gamification-engine';
import { I18nService } from '@codify/i18n';
import { buildQuizAnswerHashes } from '@codify/lesson-schema';
import { AppToastService } from '../platform/app-toast.service';
import { TelemetryService } from '../telemetry/telemetry.service';
import { DownloadService } from './download.service';
import {
  EVENT_QUEUE_STORE,
  createMemoryQueueStore,
  type EventQueueStore,
  type QueuedEvent,
} from './event-queue';
import { IdentityCacheService } from './identity-cache.service';
import { NetworkStatusService } from './network-status.service';
import {
  OfflineSyncService,
  SYNC_MAX_ATTEMPTS,
  backoffDelay,
  classifySyncFailure,
} from './offline-sync.service';

const problem = (
  status: number,
  code?: string,
  data?: Record<string, unknown>,
) => new ProblemDetailsError({ status, code, data });

const okResponse = (lessonId: string) => ({
  progress: {
    lessonId,
    completedAt: '2026-10-07T00:00:00Z',
    xpAwarded: 10,
    coinsAwarded: 2,
  },
  totals: { totalXp: 110, coins: 12 },
});

function ev(
  partial: Partial<QueuedEvent> & { lessonId: string; userId: string },
): QueuedEvent {
  return {
    kind: 'lesson_complete',
    clientEventId: `id-${partial.lessonId}-${partial.userId}`,
    clientTimestamp: Date.now() - 1000,
    attempts: 0,
    ...partial,
  } as QueuedEvent;
}

describe('OfflineSyncService', () => {
  let store: EventQueueStore;
  let online: ReturnType<typeof signal<boolean>>;
  let user: ReturnType<typeof signal<{ id: string } | null>>;
  let progress: { complete: jest.Mock };
  let quizzes: { submit: jest.Mock };
  let toast: { show: jest.Mock };
  let bundle: unknown;

  async function setup(
    initial: QueuedEvent[] = [],
    userId: string | null = 'u1',
  ) {
    store = createMemoryQueueStore(initial);
    online = signal(true);
    user = signal(userId ? { id: userId } : null);
    // Default: the server is down, so boot-time flushes leave events queued.
    progress = { complete: jest.fn().mockRejectedValue(problem(503)) };
    quizzes = { submit: jest.fn() };
    toast = { show: jest.fn() };
    bundle = null;
    TestBed.configureTestingModule({
      providers: [
        { provide: EVENT_QUEUE_STORE, useValue: store },
        {
          provide: NetworkStatusService,
          useValue: { online, metered: signal(false) },
        },
        { provide: AuthService, useValue: { user } },
        { provide: ProgressClient, useValue: progress },
        { provide: QuizzesClient, useValue: quizzes },
        {
          provide: GamificationClient,
          useValue: {
            summary: jest.fn().mockResolvedValue({
              totalXp: 1,
              coins: 2,
              level: 1,
              streak: { currentDays: 1, longestDays: 1, freezesAvailable: 0 },
            }),
          },
        },
        { provide: RewardOrchestrator, useValue: { reconcile: jest.fn() } },
        {
          provide: DownloadService,
          useValue: { getLessonBundle: jest.fn(async () => bundle) },
        },
        {
          provide: IdentityCacheService,
          useValue: { patch: jest.fn().mockResolvedValue(undefined) },
        },
        { provide: AppToastService, useValue: toast },
        { provide: TelemetryService, useValue: { track: jest.fn() } },
        { provide: I18nService, useValue: { t: (k: string) => k } },
      ],
    });
    const svc = TestBed.inject(OfflineSyncService);
    TestBed.tick();
    await settle();
    return svc;
  }

  async function settle(): Promise<void> {
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
  }

  afterEach(() => TestBed.resetTestingModule());

  describe('pure helpers', () => {
    it('backs off exponentially with jitter, capped', () => {
      expect(backoffDelay(1, () => 0)).toBe(1000);
      expect(backoffDelay(1, () => 1)).toBe(2000);
      expect(backoffDelay(3, () => 0)).toBe(4000);
      expect(backoffDelay(3, () => 1)).toBe(8000);
      expect(backoffDelay(50, () => 1)).toBe(5 * 60_000);
    });

    it.each([
      [0, undefined, 'retry'],
      [503, undefined, 'retry'],
      [429, 'QUIZ_ATTEMPT_COOLDOWN', 'retry'],
      [401, undefined, 'auth'],
      [402, 'payment_required', 'paywall'],
      [409, 'LESSON_ALREADY_COMPLETED', 'reconcile'],
      [409, 'QUIZ_REQUIRES_GRADING', 'rejected'],
      [400, 'CLIENT_TIMESTAMP_TOO_OLD', 'timestamp'],
      [400, 'validation.failed', 'rejected'],
      [403, undefined, 'rejected'],
      [404, undefined, 'rejected'],
    ])('classifies %s %s as %s', (status, code, kind) => {
      expect(
        classifySyncFailure(
          problem(status as number, code as string | undefined),
        ),
      ).toBe(kind);
    });
  });

  it('completes online and sends the clientTimestamp + idempotency key', async () => {
    const svc = await setup();
    progress.complete.mockResolvedValue(okResponse('l1'));
    const out = await svc.completeLesson('l1');
    expect(out.status).toBe('synced');
    const [lessonId, key, opts] = progress.complete.mock.calls[0];
    expect(lessonId).toBe('l1');
    expect(typeof key).toBe('string');
    expect(opts.clientTimestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(await store.size()).toBe(0);
    expect(svc.lastReconciled.lessonComplete()?.via).toBe('synced');
  });

  it('queues while offline and syncs exactly once when back online', async () => {
    const svc = await setup();
    online.set(false);
    TestBed.tick();
    const out = await svc.completeLesson('l1');
    expect(out.status).toBe('queued');
    expect(progress.complete).not.toHaveBeenCalled();
    expect(svc.pendingCount()).toBe(1);

    progress.complete.mockResolvedValue(okResponse('l1'));
    online.set(true);
    TestBed.tick();
    await settle();
    expect(progress.complete).toHaveBeenCalledTimes(1);
    expect(svc.pendingCount()).toBe(0);
    // No re-fire loop: further ticks don't call again.
    TestBed.tick();
    await settle();
    expect(progress.complete).toHaveBeenCalledTimes(1);
  });

  it('does not re-fire the flush in a loop on repeated failures', async () => {
    const svc = await setup();
    progress.complete.mockRejectedValue(problem(503));
    await svc.completeLesson('l1');
    TestBed.tick();
    await settle();
    expect(progress.complete).toHaveBeenCalledTimes(1);
    const [stored] = await store.list();
    expect(stored.attempts).toBe(1);
    expect(stored.nextAttemptAt).toBeGreaterThan(Date.now());
  });

  it('marks an event stuck after the max attempts and skips it automatically', async () => {
    // The boot flush fails once more (503) → max attempts reached.
    const svc = await setup([
      ev({ lessonId: 'l1', userId: 'u1', attempts: SYNC_MAX_ATTEMPTS - 1 }),
    ]);
    let [stored] = await store.list();
    expect(stored.stuck).toBe(true);
    progress.complete.mockClear();
    await svc.flush();
    expect(progress.complete).not.toHaveBeenCalled();
    // A manual "Sync now" still retries it.
    progress.complete.mockResolvedValue(okResponse('l1'));
    await svc.flush({ manual: true });
    expect(progress.complete).toHaveBeenCalledTimes(1);
    [stored] = await store.list();
    expect(stored).toBeUndefined();
  });

  it('only flushes the signed-in user’s events', async () => {
    const svc = await setup([], 'u1');
    await store.enqueue(ev({ lessonId: 'l1', userId: 'u1' }));
    await store.enqueue(ev({ lessonId: 'l2', userId: 'u2' }));
    progress.complete.mockImplementation(async (id: string) => okResponse(id));
    const res = await svc.flush();
    expect(res.synced).toBe(1);
    expect(progress.complete).toHaveBeenCalledTimes(1);
    expect(progress.complete.mock.calls[0][0]).toBe('l1');
    expect(await store.size()).toBe(1);
  });

  it('discards a different user’s queue on sign-in with a toast', async () => {
    const svc = await setup([ev({ lessonId: 'l1', userId: 'old-user' })], 'u1');
    expect(await store.size()).toBe(0);
    expect(toast.show).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'studentPlatform.sync.discardedOtherUser',
        params: { count: 1 },
      }),
    );
    expect(svc.pendingCount()).toBe(0);
  });

  it('keeps the queue on a forced sign-out and flushes when the same user returns', async () => {
    const svc = await setup([], 'u1');
    online.set(false);
    TestBed.tick();
    await svc.completeLesson('l1');
    user.set(null); // expired session → interceptor signed out
    TestBed.tick();
    await settle();
    expect(await store.size()).toBe(1);

    online.set(true);
    TestBed.tick();
    await settle();
    expect(progress.complete).not.toHaveBeenCalled(); // nobody signed in

    progress.complete.mockResolvedValue(okResponse('l1'));
    user.set({ id: 'u1' });
    TestBed.tick();
    await settle();
    expect(progress.complete).toHaveBeenCalledTimes(1);
    expect(await store.size()).toBe(0);
    expect(svc.pendingCount()).toBe(0);
  });

  it('blocks flushing on 401 until the same user signs in again', async () => {
    const svc = await setup([ev({ lessonId: 'l1', userId: 'u1' })], null);
    progress.complete.mockRejectedValue(problem(401));
    user.set({ id: 'u1' });
    TestBed.tick();
    await settle();
    expect(svc.authBlocked()).toBe(true);
    expect(await store.size()).toBe(1);
    const [stored] = await store.list();
    expect(stored.attempts).toBe(0);

    progress.complete.mockClear();
    await svc.flush();
    expect(progress.complete).not.toHaveBeenCalled();

    progress.complete.mockResolvedValue(okResponse('l1'));
    user.set(null);
    TestBed.tick();
    await settle();
    user.set({ id: 'u1' });
    TestBed.tick();
    await settle();
    expect(svc.authBlocked()).toBe(false);
    expect(await store.size()).toBe(0);
  });

  it('402 drops the event and returns a paywall outcome', async () => {
    const svc = await setup();
    progress.complete.mockRejectedValue(problem(402, 'payment_required'));
    const out = await svc.completeLesson('l1');
    expect(out.status).toBe('paywall');
    expect(await store.size()).toBe(0);
    expect(svc.paywall()?.lessonId).toBe('l1');
  });

  it.each([400, 403, 404])(
    '%s drops the event with an error toast in the background',
    async (status) => {
      const svc = await setup([ev({ lessonId: 'l1', userId: 'u1' })], null);
      progress.complete.mockRejectedValue(problem(status));
      user.set({ id: 'u1' });
      TestBed.tick();
      await settle();
      expect(await store.size()).toBe(0);
      expect(toast.show).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'studentPlatform.sync.dropped',
          kind: 'error',
        }),
      );
      expect(svc.pendingCount()).toBe(0);
    },
  );

  it('409 reconciles with the server’s original payload', async () => {
    const svc = await setup();
    progress.complete.mockRejectedValue(
      problem(
        409,
        'LESSON_ALREADY_COMPLETED',
        okResponse('l1') as unknown as Record<string, unknown>,
      ),
    );
    const out = await svc.completeLesson('l1');
    expect(out.status).toBe('conflict');
    expect(await store.size()).toBe(0);
    expect(svc.reconciled()?.response.totals.totalXp).toBe(110);
  });

  it('replays without clientTimestamp when the server rejects it as too old', async () => {
    const svc = await setup();
    progress.complete
      .mockRejectedValueOnce(problem(400, 'CLIENT_TIMESTAMP_TOO_OLD'))
      .mockResolvedValueOnce(okResponse('l1'));
    const out = await svc.completeLesson('l1');
    expect(out.status).toBe('synced');
    expect(progress.complete.mock.calls[1][2]).toEqual({});
  });

  it('does not enqueue a second completion for the same lesson', async () => {
    const svc = await setup();
    online.set(false);
    TestBed.tick();
    await svc.completeLesson('l1');
    await svc.completeLesson('l1');
    expect(await store.size()).toBe(1);
    expect(svc.pendingCount()).toBe(1);
  });

  it('clearForUser drops only that user’s events (explicit sign-out)', async () => {
    const svc = await setup([], 'u1');
    online.set(false);
    TestBed.tick();
    await svc.completeLesson('l1');
    await store.enqueue(ev({ lessonId: 'l9', userId: 'someone' }));
    expect(await svc.clearForUser('u1')).toBe(1);
    expect(await store.size()).toBe(1);
  });

  describe('submitQuiz', () => {
    beforeAll(() => {
      // jsdom has no SubtleCrypto; the hashes need the real WebCrypto.
      const { webcrypto } = require('node:crypto');
      Object.defineProperty(globalThis, 'crypto', {
        value: webcrypto,
        configurable: true,
      });
    });

    it('grades online via QuizzesClient', async () => {
      const svc = await setup();
      quizzes.submit.mockResolvedValue({
        attemptId: 'a',
        scorePct: 100,
        passed: true,
      });
      const out = await svc.submitQuiz('l1', { q1: ['a'] });
      expect(out.status).toBe('graded');
      expect(quizzes.submit.mock.calls[0][2].clientTimestamp).toBeDefined();
    });

    it('throws terminal errors online (e.g. cooldown is retryable, 402 is not)', async () => {
      const svc = await setup();
      quizzes.submit.mockRejectedValue(problem(402));
      await expect(svc.submitQuiz('l1', { q1: ['a'] })).rejects.toBeInstanceOf(
        ProblemDetailsError,
      );
    });

    it('offline: checks locally against the bundle hashes, queues, and grades on sync', async () => {
      const svc = await setup();
      const salt = 'salt-1';
      const doc = {
        type: 'doc',
        content: [
          {
            type: 'quiz',
            attrs: {
              id: 'q1',
              question: 'Q?',
              options: [
                { id: 'a', text: 'A' },
                { id: 'b', text: 'B' },
              ],
              correctOptionIds: ['b'],
            },
          },
        ],
      };
      const hashes = await buildQuizAnswerHashes(doc as never, salt);
      bundle = { quizAnswerHashes: { algorithm: 'sha256', salt, hashes } };
      online.set(false);
      TestBed.tick();

      const wrong = await svc.submitQuiz('l1', { q1: ['a'] });
      expect(wrong).toMatchObject({
        status: 'queued',
        localCheck: { allCorrect: false },
      });
      const right = await svc.submitQuiz('l1', { q1: ['b'] });
      expect(right).toMatchObject({
        status: 'queued',
        localCheck: { allCorrect: true },
      });
      // Best attempt replaces the older row (one per lesson).
      expect(await store.size()).toBe(1);
      const [row] = await store.list();
      expect(row.kind).toBe('quiz_attempt');

      quizzes.submit.mockResolvedValue({
        attemptId: 'x',
        scorePct: 100,
        passed: true,
      });
      online.set(true);
      TestBed.tick();
      await settle();
      expect(quizzes.submit).toHaveBeenCalledWith(
        'l1',
        { q1: ['b'] },
        expect.objectContaining({ clientTimestamp: expect.any(String) }),
      );
      expect(svc.lastReconciled.quizAttempt()?.result.passed).toBe(true);
      expect(await store.size()).toBe(0);
    });
  });
});
