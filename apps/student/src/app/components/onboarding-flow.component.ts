import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
  signal,
} from '@angular/core';
import type { Category, CourseListItem } from '@codify/api-client';
import { ContentTranslatePipe, TranslatePipe } from '@codify/i18n';
import {
  AppButton,
  Icon,
  OnboardingCarousel,
  type IconName,
  type OnboardingSlide,
} from '@codify/ui-ionic';

export type OnboardingGoal = 'career' | 'newTech' | 'ai' | 'softSkills';

export const ONBOARDING_GOALS: { id: OnboardingGoal; icon: IconName }[] = [
  { id: 'career', icon: 'rocket' },
  { id: 'newTech', icon: 'chip' },
  { id: 'ai', icon: 'sparkles' },
  { id: 'softSkills', icon: 'chat-ellipses' },
];

const GOAL_HINTS: Record<OnboardingGoal, RegExp> = {
  career: /(web|front|back|program|javascript|python|code)/i,
  newTech: /(typescript|react|angular|cloud|mobile|data|python)/i,
  ai: /(\bai\b|\bia\b|prompt|machine|intelig)/i,
  softSkills: /(soft|comunica|communic|lider|leader|career|carreira)/i,
};

/**
 * Up to three courses for a goal: matches on title / category names first,
 * then the rest of the catalog in its original order (exported for tests).
 */
export function recommendForGoal(
  goal: OnboardingGoal,
  courses: readonly CourseListItem[],
  categories: readonly Pick<Category, 'id' | 'name'>[],
  limit = 3,
): CourseListItem[] {
  const names = new Map(categories.map((c) => [c.id, c.name]));
  const re = GOAL_HINTS[goal];
  const score = (c: CourseListItem) =>
    re.test(c.title) || c.categoryIds.some((id) => re.test(names.get(id) ?? ''))
      ? 1
      : 0;
  return [...courses]
    .map((c, i) => ({ c, i, s: score(c) }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .slice(0, limit)
    .map((x) => x.c);
}

/**
 * First-run onboarding (docs/10 §2): welcome carousel → goal picker →
 * track picker. Emits the chosen course (or null when skipped); the page
 * enrolls and opens it. Every step can be skipped.
 */
@Component({
  selector: 'cdf-onboarding-flow',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    AppButton,
    Icon,
    OnboardingCarousel,
    TranslatePipe,
    ContentTranslatePipe,
  ],
  template: `
    <div
      class="ob"
      role="dialog"
      aria-modal="true"
      [attr.aria-label]="'student.onboarding.label' | translate"
      data-testid="onboarding"
    >
      @switch (step()) {
        @case ('welcome') {
          <cdf-onboarding-carousel
            [slides]="slides()"
            (skipped)="finish(null)"
            (completed)="step.set('goal')"
          />
        }
        @case ('goal') {
          <section class="ob__panel" aria-labelledby="ob-goal">
            <h2 id="ob-goal">
              {{ 'student.onboarding.goalTitle' | translate }}
            </h2>
            <div
              class="ob__options"
              role="radiogroup"
              aria-labelledby="ob-goal"
            >
              @for (g of goals; track g.id) {
                <button
                  type="button"
                  role="radio"
                  class="ob__option"
                  [attr.aria-checked]="goal() === g.id"
                  [attr.data-goal]="g.id"
                  (click)="pickGoal(g.id)"
                >
                  <cdf-icon [name]="g.icon" size="md" />
                  <span>{{
                    'student.onboarding.goals.' + g.id | translate
                  }}</span>
                </button>
              }
            </div>
            <div class="ob__actions">
              <cdf-app-button kind="ghost" (buttonClick)="finish(null)">{{
                'common.skip' | translate
              }}</cdf-app-button>
            </div>
          </section>
        }
        @case ('track') {
          <section class="ob__panel" aria-labelledby="ob-track">
            <h2 id="ob-track">
              {{ 'student.onboarding.trackTitle' | translate }}
            </h2>
            <p class="ob__muted">
              {{ 'student.onboarding.trackBody' | translate }}
            </p>
            @if (recommended().length === 0) {
              <p class="ob__muted">
                {{ 'student.onboarding.noCourses' | translate }}
              </p>
            }
            <div class="ob__options">
              @for (c of recommended(); track c.id) {
                <button
                  type="button"
                  class="ob__option ob__option--course"
                  (click)="finish(c)"
                  [attr.data-course-id]="c.id"
                >
                  <strong>{{
                    c.id | tContent: 'COURSE' : 'title' : c.title
                  }}</strong>
                  <span class="ob__muted">{{
                    'student.onboarding.lessons'
                      | translate: { count: c.lessonCount }
                  }}</span>
                </button>
              }
            </div>
            <div class="ob__actions">
              <cdf-app-button kind="ghost" (buttonClick)="step.set('goal')">{{
                'common.back' | translate
              }}</cdf-app-button>
              <cdf-app-button kind="ghost" (buttonClick)="finish(null)">{{
                'common.skip' | translate
              }}</cdf-app-button>
            </div>
          </section>
        }
      }
    </div>
  `,
  styles: [
    `
      .ob {
        position: fixed;
        inset: 0;
        z-index: 900;
        background: var(--cdf-color-bg);
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 16px;
        overflow: auto;
      }
      .ob__panel {
        width: min(560px, 100%);
      }
      .ob__panel h2 {
        font-size: var(--cdf-font-size-xl);
        margin: 0 0 var(--cdf-space-3);
      }
      .ob__options {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
        gap: var(--cdf-space-2);
      }
      .ob__option {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 6px;
        padding: 14px;
        border-radius: 14px;
        border: 2px solid var(--cdf-color-border);
        background: var(--cdf-color-surface);
        color: var(--cdf-color-text);
        font: inherit;
        text-align: left;
        cursor: pointer;
        min-height: 64px;
      }
      .ob__option[aria-checked='true'] {
        border-color: var(--cdf-color-primary);
      }
      .ob__option:focus-visible {
        outline: 2px solid var(--cdf-color-primary);
        outline-offset: 2px;
      }
      .ob__muted {
        color: var(--cdf-color-text-muted);
        font-size: var(--cdf-font-size-sm);
      }
      .ob__actions {
        display: flex;
        justify-content: flex-end;
        gap: var(--cdf-space-2);
        margin-top: var(--cdf-space-3);
      }
    `,
  ],
})
export class OnboardingFlowComponent {
  readonly courses = input<CourseListItem[]>([]);
  readonly categories = input<Category[]>([]);
  /** Localized slide copy (the carousel renders strings as given). */
  readonly slides = input.required<OnboardingSlide[]>();

  readonly done = output<{
    goal: OnboardingGoal | null;
    course: CourseListItem | null;
  }>();

  protected readonly goals = ONBOARDING_GOALS;
  protected readonly step = signal<'welcome' | 'goal' | 'track'>('welcome');
  protected readonly goal = signal<OnboardingGoal | null>(null);
  protected readonly recommended = computed(() => {
    const g = this.goal();
    return g ? recommendForGoal(g, this.courses(), this.categories()) : [];
  });

  protected pickGoal(g: OnboardingGoal): void {
    this.goal.set(g);
    this.step.set('track');
  }

  protected finish(course: CourseListItem | null): void {
    this.done.emit({ goal: this.goal(), course });
  }
}
