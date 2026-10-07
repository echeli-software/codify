import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonRefresher,
  IonRefresherContent,
  type RefresherCustomEvent,
} from '@ionic/angular/standalone';
import {
  CategoriesClient,
  type Category,
  CoursesClient,
  type CourseListItem,
  PlansClient,
  type Plan,
} from '@codify/api-client';
import { ContentTranslatePipe, I18nService, TranslatePipe } from '@codify/i18n';
import {
  AppSkeleton,
  CourseCard,
  type CourseCategoryRef,
  EmptyState,
  ErrorState,
  SearchBar,
} from '@codify/ui-ionic';
import { errorMessageKey } from '../platform/app-toast.service.js';
import { StaleGuard } from './shared/stale-guard.js';

interface CourseCardVM {
  id: string;
  slug: string;
  title: string;
  author: string;
  lessonCount: number;
  estimatedMinutes: number;
  difficulty: string;
  categories: CourseCategoryRef[];
  plans: string[];
}

/** Plans (names) that unlock a course: all-access or a shared category. */
export function plansForCourse(
  course: Pick<CourseListItem, 'categoryIds'>,
  plans: readonly Pick<
    Plan,
    'name' | 'isAllAccess' | 'categoryIds' | 'isActive'
  >[],
): string[] {
  return plans
    .filter(
      (p) =>
        p.isActive &&
        (p.isAllAccess ||
          p.categoryIds.some((c) => course.categoryIds.includes(c))),
    )
    .map((p) => p.name);
}

/**
 * Student catalog (docs/05 §3 Learn → Catalog). Category tabs drive a
 * server-side filtered list; every filter change goes through a
 * `StaleGuard`, so a slow response for an old tab can never replace the
 * results of the current one. Search filters the loaded page client-side.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonContent,
    IonRefresher,
    IonRefresherContent,
    AppSkeleton,
    CourseCard,
    EmptyState,
    ErrorState,
    SearchBar,
    TranslatePipe,
    ContentTranslatePipe,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-title>{{ 'student.catalog.title' | translate }}</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content class="ion-padding">
      <ion-refresher slot="fixed" (ionRefresh)="onRefresh($event)">
        <ion-refresher-content />
      </ion-refresher>

      <div class="catalog">
        <div class="catalog__top">
          <cdf-search-bar
            [placeholder]="'student.catalog.searchPlaceholder' | translate"
            [ariaLabel]="'student.catalog.searchLabel' | translate"
            (query)="search.set($event)"
          />
          <a
            class="catalog__mine"
            routerLink="/my-courses"
            data-testid="my-courses-link"
            >{{ 'student.myCourses.title' | translate }}</a
          >
        </div>

        <div
          class="catalog__tabs"
          role="tablist"
          [attr.aria-label]="'student.catalog.categoriesLabel' | translate"
        >
          @for (tab of tabs(); track tab.id ?? 'all') {
            <button
              type="button"
              role="tab"
              class="catalog__tab"
              [id]="tabId(tab.id)"
              [attr.aria-selected]="activeCategoryId() === tab.id"
              [attr.aria-controls]="panelId"
              [attr.tabindex]="activeCategoryId() === tab.id ? 0 : -1"
              [attr.data-category-id]="tab.id"
              (click)="setCategory(tab.id)"
              (keydown)="onTabKey($event)"
            >
              @if (tab.id === null) {
                {{ 'student.catalog.all' | translate }}
              } @else {
                {{ tab.id | tContent: 'CATEGORY' : 'name' : tab.name }}
              }
            </button>
          }
        </div>

        <section
          role="tabpanel"
          [id]="panelId"
          [attr.aria-labelledby]="tabId(activeCategoryId())"
          [attr.aria-busy]="loading()"
          tabindex="0"
          class="catalog__panel"
        >
          @if (errorKey(); as e) {
            <cdf-error-state
              [title]="'student.catalog.loadError' | translate"
              [description]="e | translate"
              [retrying]="loading()"
              (retry)="reload()"
            />
          } @else if (loading()) {
            <div class="catalog__grid">
              @for (_ of skeletonRows; track $index) {
                <cdf-app-skeleton shape="rect" [height]="180" />
              }
            </div>
          } @else if (cards().length === 0) {
            <cdf-empty-state
              icon="school"
              [title]="
                (search() || activeCategoryId()
                  ? 'student.catalog.emptyFiltered'
                  : 'student.catalog.empty'
                ) | translate
              "
              [description]="'student.catalog.emptyHint' | translate"
            />
          } @else {
            <p class="catalog__count" role="status">
              {{
                'student.catalog.count' | translate: { count: cards().length }
              }}
            </p>
            <ul class="catalog__grid" data-testid="catalog-grid">
              @for (c of cards(); track c.id) {
                <li>
                  <a
                    class="catalog__card"
                    [routerLink]="['/courses', c.slug]"
                    [attr.data-course-slug]="c.slug"
                  >
                    <cdf-course-card
                      [title]="c.id | tContent: 'COURSE' : 'title' : c.title"
                      [author]="c.author"
                      [lessonCount]="c.lessonCount"
                      [estimatedMinutes]="c.estimatedMinutes"
                      [difficulty]="c.difficulty"
                      [categories]="c.categories"
                      [hasFreePreview]="false"
                    />
                    @if (c.plans.length > 0) {
                      <span class="catalog__plans">
                        {{
                          'billing.includedIn'
                            | translate: { plans: c.plans.join(', ') }
                        }}
                      </span>
                    }
                  </a>
                </li>
              }
            </ul>
          }
        </section>
      </div>
    </ion-content>
  `,
  styles: [
    `
      .catalog {
        max-width: 1280px;
        margin: 0 auto;
      }
      .catalog__top {
        display: flex;
        gap: var(--cdf-space-2);
        align-items: center;
        flex-wrap: wrap;
      }
      .catalog__top cdf-search-bar {
        flex: 1 1 260px;
      }
      .catalog__mine {
        font-weight: 600;
        color: var(--cdf-color-primary);
      }
      .catalog__tabs {
        display: flex;
        gap: var(--cdf-space-1);
        overflow-x: auto;
        padding: var(--cdf-space-2) 0;
        margin-bottom: var(--cdf-space-2);
      }
      .catalog__tab {
        flex: 0 0 auto;
        border: 1px solid var(--cdf-color-border);
        background: var(--cdf-color-surface);
        color: var(--cdf-color-text);
        border-radius: 999px;
        padding: 6px 14px;
        font: inherit;
        font-size: var(--cdf-font-size-sm);
        cursor: pointer;
        min-height: 36px;
      }
      .catalog__tab[aria-selected='true'] {
        background: var(--cdf-color-primary);
        color: var(--cdf-color-on-primary, #fff);
        border-color: transparent;
      }
      .catalog__tab:focus-visible,
      .catalog__card:focus-visible,
      .catalog__panel:focus-visible {
        outline: 2px solid var(--cdf-color-primary);
        outline-offset: 2px;
      }
      .catalog__count {
        margin: 0 0 var(--cdf-space-2);
        color: var(--cdf-color-text-muted);
        font-size: var(--cdf-font-size-sm);
      }
      .catalog__grid {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        gap: var(--cdf-space-3);
        grid-template-columns: 1fr;
      }
      @media (min-width: 480px) {
        .catalog__grid {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
      }
      @media (min-width: 768px) {
        .catalog__grid {
          grid-template-columns: repeat(3, minmax(0, 1fr));
        }
      }
      @media (min-width: 1024px) {
        .catalog__grid {
          grid-template-columns: repeat(4, minmax(0, 1fr));
        }
      }
      .catalog__card {
        display: flex;
        flex-direction: column;
        gap: 4px;
        text-decoration: none;
        color: inherit;
        border-radius: var(--cdf-radius-lg, 12px);
      }
      .catalog__plans {
        font-size: var(--cdf-font-size-xs);
        color: var(--cdf-color-text-muted);
        padding: 0 var(--cdf-space-2);
      }
      @media (hover: hover) {
        .catalog__card:hover cdf-course-card {
          transform: translateY(-2px);
          transition: transform 150ms ease;
        }
      }
    `,
  ],
})
export class CatalogPage {
  private readonly coursesClient = inject(CoursesClient);
  private readonly categoriesClient = inject(CategoriesClient);
  private readonly plansClient = inject(PlansClient);
  private readonly i18n = inject(I18nService);
  private readonly guard = new StaleGuard();

  protected readonly panelId = 'catalog-panel';
  protected readonly loading = signal(true);
  protected readonly errorKey = signal<string | null>(null);
  protected readonly courses = signal<CourseListItem[]>([]);
  protected readonly categories = signal<Category[]>([]);
  protected readonly plans = signal<Plan[]>([]);
  protected readonly activeCategoryId = signal<string | null>(null);
  protected readonly search = signal('');
  protected readonly skeletonRows = Array.from({ length: 8 }, (_, i) => i);

  protected readonly tabs = computed(() => [
    { id: null as string | null, name: '' },
    ...this.categories().map((c) => ({
      id: c.id as string | null,
      name: c.name,
    })),
  ]);

  private readonly categoryById = computed(() => {
    const map = new Map<string, Category>();
    for (const c of this.categories()) map.set(c.id, c);
    return map;
  });

  protected readonly cards = computed<CourseCardVM[]>(() => {
    const lookup = this.categoryById();
    const plans = this.plans();
    const q = this.search().trim().toLowerCase();
    this.i18n.currentLocale();
    return this.courses()
      .filter(
        (c) =>
          !q ||
          c.title.toLowerCase().includes(q) ||
          (c.description ?? '').toLowerCase().includes(q) ||
          c.authorDisplayName.toLowerCase().includes(q),
      )
      .map((c) => ({
        id: c.id,
        slug: c.slug,
        title: c.title,
        author: c.authorDisplayName,
        lessonCount: c.lessonCount,
        estimatedMinutes: c.estimatedMinutes,
        difficulty: c.difficulty
          ? this.i18n.t('student.catalog.level', { level: c.difficulty })
          : '',
        categories: c.categoryIds
          .map((id) => lookup.get(id))
          .filter((x): x is Category => !!x)
          .map((cat) => ({ id: cat.id, label: cat.name })),
        plans: plansForCourse(c, plans),
      }));
  });

  constructor() {
    inject(DestroyRef).onDestroy(() => this.guard.cancel());
    void this.loadCategories();
    void this.loadPlans();
    void this.loadCourses();
  }

  protected tabId(id: string | null): string {
    return `catalog-tab-${id ?? 'all'}`;
  }

  protected setCategory(id: string | null): void {
    if (this.activeCategoryId() === id) return;
    this.activeCategoryId.set(id);
    void this.loadCourses();
  }

  /** Roving focus between tabs (WAI-ARIA tabs pattern). */
  protected onTabKey(ev: KeyboardEvent): void {
    const tabs = this.tabs();
    const idx = tabs.findIndex((t) => t.id === this.activeCategoryId());
    let next = idx;
    if (ev.key === 'ArrowRight') next = (idx + 1) % tabs.length;
    else if (ev.key === 'ArrowLeft')
      next = (idx - 1 + tabs.length) % tabs.length;
    else if (ev.key === 'Home') next = 0;
    else if (ev.key === 'End') next = tabs.length - 1;
    else return;
    ev.preventDefault();
    const target = tabs[next];
    this.setCategory(target.id);
    queueMicrotask(() =>
      (
        document.getElementById(this.tabId(target.id)) as HTMLElement | null
      )?.focus(),
    );
  }

  protected reload(): void {
    void this.loadCourses();
  }

  protected async onRefresh(ev: RefresherCustomEvent): Promise<void> {
    await Promise.all([
      this.loadCategories(),
      this.loadPlans(),
      this.loadCourses(),
    ]);
    await ev.target.complete();
  }

  private async loadCategories(): Promise<void> {
    try {
      const res = await this.categoriesClient.list({ take: 100 });
      this.categories.set(res.items);
    } catch {
      // Non-fatal: the "All" tab still works without category tabs.
      this.categories.set([]);
    }
  }

  private async loadPlans(): Promise<void> {
    try {
      this.plans.set((await this.plansClient.list()).items);
    } catch {
      // Non-fatal: the "included in" chips are a hint only.
      this.plans.set([]);
    }
  }

  private async loadCourses(): Promise<void> {
    const categoryId = this.activeCategoryId();
    this.loading.set(true);
    this.errorKey.set(null);
    const res = await this.guard.run(() =>
      this.coursesClient.list({
        status: 'PUBLISHED',
        ...(categoryId ? { categoryId } : {}),
        take: 100,
      }),
    );
    if (res.stale) return;
    if (res.ok) {
      this.courses.set(res.value.items);
    } else {
      this.courses.set([]);
      this.errorKey.set(errorMessageKey(res.error));
    }
    this.loading.set(false);
  }
}
