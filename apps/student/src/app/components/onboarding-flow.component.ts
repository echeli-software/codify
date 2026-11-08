import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import {
  CoursesClient,
  NotificationsClient,
  type Category,
  type CourseListItem,
  type MeResponse,
  type OnboardingGoal,
} from '@codify/api-client';
import { ContentTranslatePipe, TranslatePipe } from '@codify/i18n';
import { NativePlatformService } from '../native/native-platform.service.js';
import { TelemetryService } from '../telemetry/telemetry.service.js';
import {
  AppButton,
  Icon,
  OnboardingCarousel,
  type IconName,
  type OnboardingSlide,
} from '@codify/ui-ionic';

/** Stored on the account as `User.onboardingGoal` (PATCH /me). */
export type { OnboardingGoal };

export const ONBOARDING_GOALS: { id: OnboardingGoal; icon: IconName }[] = [
  { id: 'career', icon: 'rocket' },
  { id: 'newTech', icon: 'chip' },
  { id: 'ai', icon: 'sparkles' },
  { id: 'softSkills', icon: 'chat-ellipses' },
];

/** `v` when it is one of the four goals, else null (exported for tests). */
export function asOnboardingGoal(v: unknown): OnboardingGoal | null {
  return ONBOARDING_GOALS.some((g) => g.id === v)
    ? (v as OnboardingGoal)
    : null;
}

/**
 * The goal this device saved at onboarding (a JSON localStorage record
 * `{ goal, at, synced? }`); `synced` = already sent to the account.
 */
export interface LocalGoalRecord {
  goal: OnboardingGoal | null;
  synced: boolean;
}

/** Parse the device's onboarding record (exported for tests). */
export function readGoalRecord(raw: string | null): LocalGoalRecord {
  try {
    const v = raw
      ? (JSON.parse(raw) as { goal?: unknown; synced?: unknown })
      : null;
    return { goal: asOnboardingGoal(v?.goal), synced: v?.synced === true };
  } catch {
    return { goal: null, synced: false };
  }
}

/**
 * The goal ranking "Recommended next" (LRN-10): the account's
 * (`GET /me` `onboardingGoal`) wins; with none there, the one this device
 * saved at onboarding. `migrate` = send the device's goal up — only when
 * the server answered with none and it was never sent before. `me` null
 * (offline / failed) or without the field (older API) = unknown.
 */
export function resolveOnboardingGoal(
  me: Pick<MeResponse, 'onboardingGoal'> | null,
  local: LocalGoalRecord,
): { goal: OnboardingGoal | null; migrate: boolean } {
  const known = !!me && me.onboardingGoal !== undefined;
  const server = known ? asOnboardingGoal(me?.onboardingGoal) : null;
  if (server) return { goal: server, migrate: false };
  return {
    goal: local.goal,
    migrate: known && !!local.goal && !local.synced,
  };
}

const GOAL_HINTS: Record<OnboardingGoal, RegExp> = {
  career: /(web|front|back|program|javascript|python|code)/i,
  newTech: /(typescript|react|angular|cloud|mobile|data|python)/i,
  ai: /(\bai\b|\bia\b|prompt|machine|intelig)/i,
  softSkills: /(soft|comunica|communic|lider|leader|career|carreira)/i,
};

/** Default daily reminder (docs/05 Onboarding "Schedule": 8 PM local). */
export const DEFAULT_REMINDER_MINUTE = 20 * 60;

/** "HH:MM" ⇄ minutes from midnight (exported for tests). */
export function minuteToTime(m: number): string {
  const h = Math.floor(m / 60);
  return `${String(h).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}
export function timeToMinute(v: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(v.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h < 24 && min < 60 ? h * 60 + min : null;
}

/**
 * The route that launches a course's first lesson (docs/05 Onboarding
 * step 5): the first free lesson, else the first lesson (the player shows
 * the paywall when needed); the course page when it has no lessons or
 * can't be loaded.
 */
export async function firstLessonRoute(
  courses: Pick<CoursesClient, 'detail'>,
  course: Pick<CourseListItem, 'id' | 'slug'>,
): Promise<string[]> {
  try {
    const detail = await courses.detail(course.slug);
    const lessons = detail.modules
      .slice()
      .sort((a, b) => a.order - b.order)
      .flatMap((m) => m.lessons.slice().sort((a, b) => a.order - b.order));
    const first = lessons.find((l) => l.isFree) ?? lessons[0];
    if (first) return ['/lessons', first.id];
  } catch {
    // Offline / not found: the course page explains.
  }
  return ['/courses', course.slug];
}

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
 * First-run onboarding (docs/05 Onboarding, docs/10 §2): welcome carousel →
 * goal picker → track picker → schedule (daily reminder time, pre-filled
 * 20:00; saved as `reminderMinute` and mirrored to the native local
 * reminder). Emits the chosen course (or null when skipped); the page
 * enrolls and launches its first lesson (`firstLessonRoute`). The first
 * reward — the starter pet + naming — follows the first completed lesson
 * (`StarterPetGiftComponent`). Every step can be skipped.
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
            (completed)="carouselDone()"
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
                  (click)="pickCourse(c)"
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
        @case ('schedule') {
          <section
            class="ob__panel"
            aria-labelledby="ob-schedule"
            data-testid="onboarding-schedule"
          >
            <h2 id="ob-schedule">
              {{ 'student.onboarding.scheduleTitle' | translate }}
            </h2>
            <p class="ob__muted">
              {{ 'student.onboarding.scheduleBody' | translate }}
            </p>
            <label class="ob__time" for="ob-time">
              <span>{{ 'student.onboarding.reminderLabel' | translate }}</span>
              <input
                id="ob-time"
                type="time"
                step="900"
                data-testid="onboarding-time"
                [value]="time()"
                (input)="time.set($any($event.target).value)"
              />
            </label>
            <div class="ob__actions">
              <cdf-app-button kind="ghost" (buttonClick)="schedule(false)">{{
                'common.skip' | translate
              }}</cdf-app-button>
              <cdf-app-button
                kind="primary"
                [loading]="savingSchedule()"
                [disabled]="timeToMinute(time()) === null"
                (buttonClick)="schedule(true)"
                data-testid="onboarding-schedule-confirm"
              >
                {{ 'student.onboarding.scheduleConfirm' | translate }}
              </cdf-app-button>
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
      .ob__time {
        display: flex;
        flex-direction: column;
        gap: 6px;
        font-weight: 600;
      }
      .ob__time input {
        font: inherit;
        font-size: var(--cdf-font-size-xl);
        min-height: 52px;
        padding: 6px 12px;
        border-radius: 12px;
        border: 2px solid var(--cdf-color-border);
        background: var(--cdf-color-surface);
        color: var(--cdf-color-text);
        max-width: 220px;
      }
      .ob__time input:focus-visible {
        outline: 2px solid var(--cdf-color-primary);
        outline-offset: 2px;
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
    /** Reminder time saved in the schedule step (null when skipped). */
    reminderMinute?: number | null;
  }>();

  private readonly notifications = inject(NotificationsClient);
  private readonly native = inject(NativePlatformService);
  private readonly telemetry = inject(TelemetryService);

  protected readonly goals = ONBOARDING_GOALS;
  protected readonly timeToMinute = timeToMinute;
  protected readonly step = signal<'welcome' | 'goal' | 'track' | 'schedule'>(
    'welcome',
  );
  protected readonly time = signal(minuteToTime(DEFAULT_REMINDER_MINUTE));
  protected readonly savingSchedule = signal(false);
  private readonly course = signal<CourseListItem | null>(null);
  protected readonly goal = signal<OnboardingGoal | null>(null);
  protected readonly recommended = computed(() => {
    const g = this.goal();
    return g ? recommendForGoal(g, this.courses(), this.categories()) : [];
  });

  /** Welcome carousel finished (docs/10 §2 step 1, onboarding funnel). */
  protected carouselDone(): void {
    this.telemetry.onboardingStep('welcome');
    this.step.set('goal');
  }

  protected pickGoal(g: OnboardingGoal): void {
    this.goal.set(g);
    this.step.set('track');
  }

  protected pickCourse(c: CourseListItem): void {
    this.course.set(c);
    this.step.set('schedule');
  }

  /** Schedule step: save the reminder time (or skip), then finish. */
  protected async schedule(save: boolean): Promise<void> {
    const minute = save ? timeToMinute(this.time()) : null;
    if (minute !== null) {
      this.savingSchedule.set(true);
      try {
        await this.notifications.updatePreferences({ reminderMinute: minute });
      } catch {
        // Offline: Settings → Notifications can set it later.
      }
      void this.native.syncLocalReminder(minute);
      this.savingSchedule.set(false);
    }
    // docs/05 §9 funnel event (step 4 of docs/10 §2).
    this.telemetry.track('onboarding_step_complete', {
      step: 'schedule',
      reminderMinute: minute,
      skipped: minute === null,
    });
    this.done.emit({
      goal: this.goal(),
      course: this.course(),
      reminderMinute: minute,
    });
  }

  protected finish(course: CourseListItem | null): void {
    this.done.emit({ goal: this.goal(), course });
  }
}
