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
  type CourseSort,
  type ListCoursesQuery,
  PlansClient,
  type Plan,
} from '@codify/api-client';
import { AuthService } from '@codify/auth';
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
import { NetworkStatusService } from '../offline/network-status.service.js';
import { withResponseCache } from '../offline/response-cache.js';
import { CachedDataChip } from '../offline/cached-data-chip.component.js';
import { TelemetryService } from '../telemetry/telemetry.service.js';

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
  coverUrl: string | null;
  hasFreePreview: boolean;
  premiumOnly: boolean;
}

/** Catalog filters (docs/05 Learn → Catalog). */
export interface CatalogFilters {
  q: string;
  categoryId: string | null;
  difficulty: number | null;
  /** 'free' = free preview available; 'premium' = subscription only. */
  access: 'all' | 'free' | 'premium';
  language: string | null;
  sort: CourseSort;
}

export const DEFAULT_FILTERS: CatalogFilters = {
  q: '',
  categoryId: null,
  difficulty: null,
  access: 'all',
  language: null,
  sort: 'recommended',
};

/** Filters → `GET /courses` query (server-side search / filter / sort). */
export function catalogQuery(f: CatalogFilters): ListCoursesQuery {
  const q = f.q.trim();
  return {
    status: 'PUBLISHED',
    take: 100,
    ...(f.categoryId ? { categoryId: f.categoryId } : {}),
    ...(q ? { q } : {}),
    ...(f.difficulty ? { difficulty: f.difficulty } : {}),
    ...(f.access === 'free' ? { free: true } : {}),
    ...(f.access === 'premium' ? { premium: true } : {}),
    ...(f.language ? { language: f.language } : {}),
    ...(f.sort !== 'recommended' ? { sort: f.sort } : {}),
  };
}

/** Stable cache key of a filter set (offline: last result per filter). */
export function catalogCacheKey(f: CatalogFilters): string {
  return `catalog:${JSON.stringify(catalogQuery(f))}`;
}

export const CATALOG_SORTS: readonly CourseSort[] = [
  'recommended',
  'newest',
  'popular',
  'shortest',
];
export const CATALOG_LANGUAGES = ['pt-BR', 'en-US'] as const;

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
 * Student catalog (docs/05 §3 Learn → Catalog). Search (debounced), the
 * category tabs, filter chips (difficulty, free preview, premium only,
 * language) and the sort drive a server-side query; every change goes
 * through a `StaleGuard`, so a slow response for an old filter can never
 * replace the results of the current one. The last response per filter is
 * cached per user and shown offline with an "Offline" chip (docs/16 §3).
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
    CachedDataChip,
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
            (query)="setSearch($event)"
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

        <div
          class="catalog__filters"
          role="group"
          [attr.aria-label]="'student.catalog.filtersLabel' | translate"
          data-testid="catalog-filters"
        >
          @for (lv of levels; track lv) {
            <button
              type="button"
              class="catalog__chip"
              [attr.aria-pressed]="filters().difficulty === lv"
              [attr.data-filter-level]="lv"
              (click)="toggleLevel(lv)"
            >
              {{ 'student.catalog.level' | translate: { level: lv } }}
            </button>
          }
          <button
            type="button"
            class="catalog__chip"
            data-testid="filter-free"
            [attr.aria-pressed]="filters().access === 'free'"
            (click)="toggleAccess('free')"
          >
            {{ 'student.catalog.filterFree' | translate }}
          </button>
          <button
            type="button"
            class="catalog__chip"
            data-testid="filter-premium"
            [attr.aria-pressed]="filters().access === 'premium'"
            (click)="toggleAccess('premium')"
          >
            {{ 'student.catalog.filterPremium' | translate }}
          </button>
          <label class="catalog__select">
            <span>{{ 'student.catalog.language' | translate }}</span>
            <select
              data-testid="filter-language"
              [value]="filters().language ?? ''"
              (change)="setLanguage($any($event.target).value)"
            >
              <option value="">
                {{ 'student.catalog.anyLanguage' | translate }}
              </option>
              @for (l of languages; track l) {
                <option [value]="l" [selected]="filters().language === l">
                  {{ 'student.catalog.languageName.' + l | translate }}
                </option>
              }
            </select>
          </label>
          <label class="catalog__select">
            <span>{{ 'student.catalog.sort' | translate }}</span>
            <select
              data-testid="catalog-sort"
              (change)="setSort($any($event.target).value)"
            >
              @for (o of sorts; track o) {
                <option [value]="o" [selected]="filters().sort === o">
                  {{ 'student.catalog.sortBy.' + o | translate }}
                </option>
              }
            </select>
          </label>
          @if (filtered()) {
            <button
              type="button"
              class="catalog__clear"
              data-testid="filters-clear"
              (click)="clearFilters()"
            >
              {{ 'student.catalog.clearFilters' | translate }}
            </button>
          }
        </div>

        <cdf-cached-data-chip [savedAt]="fromCache()" />

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
                (filtered()
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
                      [hasFreePreview]="c.hasFreePreview"
                      [premiumOnly]="c.premiumOnly"
                      [coverUrl]="c.coverUrl"
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
      .catalog__filters {
        display: flex;
        flex-wrap: wrap;
        gap: var(--cdf-space-1);
        align-items: center;
        margin-bottom: var(--cdf-space-2);
      }
      .catalog__chip,
      .catalog__clear {
        border: 1px solid var(--cdf-color-border);
        background: var(--cdf-color-surface);
        color: var(--cdf-color-text);
        border-radius: 999px;
        padding: 4px 12px;
        min-height: 36px;
        font: inherit;
        font-size: var(--cdf-font-size-sm);
        cursor: pointer;
      }
      .catalog__chip[aria-pressed='true'] {
        background: var(--cdf-color-primary-subtle, #eef2ff);
        border-color: var(--cdf-color-primary);
        color: var(--cdf-color-primary);
        font-weight: 600;
      }
      .catalog__clear {
        border-color: transparent;
        text-decoration: underline;
      }
      .catalog__select {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-size: var(--cdf-font-size-sm);
        color: var(--cdf-color-text-muted);
      }
      .catalog__select select {
        min-height: 36px;
        border-radius: 8px;
        border: 1px solid var(--cdf-color-border);
        background: var(--cdf-color-surface);
        color: var(--cdf-color-text);
        font: inherit;
        padding: 0 6px;
        max-width: 160px;
      }
      .catalog__chip:focus-visible,
      .catalog__clear:focus-visible,
      .catalog__select select:focus-visible {
        outline: 2px solid var(--cdf-color-primary);
        outline-offset: 2px;
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
  private readonly auth = inject(AuthService);
  private readonly network = inject(NetworkStatusService);
  private readonly telemetry = inject(TelemetryService);
  private readonly guard = new StaleGuard();

  protected readonly panelId = 'catalog-panel';
  protected readonly levels = [1, 2, 3, 4, 5];
  protected readonly sorts = CATALOG_SORTS;
  protected readonly languages = CATALOG_LANGUAGES;
  protected readonly loading = signal(true);
  protected readonly errorKey = signal<string | null>(null);
  /** Epoch ms of the cached list shown offline, or null when live. */
  protected readonly fromCache = signal<number | null>(null);
  protected readonly courses = signal<CourseListItem[]>([]);
  protected readonly categories = signal<Category[]>([]);
  protected readonly plans = signal<Plan[]>([]);
  protected readonly filters = signal<CatalogFilters>({ ...DEFAULT_FILTERS });
  protected readonly activeCategoryId = computed(
    () => this.filters().categoryId,
  );
  protected readonly skeletonRows = Array.from({ length: 8 }, (_, i) => i);
  protected readonly filtered = computed(() => {
    const f = this.filters();
    return (
      !!f.q.trim() ||
      !!f.categoryId ||
      !!f.difficulty ||
      f.access !== 'all' ||
      !!f.language
    );
  });

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
    this.i18n.currentLocale();
    return this.courses().map((c) => ({
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
      coverUrl: c.coverUrl ?? null,
      hasFreePreview: c.hasFreePreview === true,
      premiumOnly: c.hasFreePreview === false && c.lessonCount > 0,
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
    if (this.filters().categoryId === id) return;
    this.patch({ categoryId: id });
  }

  protected setSearch(q: string): void {
    if (q.trim() === this.filters().q.trim()) return;
    this.patch({ q });
  }

  protected toggleLevel(level: number): void {
    this.patch({
      difficulty: this.filters().difficulty === level ? null : level,
    });
  }

  protected toggleAccess(access: 'free' | 'premium'): void {
    this.patch({ access: this.filters().access === access ? 'all' : access });
  }

  protected setLanguage(lang: string): void {
    this.patch({ language: lang || null });
  }

  protected setSort(sort: string): void {
    if ((CATALOG_SORTS as readonly string[]).includes(sort))
      this.patch({ sort: sort as CourseSort });
  }

  protected clearFilters(): void {
    this.patch({ ...DEFAULT_FILTERS, sort: this.filters().sort });
  }

  private patch(p: Partial<CatalogFilters>): void {
    this.filters.update((f) => ({ ...f, ...p }));
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

  private get userId(): string | null {
    return this.auth.user()?.id ?? null;
  }

  private async loadCategories(): Promise<void> {
    try {
      const res = await withResponseCache(
        this.userId,
        'catalog:categories',
        this.network.online(),
        () => this.categoriesClient.list({ take: 100 }),
      );
      this.categories.set(res.value.items);
    } catch {
      // Non-fatal: the "All" tab still works without category tabs.
      this.categories.set([]);
    }
  }

  private async loadPlans(): Promise<void> {
    try {
      const res = await withResponseCache(
        this.userId,
        'catalog:plans',
        this.network.online(),
        () => this.plansClient.list(),
      );
      this.plans.set(res.value.items);
    } catch {
      // Non-fatal: the "included in" chips are a hint only.
      this.plans.set([]);
    }
  }

  private async loadCourses(): Promise<void> {
    const f = this.filters();
    this.loading.set(true);
    this.errorKey.set(null);
    const res = await this.guard.run(() =>
      withResponseCache(
        this.userId,
        catalogCacheKey(f),
        this.network.online(),
        () => this.coursesClient.list(catalogQuery(f)),
      ),
    );
    if (res.stale) return;
    if (res.ok) {
      this.courses.set(res.value.value.items);
      this.fromCache.set(res.value.fromCache);
      if (f.q.trim() && !res.value.fromCache)
        this.telemetry.track('catalog_search', {
          results: res.value.value.items.length,
          length: f.q.trim().length,
        });
    } else {
      this.courses.set([]);
      this.fromCache.set(null);
      this.errorKey.set(errorMessageKey(res.error));
    }
    this.loading.set(false);
  }
}
