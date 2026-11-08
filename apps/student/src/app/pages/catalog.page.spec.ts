import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideIonicAngular } from '@ionic/angular/standalone';
import { provideI18n } from '@codify/i18n';
import {
  CategoriesClient,
  CoursesClient,
  PlansClient,
  type CourseListItem,
} from '@codify/api-client';
import { signal } from '@angular/core';
import { AuthService } from '@codify/auth';
import { TelemetryService } from '../telemetry/telemetry.service';
import { PromotionsService } from '../components/promotions/promotions.service';
import {
  CatalogPage,
  DEFAULT_FILTERS,
  catalogQuery,
  plansForCourse,
} from './catalog.page';

const course = (id: string, title: string): CourseListItem =>
  ({
    id,
    slug: id,
    title,
    description: null,
    authorDisplayName: 'A',
    lessonCount: 1,
    estimatedMinutes: 5,
    difficulty: 1,
    categoryIds: ['cat1'],
  }) as CourseListItem;

describe('CatalogPage', () => {
  it('ignores a stale response when the category filter changes mid-flight', async () => {
    const pending: ((v: { items: CourseListItem[]; total: number }) => void)[] =
      [];
    const list = jest.fn(
      () =>
        new Promise<{ items: CourseListItem[]; total: number }>((r) =>
          pending.push(r),
        ),
    );
    await TestBed.configureTestingModule({
      imports: [CatalogPage],
      providers: [
        provideRouter([]),
        provideIonicAngular(),
        provideI18n(),
        { provide: AuthService, useValue: { user: signal({ id: 'u1' }) } },
        { provide: TelemetryService, useValue: { track: jest.fn() } },
        {
          provide: PromotionsService,
          useValue: {
            promoFor: () => null,
            ensureLoaded: jest.fn().mockResolvedValue(undefined),
          },
        },
        { provide: CoursesClient, useValue: { list } },
        {
          provide: CategoriesClient,
          useValue: {
            list: jest
              .fn()
              .mockResolvedValue({ items: [{ id: 'cat1', name: 'Web' }] }),
          },
        },
        {
          provide: PlansClient,
          useValue: { list: jest.fn().mockResolvedValue({ items: [] }) },
        },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(CatalogPage);
    const page = fixture.componentInstance as any;
    // request 1: "All" (from the constructor); request 2: category cat1
    page.setCategory('cat1');
    expect(list).toHaveBeenCalledTimes(2);
    expect((list.mock.calls[1] as unknown[])[0]).toMatchObject({
      categoryId: 'cat1',
    });
    pending[1]({ items: [course('new', 'Filtered')], total: 1 });
    await new Promise((r) => setTimeout(r, 0));
    pending[0]({ items: [course('old', 'Everything')], total: 1 });
    await new Promise((r) => setTimeout(r, 0));
    expect(page.courses().map((c: CourseListItem) => c.id)).toEqual(['new']);
    expect(page.loading()).toBe(false);
  });

  it('lists the plans that include a course', () => {
    const plans = [
      { name: 'All', isAllAccess: true, categoryIds: [], isActive: true },
      {
        name: 'Web',
        isAllAccess: false,
        categoryIds: ['cat1'],
        isActive: true,
      },
      {
        name: 'Data',
        isAllAccess: false,
        categoryIds: ['cat2'],
        isActive: true,
      },
      { name: 'Old', isAllAccess: true, categoryIds: [], isActive: false },
    ];
    expect(plansForCourse({ categoryIds: ['cat1'] }, plans)).toEqual([
      'All',
      'Web',
    ]);
  });

  it('maps filters to the server-side catalog query', () => {
    expect(catalogQuery(DEFAULT_FILTERS)).toEqual({
      status: 'PUBLISHED',
      take: 100,
    });
    expect(
      catalogQuery({
        q: ' react ',
        categoryId: 'c1',
        difficulty: 2,
        access: 'free',
        language: 'en-US',
        sort: 'popular',
      }),
    ).toEqual({
      status: 'PUBLISHED',
      take: 100,
      categoryId: 'c1',
      q: 'react',
      difficulty: 2,
      free: true,
      language: 'en-US',
      sort: 'popular',
    });
    expect(
      catalogQuery({ ...DEFAULT_FILTERS, access: 'premium' }),
    ).toMatchObject({ premium: true });
  });
});
