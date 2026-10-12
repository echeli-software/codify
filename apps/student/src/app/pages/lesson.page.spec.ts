import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { signal } from '@angular/core';
import {
  ActivatedRoute,
  convertToParamMap,
  provideRouter,
} from '@angular/router';
import { provideIonicAngular } from '@ionic/angular/standalone';
import { of } from 'rxjs';
import { provideI18n } from '@codify/i18n';
import { provideAuth } from '@codify/auth';
import {
  CoursesClient,
  LessonsClient,
  PlansClient,
  ProblemDetailsError,
  ProgressClient,
  provideApiClient,
  type Lesson,
  type QuizAttemptResult,
} from '@codify/api-client';
import { RewardOrchestrator } from '@codify/gamification-engine';
import { OfflineSyncService } from '../offline/offline-sync.service';
import { DownloadService } from '../offline/download.service';
import { NetworkStatusService } from '../offline/network-status.service';
import { TelemetryService } from '../telemetry/telemetry.service';
import { LessonPage } from './lesson.page';

const LESSON_ID = 'lesson-1';

const quizLesson: Lesson = {
  id: LESSON_ID,
  moduleId: 'm1',
  courseId: 'c1',
  order: 0,
  type: 'QUIZ',
  isFree: true,
  estimatedMinutes: 3,
  baseXp: 20,
  baseCoins: 5,
  title: 'Quick quiz',
  contentJson: {
    type: 'doc',
    version: 1,
    content: [
      {
        type: 'quiz',
        attrs: {
          id: 'q1',
          question: '2 + 2?',
          kind: 'single',
          options: [
            { id: 'a', text: '3' },
            { id: 'b', text: '4' },
          ],
        },
      },
    ],
  },
  createdAt: '',
  updatedAt: '',
};

const reward = {
  xp: 20,
  coins: 5,
  multiplier: 2,
  xpMultiplier: 2,
  coinMultiplier: 1,
  breakdown: [{ source: 'PREMIUM_DEFAULT', multiplier: 2 }],
  totals: { totalXp: 120, coins: 40, level: 2 },
  levelUp: null,
  streak: { currentDays: 3, longestDays: 5, freezesAvailable: 1 },
};

function attempt(passed: boolean): QuizAttemptResult {
  return {
    attemptId: 'att',
    scorePct: passed ? 100 : 0,
    passed,
    correctCount: passed ? 1 : 0,
    totalCount: 1,
    passThresholdPct: 100,
    perQuestion: [
      {
        id: 'q1',
        correct: passed,
        correctOptionIds: passed ? ['b'] : undefined,
      },
    ],
    completion: passed
      ? {
          progress: {
            lessonId: LESSON_ID,
            completedAt: '',
            xpAwarded: 20,
            coinsAwarded: 5,
          },
          totals: { totalXp: 120, coins: 40 },
          reward,
          alreadyCompleted: false,
        }
      : undefined,
  };
}

const flush = async (fixture: ComponentFixture<LessonPage>) => {
  for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
  fixture.detectChanges();
  await fixture.whenStable();
};

describe('LessonPage state machine', () => {
  let lessons: { detail: jest.Mock };
  let sync: { submitQuiz: jest.Mock; completeLesson: jest.Mock };
  let downloads: { getLessonBundle: jest.Mock };
  let online: ReturnType<typeof signal<boolean>>;
  let grant: jest.Mock;
  let track: jest.Mock;
  let syncPaywall: ReturnType<
    typeof signal<{ lessonId: string; at: number } | null>
  >;

  async function create(): Promise<{
    fixture: ComponentFixture<LessonPage>;
    page: any;
  }> {
    const fixture = TestBed.createComponent(LessonPage);
    fixture.detectChanges();
    await flush(fixture);
    return { fixture, page: fixture.componentInstance as any };
  }

  beforeEach(async () => {
    lessons = { detail: jest.fn() };
    sync = { submitQuiz: jest.fn(), completeLesson: jest.fn() };
    downloads = { getLessonBundle: jest.fn().mockResolvedValue(null) };
    online = signal(true);
    grant = jest.fn().mockResolvedValue({});
    track = jest.fn();
    syncPaywall = signal(null);
    await TestBed.configureTestingModule({
      imports: [LessonPage],
      providers: [
        provideRouter([]),
        provideIonicAngular(),
        provideI18n(),
        provideAuth(),
        provideApiClient({ baseUrl: 'http://api.test' }),
        {
          provide: ActivatedRoute,
          useValue: {
            paramMap: of(convertToParamMap({ id: LESSON_ID })),
            snapshot: { paramMap: convertToParamMap({ id: LESSON_ID }) },
          },
        },
        { provide: LessonsClient, useValue: lessons },
        {
          provide: CoursesClient,
          useValue: { detail: jest.fn().mockRejectedValue(new Error('skip')) },
        },
        {
          provide: ProgressClient,
          useValue: { forCourse: jest.fn().mockResolvedValue({ items: [] }) },
        },
        {
          provide: PlansClient,
          useValue: {
            list: jest.fn().mockResolvedValue({
              items: [
                {
                  id: 'plan-1',
                  name: 'Pro',
                  isActive: true,
                  isAllAccess: false,
                  prices: [
                    {
                      id: 'price-1',
                      currency: 'BRL',
                      amountCents: 2990,
                      period: 'MONTHLY',
                      maxInstallments: null,
                      isActive: true,
                    },
                  ],
                },
              ],
            }),
          },
        },
        {
          provide: OfflineSyncService,
          useValue: {
            ...sync,
            pendingCount: signal(0),
            paywall: syncPaywall,
            lastReconciled: {
              lessonComplete: signal(null),
              quizAttempt: signal(null),
            },
          },
        },
        {
          provide: DownloadService,
          useValue: {
            ...downloads,
            markRead: jest.fn().mockResolvedValue(undefined),
            downloads: signal([]),
          },
        },
        { provide: NetworkStatusService, useValue: { online } },
        { provide: TelemetryService, useValue: { track } },
        {
          provide: RewardOrchestrator,
          useValue: { grant, toast: signal(null), reconcile: jest.fn() },
        },
      ],
    }).compileComponents();
  });

  it('402 → paywall listing the plans that unlock the lesson', async () => {
    lessons.detail.mockRejectedValue(
      new ProblemDetailsError({
        status: 402,
        data: { requiredPlans: [{ id: 'plan-1', slug: 'pro', name: 'Pro' }] },
      }),
    );
    const { fixture, page } = await create();
    expect(page.state()).toBe('paywall');
    expect(page.requiredPlans()).toEqual([
      { id: 'plan-1', slug: 'pro', name: 'Pro' },
    ]);
    const el: HTMLElement = fixture.nativeElement;
    expect(
      el.querySelector('[data-testid=lesson-paywall] [data-plan-id="plan-1"]'),
    ).toBeTruthy();
    expect(
      page.paywallContent()?.plans.map((p: { id: string }) => p.id),
    ).toEqual(['price-1']);
    expect(track).toHaveBeenCalledWith(
      'paywall_view',
      expect.objectContaining({ lessonId: LESSON_ID }),
    );
  });

  it('404 → not-found state', async () => {
    lessons.detail.mockRejectedValue(new ProblemDetailsError({ status: 404 }));
    const { fixture, page } = await create();
    expect(page.state()).toBe('notFound');
    expect(
      fixture.nativeElement.querySelector('[data-testid=lesson-not-found]'),
    ).toBeTruthy();
  });

  it('offline and not downloaded → offline state (no API call)', async () => {
    online.set(false);
    const { fixture, page } = await create();
    expect(lessons.detail).not.toHaveBeenCalled();
    expect(page.state()).toBe('offlineMissing');
    expect(
      fixture.nativeElement.querySelector('[data-testid=lesson-offline]'),
    ).toBeTruthy();
  });

  it('offline with a downloaded bundle → reads from the cache', async () => {
    online.set(false);
    downloads.getLessonBundle.mockResolvedValue({
      lessonId: LESSON_ID,
      courseId: 'c1',
      title: 'Quick quiz',
      type: 'QUIZ',
      isFree: true,
      baseXp: 20,
      baseCoins: 5,
      contentJson: quizLesson.contentJson,
      sizeBytes: 10,
    });
    const { fixture, page } = await create();
    expect(page.state()).toBe('ready');
    expect(page.fromCache()).toBe(true);
    expect(
      fixture.nativeElement.querySelector('[data-testid=offline-read]'),
    ).toBeTruthy();
  });

  it('network failure online falls back to the download cache', async () => {
    lessons.detail.mockRejectedValue(new ProblemDetailsError({ status: 0 }));
    const { page } = await create();
    expect(downloads.getLessonBundle).toHaveBeenCalledWith(LESSON_ID);
    expect(page.state()).toBe('offlineMissing');
  });

  it('other errors → retryable error state', async () => {
    lessons.detail.mockRejectedValue(new ProblemDetailsError({ status: 500 }));
    const { page } = await create();
    expect(page.state()).toBe('error');
    expect(page.errorKey()).toBe('studentPlatform.errors.server');
  });

  it('quiz fail → feedback + retry, no reward', async () => {
    lessons.detail.mockResolvedValue(quizLesson);
    sync.submitQuiz.mockResolvedValue({
      status: 'graded',
      result: attempt(false),
    });
    const { fixture, page } = await create();
    page.answers.set({ q1: ['a'] });
    fixture.detectChanges();
    expect(page.canSubmitQuiz()).toBe(true);
    await page.submitQuiz();
    await flush(fixture);
    expect(sync.submitQuiz).toHaveBeenCalledWith(LESSON_ID, { q1: ['a'] });
    expect(page.quizResult()?.passed).toBe(false);
    expect(page.completion()).toBeNull();
    expect(grant).not.toHaveBeenCalled();
    expect(
      fixture.nativeElement.querySelector('[data-testid=quiz-retry]'),
    ).toBeTruthy();
    page.retryQuiz();
    expect(page.quizResult()).toBeNull();
    expect(page.answers()).toEqual({});
  });

  it('quiz pass → completed + one reward grant with canonical totals', async () => {
    lessons.detail.mockResolvedValue(quizLesson);
    sync.submitQuiz.mockResolvedValue({
      status: 'graded',
      result: attempt(true),
    });
    const { fixture, page } = await create();
    page.answers.set({ q1: ['b'] });
    await page.submitQuiz();
    await flush(fixture);
    expect(page.quizResult()?.passed).toBe(true);
    expect(page.completion()).toEqual({ xp: 20, coins: 5, queued: false });
    expect(grant).toHaveBeenCalledTimes(1);
    expect(grant.mock.calls[0][0]).toMatchObject({
      kind: 'quizPass',
      canonical: { xp: 20, coins: 5, multiplier: 2 },
      totals: {
        totalXp: 120,
        coins: 40,
        level: 2,
        streakDays: 3,
        freezesAvailable: 1,
      },
    });
    expect(track).toHaveBeenCalledWith(
      'lesson_complete',
      expect.objectContaining({ lessonId: LESSON_ID, alreadyCompleted: false }),
    );
    expect(
      fixture.nativeElement.querySelector('[data-testid=lesson-completed]'),
    ).toBeTruthy();
  });

  it('quiz 402 while submitting → paywall', async () => {
    lessons.detail.mockResolvedValue(quizLesson);
    sync.submitQuiz.mockRejectedValue(
      new ProblemDetailsError({ status: 402, data: { requiredPlans: [] } }),
    );
    const { fixture, page } = await create();
    page.answers.set({ q1: ['b'] });
    await page.submitQuiz();
    await flush(fixture);
    expect(page.state()).toBe('paywall');
  });

  it('offline quiz → queued with local check', async () => {
    lessons.detail.mockResolvedValue(quizLesson);
    sync.submitQuiz.mockResolvedValue({
      status: 'queued',
      clientEventId: 'e1',
      localCheck: { allCorrect: true, correct: 1, total: 1 },
    });
    const { fixture, page } = await create();
    page.answers.set({ q1: ['b'] });
    await page.submitQuiz();
    await flush(fixture);
    expect(page.quizQueued()).toBe(true);
    expect(page.completion()).toEqual({ xp: 20, coins: 5, queued: true });
    expect(grant).not.toHaveBeenCalled();
  });

  it('reading lesson: completeLesson 402 outcome → paywall', async () => {
    lessons.detail.mockResolvedValue({
      ...quizLesson,
      type: 'READING',
      contentJson: {
        type: 'doc',
        version: 1,
        content: [{ type: 'paragraph' }],
      },
    });
    sync.completeLesson.mockResolvedValue({
      status: 'paywall',
      lessonId: LESSON_ID,
      error: new ProblemDetailsError({ status: 402 }),
    });
    const { fixture, page } = await create();
    await page.completeLesson();
    await flush(fixture);
    expect(page.state()).toBe('paywall');
  });

  it('background sync 402 for this lesson → paywall', async () => {
    lessons.detail.mockResolvedValue(quizLesson);
    const { fixture, page } = await create();
    syncPaywall.set({ lessonId: LESSON_ID, at: Date.now() });
    await flush(fixture);
    expect(page.state()).toBe('paywall');
  });
});
