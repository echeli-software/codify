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
import { CatalogPage, plansForCourse } from './catalog.page';

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
});
