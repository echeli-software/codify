import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonGrid,
  IonRow,
  IonCol,
  IonChip,
  IonLabel,
  IonRefresher,
  IonRefresherContent,
  type RefresherCustomEvent,
} from '@ionic/angular/standalone';
import {
  CategoriesClient,
  type Category,
  CoursesClient,
  type CourseListItem,
} from '@codify/api-client';
import {
  AppSkeleton,
  AppCard,
  CourseCard,
  type CourseCategoryRef,
  EmptyState,
} from '@codify/ui-ionic';

const DIFFICULTY_LABEL = ['', 'Lvl 1', 'Lvl 2', 'Lvl 3', 'Lvl 4', 'Lvl 5'];

interface CourseCardVM {
  id: string;
  slug: string;
  title: string;
  author: string;
  lessonCount: number;
  estimatedMinutes: number;
  difficulty: string;
  categories: CourseCategoryRef[];
  hasFreePreview: boolean;
}

/**
 * Student catalog tab. Lists PUBLISHED courses (server-enforced for
 * STUDENT role) as a responsive CourseCard grid, optionally filtered by
 * a single category chip. The filter signal feeds an effect() that calls
 * CoursesClient.list({ categoryId }) — server does the work, client just
 * binds the result.
 *
 * Routes each card to `/courses/:slug` for the curriculum view.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonContent,
    IonGrid,
    IonRow,
    IonCol,
    IonChip,
    IonLabel,
    IonRefresher,
    IonRefresherContent,
    AppSkeleton,
    AppCard,
    CourseCard,
    EmptyState,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-title>Catalog</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content class="ion-padding">
      <ion-refresher slot="fixed" (ionRefresh)="onRefresh($event)">
        <ion-refresher-content />
      </ion-refresher>

      <!-- Category filter chips -->
      <div class="catalog-filters" role="tablist" aria-label="Categories">
        <ion-chip
          [class.active]="activeCategoryId() === null"
          (click)="setCategory(null)"
          role="tab"
        >
          <ion-label>All</ion-label>
        </ion-chip>
        @for (cat of categories(); track cat.id) {
        <ion-chip
          [class.active]="activeCategoryId() === cat.id"
          (click)="setCategory(cat.id)"
          role="tab"
        >
          <ion-label>{{ cat.name }}</ion-label>
        </ion-chip>
        }
      </div>

      @if (error(); as e) {
      <cdf-app-card padding="normal" class="catalog-error">
        <p class="catalog-error__msg">{{ e }}</p>
      </cdf-app-card>
      }

      @if (loading()) {
      <ion-grid class="catalog-grid">
        <ion-row>
          @for (_ of skeletonRows; track $index) {
          <ion-col size="12" sizeSm="6" sizeMd="4" sizeLg="3">
            <cdf-app-skeleton shape="rect" />
          </ion-col>
          }
        </ion-row>
      </ion-grid>
      } @else if (cards().length === 0) {
      <cdf-empty-state
        icon="school"
        [title]="
          activeCategoryId() === null
            ? 'No courses published yet'
            : 'No courses match this filter'
        "
        description="Check back soon, or pick a different category."
      />
      } @else {
      <ion-grid class="catalog-grid" data-testid="catalog-grid">
        <ion-row>
          @for (c of cards(); track c.id) {
          <ion-col size="12" sizeSm="6" sizeMd="4" sizeLg="3">
            <a
              class="catalog-card-link"
              [routerLink]="['/courses', c.slug]"
              [attr.data-course-slug]="c.slug"
            >
              <cdf-course-card
                [title]="c.title"
                [author]="c.author"
                [lessonCount]="c.lessonCount"
                [estimatedMinutes]="c.estimatedMinutes"
                [difficulty]="c.difficulty"
                [categories]="c.categories"
                [hasFreePreview]="c.hasFreePreview"
              />
            </a>
          </ion-col>
          }
        </ion-row>
      </ion-grid>
      }
    </ion-content>
  `,
  styles: [
    `
      .catalog-filters {
        display: flex;
        flex-wrap: wrap;
        gap: var(--cdf-space-1);
        margin-bottom: var(--cdf-space-3);
      }
      .catalog-filters ion-chip.active {
        --background: var(--cdf-color-primary);
        --color: var(--cdf-color-on-primary);
      }
      .catalog-error {
        margin-bottom: var(--cdf-space-3);
        border-left: 3px solid var(--cdf-color-danger);
      }
      .catalog-error__msg {
        margin: 0;
        color: var(--cdf-color-danger);
        font-size: var(--cdf-font-size-sm);
      }
      .catalog-grid {
        padding: 0;
      }
      .catalog-card-link {
        display: block;
        text-decoration: none;
        color: inherit;
      }
      .catalog-card-link:hover cdf-course-card {
        transform: translateY(-2px);
        transition: transform 150ms ease;
      }
    `,
  ],
})
export class CatalogPage {
  private readonly coursesClient = inject(CoursesClient);
  private readonly categoriesClient = inject(CategoriesClient);

  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly courses = signal<CourseListItem[]>([]);
  protected readonly categories = signal<Category[]>([]);
  protected readonly activeCategoryId = signal<string | null>(null);
  protected readonly skeletonRows = Array.from({ length: 8 }, (_, i) => i);

  private readonly categoryById = computed(() => {
    const map = new Map<string, Category>();
    for (const c of this.categories()) map.set(c.id, c);
    return map;
  });

  protected readonly cards = computed<CourseCardVM[]>(() => {
    const lookup = this.categoryById();
    return this.courses().map((c) => ({
      id: c.id,
      slug: c.slug,
      title: c.title,
      author: c.authorDisplayName,
      lessonCount: c.lessonCount,
      estimatedMinutes: c.estimatedMinutes,
      difficulty: DIFFICULTY_LABEL[c.difficulty] ?? '',
      categories: c.categoryIds
        .map((id) => lookup.get(id))
        .filter((x): x is Category => !!x)
        .map((cat) => ({ id: cat.id, label: cat.name })),
      hasFreePreview: c.lessonCount > 0,
    }));
  });

  constructor() {
    // Categories load once; courses refetch whenever the filter changes.
    void this.loadCategories();
    effect(() => {
      const cid = this.activeCategoryId();
      void this.loadCourses(cid);
    });
  }

  protected setCategory(id: string | null): void {
    if (this.activeCategoryId() === id) return;
    this.activeCategoryId.set(id);
  }

  protected async onRefresh(ev: RefresherCustomEvent): Promise<void> {
    await Promise.all([this.loadCategories(), this.loadCourses(this.activeCategoryId())]);
    await ev.target.complete();
  }

  private async loadCategories(): Promise<void> {
    try {
      const res = await this.categoriesClient.list({ take: 100 });
      this.categories.set(res.items);
    } catch {
      // Non-fatal: catalog still renders, chips just won't have labels.
      this.categories.set([]);
    }
  }

  private async loadCourses(categoryId: string | null): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const res = await this.coursesClient.list({
        status: 'PUBLISHED',
        ...(categoryId ? { categoryId } : {}),
        take: 100,
      });
      this.courses.set(res.items);
    } catch (err) {
      this.error.set(
        err instanceof Error ? err.message : 'Could not load courses',
      );
      this.courses.set([]);
    } finally {
      this.loading.set(false);
    }
  }
}
