import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import {
  I18nService,
  LocalePipe,
  TranslatePipe,
  formatForLocale,
} from '@codify/i18n';
import {
  Badge,
  Button,
  ConfirmDialogService,
  EmptyState,
  Select,
  type SelectOption,
  Skeleton,
  ToastService,
} from '@codify/ui-bootstrap';
import {
  StaffToolsClient,
  type ExerciseFailureVerdict,
  type ExerciseHealthRow,
  type RetestJob,
} from '@codify/api-client';
import { AdminErrors } from '../core/errors';
import { LoadError } from '../shared/load-error';

const VERDICTS: readonly ExerciseFailureVerdict[] = [
  'FAIL',
  'ERROR',
  'TIMEOUT',
  'MEMORY',
  'RUNTIME',
];
/** Poll interval while a re-test job is queued / running. */
const POLL_MS = 3000;

/** "FAIL 3 · TIMEOUT 1" style summary, most frequent first (zeros dropped). */
export function failureSummary(
  failures: Record<ExerciseFailureVerdict, number>,
): { verdict: ExerciseFailureVerdict; count: number }[] {
  return VERDICTS.map((verdict) => ({ verdict, count: failures[verdict] ?? 0 }))
    .filter((f) => f.count > 0)
    .sort((a, b) => b.count - a.count);
}

/**
 * Exercise dashboard (docs/12 §11, ADMIN): per exercise pass rate, mean
 * attempts to pass, failure categories (verdicts) and the tests failed
 * most; plus "Re-test all exercises in <language>", which queues a run of
 * every reference solution through the executor and lists the results.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    RouterLink,
    Badge,
    Button,
    EmptyState,
    LoadError,
    Select,
    Skeleton,
    TranslatePipe,
    LocalePipe,
  ],
  template: `
    <div class="admin-page admin-page--wide">
      <header class="page-head">
        <div>
          <h1>{{ 'admin.staff.exercises.title' | translate }}</h1>
          <p class="muted">
            {{ 'admin.staff.exercises.subtitle' | translate }}
          </p>
        </div>
      </header>

      <section class="admin-card toolbar">
        <cdf-select
          [ariaLabel]="'admin.staff.exercises.language' | translate"
          [options]="languageOptions()"
          [ngModel]="language()"
          (ngModelChange)="setLanguage($event)"
          data-testid="exercise-language"
        />
        <cdf-button
          kind="secondary"
          [disabled]="!language() || running()"
          [loading]="busy()"
          (click)="retest()"
          data-testid="retest-language"
        >
          {{
            'admin.staff.exercises.retest'
              | translate: { language: language() || '—' }
          }}
        </cdf-button>
      </section>

      @if (error(); as e) {
        <cdf-load-error [message]="e" (retry)="load()" />
      } @else if (rows() === null) {
        <cdf-skeleton shape="rect" height="240px" />
      } @else if (rows()!.length === 0) {
        <cdf-empty-state
          icon="file"
          [title]="'admin.staff.exercises.emptyTitle' | translate"
          [description]="'admin.staff.exercises.emptyBody' | translate"
        />
      } @else {
        <section class="admin-card table-scroll">
          <table class="admin-table" data-testid="exercise-health">
            <caption class="visually-hidden">
              {{
                'admin.staff.exercises.caption' | translate
              }}
            </caption>
            <thead>
              <tr>
                <th scope="col">
                  {{ 'admin.staff.exercises.exercise' | translate }}
                </th>
                <th scope="col" class="num">
                  {{ 'admin.staff.exercises.learners' | translate }}
                </th>
                <th scope="col" class="num">
                  {{ 'admin.staff.exercises.passRate' | translate }}
                </th>
                <th scope="col" class="num">
                  {{ 'admin.staff.exercises.attemptsToPass' | translate }}
                </th>
                <th scope="col">
                  {{ 'admin.staff.exercises.failures' | translate }}
                </th>
                <th scope="col">
                  {{ 'admin.staff.exercises.failingTests' | translate }}
                </th>
              </tr>
            </thead>
            <tbody>
              @for (r of rows(); track r.exerciseId) {
                <tr [attr.data-exercise]="r.exerciseId">
                  <th scope="row">
                    <a [routerLink]="['/lessons', r.lessonId, 'exercise']">{{
                      r.lessonTitle
                    }}</a>
                    <div class="muted small">
                      {{ r.courseTitle }} ·
                      <span class="mono">{{ r.language }}</span>
                    </div>
                  </th>
                  <td class="num">
                    {{ r.learners | locale: 'integer' }}
                    <div class="muted small">
                      {{
                        'admin.staff.exercises.attempts'
                          | translate: { count: r.attempts }
                      }}
                    </div>
                  </td>
                  <td class="num">{{ pct(r.passRate) }}</td>
                  <td class="num">
                    {{
                      r.avgAttemptsToPass === null
                        ? '—'
                        : (r.avgAttemptsToPass | locale: 'number')
                    }}
                  </td>
                  <td>
                    @for (f of failures(r); track f.verdict) {
                      <cdf-badge variant="neutral" [subtle]="true"
                        >{{
                          'admin.staff.exercises.verdict.' + f.verdict
                            | translate
                        }}
                        {{ f.count }}</cdf-badge
                      >
                    } @empty {
                      <span class="muted small">—</span>
                    }
                  </td>
                  <td class="small">
                    @for (t of r.topFailingTests; track t.testId) {
                      <div>
                        {{ t.name }} <span class="muted">×{{ t.count }}</span>
                      </div>
                    } @empty {
                      <span class="muted">—</span>
                    }
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </section>
      }

      <section class="admin-card" aria-labelledby="retests-title">
        <h2 id="retests-title">
          {{ 'admin.staff.exercises.retests' | translate }}
        </h2>
        @if (jobs().length === 0) {
          <p class="muted small">
            {{ 'admin.staff.exercises.noRetests' | translate }}
          </p>
        }
        @for (j of jobs(); track j.jobId) {
          <details class="job" [open]="$first" [attr.data-job]="j.jobId">
            <summary>
              <cdf-badge
                [variant]="
                  j.status === 'done'
                    ? j.failed > 0
                      ? 'warning'
                      : 'success'
                    : j.status === 'failed'
                      ? 'danger'
                      : 'info'
                "
                [subtle]="true"
                >{{
                  'admin.staff.exercises.status.' + j.status | translate
                }}</cdf-badge
              >
              <span class="mono">{{ j.language }}</span>
              <span>{{
                'admin.staff.exercises.progress'
                  | translate
                    : {
                        done: j.done,
                        total: j.total,
                        passed: j.passed,
                        failed: j.failed,
                      }
              }}</span>
              <span class="muted small">{{
                j.queuedAt | locale: 'datetime'
              }}</span>
            </summary>
            @if (j.results.length > 0) {
              <div class="table-scroll">
                <table class="admin-table">
                  <thead>
                    <tr>
                      <th scope="col">
                        {{ 'admin.staff.exercises.exercise' | translate }}
                      </th>
                      <th scope="col">
                        {{ 'admin.common.status' | translate }}
                      </th>
                      <th scope="col">
                        {{ 'admin.staff.exercises.message' | translate }}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (r of j.results; track r.exerciseId) {
                      <tr>
                        <th scope="row">{{ r.lessonTitle }}</th>
                        <td>
                          <cdf-badge
                            [variant]="r.ok ? 'success' : 'danger'"
                            [subtle]="true"
                            >{{
                              (r.ok
                                ? 'admin.staff.exercises.pass'
                                : 'admin.staff.exercises.fail'
                              ) | translate
                            }}</cdf-badge
                          >
                        </td>
                        <td class="small">{{ r.message ?? '' }}</td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            }
          </details>
        }
      </section>
    </div>
  `,
  styles: [
    `
      .toolbar {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--cdf-space-3);
      }
      .toolbar cdf-select {
        min-width: 200px;
      }
      h2 {
        font-size: 1.125rem;
      }
      .job summary {
        display: flex;
        flex-wrap: wrap;
        gap: var(--cdf-space-2);
        align-items: center;
        cursor: pointer;
        padding: var(--cdf-space-2) 0;
      }
      cdf-badge + cdf-badge {
        margin-left: 4px;
      }
    `,
  ],
})
export class ExerciseHealthPage {
  private readonly staff = inject(StaffToolsClient);
  private readonly errors = inject(AdminErrors);
  private readonly i18n = inject(I18nService);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmDialogService);

  protected readonly rows = signal<ExerciseHealthRow[] | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly languages = signal<string[]>([]);
  protected readonly language = signal<string>('');
  protected readonly jobs = signal<RetestJob[]>([]);
  protected readonly busy = signal(false);
  protected readonly running = computed(() =>
    this.jobs().some(
      (j) =>
        j.language === this.language() &&
        (j.status === 'queued' || j.status === 'running'),
    ),
  );
  protected readonly languageOptions = computed<SelectOption<string>[]>(() => {
    this.i18n.currentLocale();
    return [
      { value: '', label: this.i18n.t('admin.staff.exercises.allLanguages') },
      ...this.languages().map((l) => ({ value: l, label: l })),
    ];
  });
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.stopPolling());
    void this.load();
    void this.loadJobs();
  }

  protected failures(r: ExerciseHealthRow) {
    return failureSummary(r.failures);
  }

  protected pct(v: number | null): string {
    return v === null
      ? '—'
      : formatForLocale(v, this.i18n.currentLocale(), 'percent');
  }

  protected setLanguage(l: string): void {
    this.language.set(l ?? '');
    void this.load();
  }

  protected async load(): Promise<void> {
    this.error.set(null);
    this.rows.set(null);
    try {
      const res = await this.staff.exerciseHealth(this.language() || undefined);
      this.rows.set(res.items);
      if (res.languages.length) this.languages.set(res.languages);
    } catch (err) {
      this.error.set(this.errors.message(err, 'admin.errors.loadFailed'));
    }
  }

  private async loadJobs(): Promise<void> {
    try {
      const { items } = await this.staff.retests();
      this.jobs.set(items);
      if (items.some((j) => j.status === 'queued' || j.status === 'running'))
        this.schedulePoll();
    } catch (err) {
      this.errors.toast(err, 'admin.errors.loadFailed');
    }
  }

  protected async retest(): Promise<void> {
    const language = this.language();
    if (!language) return;
    const ok = await this.confirm.open({
      title: this.i18n.t('admin.staff.exercises.retestTitle', { language }),
      message: this.i18n.t('admin.staff.exercises.retestMessage'),
      confirmLabel: this.i18n.t('admin.staff.exercises.retestConfirm'),
    });
    if (!ok) return;
    this.busy.set(true);
    try {
      const job = await this.staff.retest(language);
      this.jobs.update((list) => [job, ...list]);
      this.toast.success(
        this.i18n.t('admin.staff.exercises.queued', { count: job.total }),
      );
      this.schedulePoll();
    } catch (err) {
      this.errors.toast(err, 'admin.errors.actionFailed');
    } finally {
      this.busy.set(false);
    }
  }

  private schedulePoll(): void {
    this.stopPolling();
    this.timer = setTimeout(() => void this.loadJobs(), POLL_MS);
  }

  private stopPolling(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
