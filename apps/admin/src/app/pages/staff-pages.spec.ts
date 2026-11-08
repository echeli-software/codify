import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideI18n } from '@codify/i18n';
import { AuthService } from '@codify/auth';
import { ConfirmDialogService, ToastService } from '@codify/ui-bootstrap';
import {
  AnalyticsClient,
  ReportsClient,
  StaffToolsClient,
  type OverviewReport,
} from '@codify/api-client';
import { AnalyticsPage, completionRate } from './analytics.page';
import { ExerciseHealthPage, failureSummary } from './exercise-health.page';

const overview: OverviewReport = {
  generatedAt: '2026-11-08T00:00:00.000Z',
  retention: [
    {
      cohortStart: '2026-10-26T00:00:00.000Z',
      size: 10,
      d1: 0.5,
      d7: null,
      d30: null,
      eligible: { d1: 10, d7: 0, d30: 0 },
    },
  ],
  leagues: [
    {
      weekStart: '2026-11-02T00:00:00.000Z',
      members: 4,
      activeMembers: 3,
      activeStudents: 6,
      participation: 0.5,
      promoted: 1,
      demoted: 0,
    },
  ],
  shop: [
    {
      weekStart: '2026-11-02T00:00:00.000Z',
      coinsSpent: 450,
      purchases: 3,
      buyers: 2,
    },
  ],
  billing: {
    mrr: {
      currency: 'BRL',
      amountCents: 3990,
      byPlan: [
        {
          planId: 'p',
          planName: 'Pro',
          amountCents: 3990,
          subscriptions: 1,
          excluded: 0,
        },
      ],
    },
    weeks: [
      {
        weekStart: '2026-11-02T00:00:00.000Z',
        newPaid: 2,
        churned: 1,
        netNew: 1,
      },
    ],
    trialToPaid: { trialsEnded: 4, converted: 1, rate: 0.25 },
    arppu: [
      { currency: 'BRL', revenueCents: 7980, payingUsers: 2, arppuCents: 3990 },
    ],
    refunds: [
      {
        currency: 'BRL',
        paidCents: 7980,
        refundedCents: 3990,
        payments: 2,
        refundedPayments: 1,
        rate: 0.5,
      },
    ],
  },
};

const settle = () => new Promise((r) => setTimeout(r, 0));

describe('staff pages helpers', () => {
  it('completionRate and failureSummary', () => {
    expect(completionRate({ enrolled: 4, completed: 1 })).toBe(0.25);
    expect(completionRate({ enrolled: 0, completed: 0 })).toBe(0);
    expect(
      failureSummary({ FAIL: 1, ERROR: 0, TIMEOUT: 3, MEMORY: 0, RUNTIME: 0 }),
    ).toEqual([
      { verdict: 'TIMEOUT', count: 3 },
      { verdict: 'FAIL', count: 1 },
    ]);
  });
});

describe('AnalyticsPage', () => {
  async function mount(role: 'ADMIN' | 'TEACHER') {
    const reports = {
      overview: jest.fn().mockResolvedValue(overview),
      courses: jest.fn().mockResolvedValue({
        items: [
          {
            courseId: 'c1',
            slug: 'js',
            title: 'JS',
            status: 'PUBLISHED',
            lessons: 2,
            enrolled: 4,
            started: 2,
            completed: 1,
          },
        ],
      }),
      course: jest.fn().mockResolvedValue({
        course: {
          courseId: 'c1',
          slug: 'js',
          title: 'JS',
          status: 'PUBLISHED',
          lessons: 2,
          enrolled: 4,
          started: 2,
          completed: 1,
        },
        lessons: [
          {
            lessonId: 'l1',
            title: 'One',
            position: 1,
            type: 'READING',
            opened: 3,
            completed: 2,
            dropOff: 0,
            dropOffRate: null,
          },
          {
            lessonId: 'l2',
            title: 'Two',
            position: 2,
            type: 'QUIZ',
            opened: 2,
            completed: 1,
            dropOff: 1,
            dropOffRate: 0.5,
          },
        ],
      }),
    };
    await TestBed.configureTestingModule({
      imports: [AnalyticsPage],
      providers: [
        provideRouter([]),
        provideI18n(),
        { provide: ReportsClient, useValue: reports },
        {
          provide: AnalyticsClient,
          useValue: { summary: jest.fn().mockResolvedValue([]) },
        },
        {
          provide: AuthService,
          useValue: { role: () => role, whenReady: () => Promise.resolve() },
        },
        { provide: ToastService, useValue: { error: jest.fn() } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(AnalyticsPage);
    fixture.detectChanges();
    await settle();
    await settle();
    fixture.detectChanges();
    return { fixture, reports };
  }

  it('ADMIN: overview with billing KPIs and a table for every chart', async () => {
    const { fixture, reports } = await mount('ADMIN');
    const el: HTMLElement = fixture.nativeElement;
    expect(reports.overview).toHaveBeenCalledWith(false);
    expect(
      el.querySelector('[data-testid="billing-kpis"]')?.textContent,
    ).toContain('25');
    for (const id of [
      'mrr-by-plan',
      'subs-weeks',
      'retention-table',
      'league-table',
      'shop-table',
    ])
      expect(el.querySelector(`[data-testid="${id}"]`)).not.toBeNull();
    // Every chart carries its own data table too.
    expect(el.querySelectorAll('cdf-bar-chart').length).toBe(3);
  });

  it('TEACHER: only course funnels, with lesson drop-off on demand', async () => {
    const { fixture, reports } = await mount('TEACHER');
    const el: HTMLElement = fixture.nativeElement;
    expect(reports.overview).not.toHaveBeenCalled();
    expect(
      el.querySelector('[data-testid="analytics-tab-overview"]'),
    ).toBeNull();
    expect(
      el.querySelector('[data-testid="course-funnels"]')?.textContent,
    ).toContain('JS');
    (
      el.querySelector(
        '[data-course="c1"] button, [data-course="c1"]',
      ) as HTMLElement
    ).click();
    await settle();
    fixture.detectChanges();
    expect(reports.course).toHaveBeenCalledWith('c1');
    expect(
      el.querySelector('[data-testid="lesson-funnel"]')?.textContent,
    ).toContain('Two');
  });
});

describe('ExerciseHealthPage', () => {
  it('lists exercises and queues a language re-test after confirmation', async () => {
    const staff = {
      exerciseHealth: jest.fn().mockResolvedValue({
        languages: ['javascript'],
        items: [
          {
            exerciseId: 'e1',
            lessonId: 'l1',
            lessonTitle: 'Sum',
            courseId: 'c1',
            courseTitle: 'JS',
            language: 'javascript',
            attempts: 5,
            learners: 3,
            passers: 2,
            passRate: 2 / 3,
            avgAttemptsToPass: 1.5,
            failures: { FAIL: 2, ERROR: 0, TIMEOUT: 1, MEMORY: 0, RUNTIME: 0 },
            topFailingTests: [
              { testId: 'v1', name: 'adds negatives', count: 2 },
            ],
          },
        ],
      }),
      retests: jest.fn().mockResolvedValue({ items: [] }),
      retest: jest.fn().mockResolvedValue({
        jobId: 'j1',
        language: 'javascript',
        status: 'queued',
        actorId: 'a',
        total: 1,
        done: 0,
        passed: 0,
        failed: 0,
        queuedAt: '2026-11-08T00:00:00.000Z',
        startedAt: null,
        finishedAt: null,
        error: null,
        results: [],
      }),
    };
    const confirm = { open: jest.fn().mockResolvedValue(true) };
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [ExerciseHealthPage],
      providers: [
        provideRouter([]),
        provideI18n(),
        { provide: StaffToolsClient, useValue: staff },
        { provide: ConfirmDialogService, useValue: confirm },
        {
          provide: ToastService,
          useValue: { success: jest.fn(), error: jest.fn() },
        },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(ExerciseHealthPage);
    fixture.detectChanges();
    await settle();
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(
      el.querySelector('[data-testid="exercise-health"]')?.textContent,
    ).toContain('adds negatives');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const page = fixture.componentInstance as any;
    page.language.set('javascript');
    await page.retest();
    expect(confirm.open).toHaveBeenCalled();
    expect(staff.retest).toHaveBeenCalledWith('javascript');
    expect(page.jobs()[0].jobId).toBe('j1');
    fixture.destroy();
  });
});
