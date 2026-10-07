import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import {
  CoursesClient,
  EnrollmentsClient,
  LessonsClient,
  ProblemDetailsError,
  TranslationsClient,
  type CourseDetail,
} from '@codify/api-client';
import { I18nService } from '@codify/i18n';
import { TelemetryService } from '../telemetry/telemetry.service';
import { AssetCacheService } from './asset-cache.service';
import {
  DownloadService,
  autoDownloadSelection,
  planEviction,
  type DownloadRecord,
} from './download.service';
import {
  NetworkStatusService,
  type ConnectionType,
} from './network-status.service';

const rec = (
  courseId: string,
  totalBytes: number,
  lastReadAt: number,
): DownloadRecord => ({
  courseId,
  courseSlug: courseId,
  title: courseId,
  lessonCount: 1,
  totalBytes,
  status: 'complete',
  downloadedAt: 0,
  lastReadAt,
  sourceUpdatedAt: '2026-01-01T00:00:00Z',
});

const detail: CourseDetail = {
  id: 'c1',
  slug: 'c1',
  title: 'Course 1',
  updatedAt: '2026-10-01T00:00:00Z',
  modules: [
    {
      id: 'm1',
      order: 1,
      title: 'M1',
      lessons: [
        {
          id: 'l1',
          order: 1,
          type: 'READING',
          isFree: true,
          estimatedMinutes: 1,
          title: 'L1',
        },
        {
          id: 'l2',
          order: 2,
          type: 'QUIZ',
          isFree: false,
          estimatedMinutes: 1,
          title: 'L2',
        },
      ],
    },
    {
      id: 'm2',
      order: 2,
      title: 'M2',
      lessons: [
        {
          id: 'l3',
          order: 1,
          type: 'READING',
          isFree: false,
          estimatedMinutes: 1,
          title: 'L3',
        },
      ],
    },
  ],
} as unknown as CourseDetail;

describe('download planning', () => {
  it('evicts least-recently-read courses first and never the one being downloaded', () => {
    const plan = planEviction(
      [rec('a', 100, 3), rec('b', 100, 1), rec('c', 100, 2)],
      150,
      'b',
    );
    expect(plan.evict.map((r) => r.courseId)).toEqual(['c', 'a']);
    expect(plan.insufficient).toBe(false);
  });

  it('flags when evicting everything still is not enough', () => {
    const plan = planEviction([rec('a', 10, 1)], 500, null);
    expect(plan.insufficient).toBe(true);
  });

  it('auto-download selects free lessons + the first module with paid lessons', () => {
    expect(autoDownloadSelection(detail).sort()).toEqual(['l1', 'l2']);
  });
});

describe('DownloadService', () => {
  let online: ReturnType<typeof signal<boolean>>;
  let type: ReturnType<typeof signal<ConnectionType>>;
  let offlineBundle: jest.Mock;

  function setup() {
    online = signal(true);
    type = signal<ConnectionType>('wifi');
    offlineBundle = jest.fn(async (id: string) => ({
      lesson: {
        id,
        courseId: 'c1',
        moduleId: 'm1',
        order: 1,
        type: 'READING',
        isFree: true,
        title: id,
        baseXp: 1,
        baseCoins: 1,
        estimatedMinutes: 1,
        updatedAt: 'v1',
      },
      doc: { type: 'doc', content: [] },
      quizAnswerHashes: { algorithm: 'sha256', salt: 's', hashes: {} },
      imageSrcs: [],
      updatedAt: 'v1',
    }));
    TestBed.configureTestingModule({
      providers: [
        {
          provide: NetworkStatusService,
          useValue: {
            online,
            connectionType: type,
            metered: () => type() === 'cellular',
          },
        },
        {
          provide: CoursesClient,
          useValue: { detail: jest.fn().mockResolvedValue(detail) },
        },
        {
          provide: LessonsClient,
          useValue: {
            offlineBundle,
            lessonVersions: jest.fn().mockResolvedValue([]),
          },
        },
        {
          provide: EnrollmentsClient,
          useValue: { mine: jest.fn().mockResolvedValue([]) },
        },
        {
          provide: TranslationsClient,
          useValue: { resolve: jest.fn().mockResolvedValue({ items: {} }) },
        },
        { provide: I18nService, useValue: { currentLocale: () => 'pt-BR' } },
        {
          provide: AssetCacheService,
          useValue: {
            cacheUrls: jest
              .fn()
              .mockResolvedValue({ cached: [], bytes: 0, failed: [] }),
            removeUrls: jest.fn(),
            clear: jest.fn(),
          },
        },
        { provide: TelemetryService, useValue: { track: jest.fn() } },
      ],
    });
    try {
      localStorage.removeItem('codify.downloads.prefs');
    } catch {
      /* ignore */
    }
    const svc = TestBed.inject(DownloadService);
    TestBed.tick();
    return svc;
  }

  afterEach(() => TestBed.resetTestingModule());

  it('downloads every lesson and reports complete status', async () => {
    const svc = setup();
    const out = await svc.downloadCourse('c1');
    expect(offlineBundle).toHaveBeenCalledTimes(3);
    expect(out?.status).toBeDefined();
    expect(svc.status('c1')().state).not.toBe('downloading');
  });

  it('Wi-Fi only: waits on cellular and resumes on Wi-Fi', async () => {
    const svc = setup();
    type.set('cellular');
    TestBed.tick();
    const p = svc.downloadCourse('c1');
    await p;
    expect(svc.status('c1')().state).toBe('waitingForWifi');
    expect(offlineBundle).not.toHaveBeenCalled();
    type.set('wifi');
    TestBed.tick();
    for (let i = 0; i < 50 && offlineBundle.mock.calls.length < 3; i += 1) {
      await new Promise((r) => setTimeout(r, 0));
    }
    expect(offlineBundle).toHaveBeenCalledTimes(3);
  });

  it('pause stops after the current lesson; resume continues', async () => {
    const svc = setup();
    offlineBundle.mockImplementationOnce(async (id: string) => {
      svc.pause('c1');
      return {
        lesson: {
          id,
          courseId: 'c1',
          moduleId: 'm1',
          order: 1,
          type: 'READING',
          isFree: true,
          title: id,
          baseXp: 1,
          baseCoins: 1,
          estimatedMinutes: 1,
          updatedAt: 'v1',
        },
        doc: {},
        quizAnswerHashes: { algorithm: 'sha256', salt: 's', hashes: {} },
        imageSrcs: [],
        updatedAt: 'v1',
      };
    });
    await svc.downloadCourse('c1');
    expect(offlineBundle).toHaveBeenCalledTimes(1);
    expect(svc.status('c1')().state).toBe('paused');
    await svc.resume('c1');
    expect(offlineBundle).toHaveBeenCalledTimes(3);
  });

  it('treats 402 lessons as locked (skipped), not as a failure', async () => {
    const svc = setup();
    offlineBundle.mockImplementation(async (id: string) => {
      if (id !== 'l1') throw new ProblemDetailsError({ status: 402 });
      return {
        lesson: {
          id,
          courseId: 'c1',
          moduleId: 'm1',
          order: 1,
          type: 'READING',
          isFree: true,
          title: id,
          baseXp: 1,
          baseCoins: 1,
          estimatedMinutes: 1,
          updatedAt: 'v1',
        },
        doc: {},
        quizAnswerHashes: { algorithm: 'sha256', salt: 's', hashes: {} },
        imageSrcs: [],
        updatedAt: 'v1',
      };
    });
    await svc.downloadCourse('c1');
    expect(svc.recordFor('c1')?.lockedLessonIds?.sort()).toEqual(['l2', 'l3']);
    expect(svc.status('c1')().state).not.toBe('error');
  });

  it('asks before evicting when over budget, and declining keeps everything', async () => {
    const svc = setup();
    svc.downloads.set([rec('old', 900, 1)]);
    svc.setPrefs({ budgetBytes: 500 });
    expect(svc.spaceRequest()?.evict.map((r) => r.courseId)).toEqual(['old']);
    svc.resolveSpaceRequest(false);
    await Promise.resolve();
    expect(svc.downloads().map((r) => r.courseId)).toEqual(['old']);
    expect(svc.spaceRequest()).toBeNull();
  });
});
