import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  IonHeader,
  IonToolbar,
  IonTitle,
  IonButtons,
  IonBackButton,
  IonContent,
  IonRefresher,
  IonRefresherContent,
  type RefresherCustomEvent,
} from '@ionic/angular/standalone';
import { EnrollmentsClient, type MyEnrollment } from '@codify/api-client';
import { ContentTranslatePipe, LocalePipe, TranslatePipe } from '@codify/i18n';
import {
  AppBadge,
  AppButton,
  AppCard,
  AppProgressBar,
  AppSkeleton,
  EmptyState,
  ErrorState,
} from '@codify/ui-ionic';
import { errorMessageKey } from '../platform/app-toast.service.js';

/** Completion fraction 0–1 for an enrollment's progress. */
export function enrollmentProgress(e: Pick<MyEnrollment, 'progress'>): number {
  const { completedLessons, totalLessons } = e.progress;
  return totalLessons > 0 ? Math.min(1, completedLessons / totalLessons) : 0;
}

/** `/my-courses` — the learner's enrollments with progress (docs/09 §3). */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonButtons,
    IonBackButton,
    IonContent,
    IonRefresher,
    IonRefresherContent,
    AppBadge,
    AppButton,
    AppCard,
    AppProgressBar,
    AppSkeleton,
    EmptyState,
    ErrorState,
    TranslatePipe,
    LocalePipe,
    ContentTranslatePipe,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-back-button defaultHref="/catalog" />
        </ion-buttons>
        <ion-title>{{ 'student.myCourses.title' | translate }}</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content class="ion-padding">
      <ion-refresher slot="fixed" (ionRefresh)="onRefresh($event)">
        <ion-refresher-content />
      </ion-refresher>
      <div class="mc">
        <p class="mc__sub">{{ 'student.myCourses.subtitle' | translate }}</p>
        @if (loading()) {
          <cdf-app-skeleton shape="rect" [height]="96" />
          <cdf-app-skeleton shape="rect" [height]="96" />
        } @else if (errorKey(); as e) {
          <cdf-error-state
            [title]="'student.myCourses.loadError' | translate"
            [description]="e | translate"
            (retry)="load()"
          />
        } @else if (items().length === 0) {
          <cdf-empty-state
            icon="school"
            [title]="'student.myCourses.empty' | translate"
            [description]="'student.myCourses.emptyHint' | translate"
          >
            <cdf-app-button kind="primary" routerLink="/catalog">{{
              'student.myCourses.browse' | translate
            }}</cdf-app-button>
          </cdf-empty-state>
        } @else {
          <ul class="mc__list" data-testid="my-courses-list">
            @for (e of items(); track e.id) {
              <li [attr.data-course-id]="e.courseId">
                <cdf-app-card padding="normal">
                  <div class="mc__row">
                    <div class="mc__main">
                      <h2 class="mc__title">
                        <a [routerLink]="['/courses', e.course.slug]">{{
                          e.course.id
                            | tContent: 'COURSE' : 'title' : e.course.title
                        }}</a>
                      </h2>
                      <div class="mc__badges">
                        <cdf-app-badge variant="neutral" [subtle]="true">{{
                          'student.myCourses.source.' + e.source | translate
                        }}</cdf-app-badge>
                        @if (e.course.isCapstone) {
                          <cdf-app-badge variant="info" [subtle]="true">{{
                            'student.myCourses.capstone' | translate
                          }}</cdf-app-badge>
                        }
                        @if (e.accessUntil) {
                          <span class="mc__muted">{{
                            'student.myCourses.accessUntil'
                              | translate
                                : { date: (e.accessUntil | locale: 'date') }
                          }}</span>
                        }
                      </div>
                    </div>
                    <cdf-app-button
                      size="sm"
                      [kind]="isDone(e) ? 'secondary' : 'primary'"
                      [routerLink]="['/courses', e.course.slug]"
                    >
                      {{
                        (isDone(e)
                          ? 'student.myCourses.complete'
                          : 'student.myCourses.continue'
                        ) | translate
                      }}
                    </cdf-app-button>
                  </div>
                  <cdf-app-progress-bar
                    [value]="progress(e)"
                    [label]="
                      'student.myCourses.progressLabel'
                        | translate: { title: e.course.title }
                    "
                  />
                  <p class="mc__muted">
                    {{
                      'student.myCourses.progress'
                        | translate
                          : {
                              done: e.progress.completedLessons,
                              total: e.progress.totalLessons,
                            }
                    }}
                  </p>
                </cdf-app-card>
              </li>
            }
          </ul>
        }
      </div>
    </ion-content>
  `,
  styles: [
    `
      .mc {
        max-width: 720px;
        margin: 0 auto;
      }
      .mc__sub,
      .mc__muted {
        color: var(--cdf-color-text-muted);
        font-size: var(--cdf-font-size-sm);
        margin: 4px 0;
      }
      .mc__list {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: var(--cdf-space-2);
      }
      .mc__row {
        display: flex;
        gap: var(--cdf-space-2);
        align-items: flex-start;
        justify-content: space-between;
        margin-bottom: var(--cdf-space-2);
      }
      .mc__title {
        margin: 0 0 4px;
        font-size: var(--cdf-font-size-md);
      }
      .mc__title a {
        color: inherit;
        text-decoration: none;
      }
      .mc__title a:hover,
      .mc__title a:focus-visible {
        text-decoration: underline;
      }
      .mc__badges {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        align-items: center;
      }
    `,
  ],
})
export class MyCoursesPage {
  private readonly enrollments = inject(EnrollmentsClient);

  protected readonly loading = signal(true);
  protected readonly errorKey = signal<string | null>(null);
  protected readonly items = signal<MyEnrollment[]>([]);

  constructor() {
    void this.load();
  }

  protected async load(): Promise<void> {
    this.loading.set(true);
    this.errorKey.set(null);
    try {
      this.items.set(await this.enrollments.mine());
    } catch (err) {
      this.errorKey.set(errorMessageKey(err));
    } finally {
      this.loading.set(false);
    }
  }

  protected async onRefresh(ev: RefresherCustomEvent): Promise<void> {
    await this.load();
    await ev.target.complete();
  }

  protected progress(e: MyEnrollment): number {
    return Math.round(enrollmentProgress(e) * 100);
  }

  protected isDone(e: MyEnrollment): boolean {
    return (
      e.progress.totalLessons > 0 &&
      e.progress.completedLessons >= e.progress.totalLessons
    );
  }
}
