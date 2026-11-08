import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import {
  ExercisesClient,
  ProblemDetailsError,
  isSubmissionFinal,
  toProblemDetails,
  uuidV4,
  type ExerciseLanguage,
  type ExerciseTestResult,
  type StudentExercise,
  type SubmissionView,
} from '@codify/api-client';
import {
  gradeBrowserTests,
  isBrowserExerciseLanguage,
  verdictFromResults,
  scoreFromResults,
} from '@codify/domain';
import { RewardOrchestrator } from '@codify/gamification-engine';
import { I18nService, TranslatePipe } from '@codify/i18n';
import {
  ExerciseRunner,
  type ExerciseAction,
  type ExerciseTestView,
  type ExerciseView,
} from '@codify/ui-ionic';
import { TelemetryService } from '../telemetry/telemetry.service.js';
import { DownloadService } from '../offline/download.service.js';
import { NetworkStatusService } from '../offline/network-status.service.js';
import { LessonWebFrame } from './lesson-web-frame.component.js';
import { rewardPayload } from './reward-grant.js';
import { runnerError, type RunnerError } from './runner-errors.js';

export interface RunnerCompletion {
  xp: number;
  coins: number;
  /** Saved offline — the reward is an estimate until it syncs. */
  queued?: boolean;
}

/** How long to keep polling a queued (PENDING / RUNNING) submission. */
const POLL_TIMEOUT_MS = 90_000;

/**
 * Test rows for the runner. Hidden tests stay anonymised ("Hidden test 2",
 * generic error, no actual / expected) until the submission passes; then
 * the revealed names replace the placeholders (exported for tests).
 */
export function testViews(
  results: readonly ExerciseTestResult[],
  revealed: readonly { id: string; name: string }[] | undefined,
  t: (key: string, params?: Record<string, unknown>) => string,
): ExerciseTestView[] {
  let hiddenN = 0;
  return results.map((r) => {
    if (!r.hidden) {
      return {
        id: r.id,
        name: r.name,
        passed: r.passed,
        actual: r.actual,
        expected: r.expected,
        error: r.error,
        runtimeMs: r.runtimeMs,
      };
    }
    hiddenN++;
    const real = revealed?.find((x) => x.id === r.id);
    return {
      id: r.id,
      name: real?.name ?? t('student.exercise.hiddenTest', { n: hiddenN }),
      passed: r.passed,
      error: r.passed ? undefined : t('student.exercise.hiddenFailed'),
    };
  });
}

/**
 * Wires the presentational `ExerciseRunner` to the API (docs/12 §6): Run
 * (visible tests), Submit (queued grading with 202 / PENDING polling),
 * redacted hidden results, rate-limit codes, and the first-pass reward
 * through `RewardOrchestrator` with canonical totals.
 *
 * Offline (docs/16 §3/§5): the exercise stub from the download (starter
 * code + visible tests) is shown read-only with "Connect to run code".
 * Browser exercises (`language: 'web'`, docs/12 §4) run their tests in a
 * sandboxed iframe; Submit reports the results to the API.
 */
@Component({
  selector: 'cdf-lesson-exercise',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ExerciseRunner, LessonWebFrame, TranslatePipe],
  template: `
    @if (loadError(); as e) {
      <p class="lx__error" role="alert">{{ e.key | translate: e.params }}</p>
    } @else {
      <cdf-exercise-runner
        data-testid="exercise-runner"
        [exercise]="view()"
        [(code)]="code"
        [loading]="loading()"
        [running]="running()"
        [submitting]="submitting()"
        [results]="results()"
        [verdict]="verdict()"
        [scorePct]="scorePct()"
        [passed]="passed()"
        [error]="errorText()"
        [offline]="offline()"
        (run)="run($event)"
        (submitted)="submit($event)"
      >
        @if (isWeb()) {
          <cdf-lesson-web-frame
            cdfRunnerPreview
            [initialCode]="exercise()?.starterCode ?? ''"
          />
        }
      </cdf-exercise-runner>
      @if (isWeb() && !offline()) {
        <p class="lx__pending">
          {{ 'student.exercise.browserGraded' | translate }}
        </p>
      }
      @if (pending()) {
        <p class="lx__pending" role="status">
          {{ 'student.exercise.grading' | translate }}
        </p>
      }
    }
  `,
  styles: [
    `
      .lx__error {
        color: var(--cdf-color-danger);
      }
      .lx__pending {
        color: var(--cdf-color-text-muted);
        font-size: var(--cdf-font-size-sm);
      }
    `,
  ],
})
export class LessonExerciseComponent {
  readonly lessonId = input.required<string>();
  readonly completed = output<RunnerCompletion>();
  readonly paywall = output<unknown>();

  private readonly client = inject(ExercisesClient);
  private readonly orchestrator = inject(RewardOrchestrator);
  private readonly i18n = inject(I18nService);
  private readonly telemetry = inject(TelemetryService);
  private readonly downloads = inject(DownloadService);
  private readonly network = inject(NetworkStatusService);
  private readonly webFrame = viewChild(LessonWebFrame);
  private destroyed = false;

  /** Showing the downloaded stub (read-only) or the device is offline. */
  protected readonly fromDownload = signal(false);
  protected readonly offline = computed(
    () => this.fromDownload() || !this.network.online(),
  );
  protected readonly isWeb = computed(() =>
    isBrowserExerciseLanguage(this.exercise()?.language ?? ''),
  );

  protected readonly exercise = signal<StudentExercise | null>(null);
  protected readonly code = signal('');
  protected readonly loading = signal(true);
  protected readonly loadError = signal<RunnerError | null>(null);
  protected readonly running = signal(false);
  protected readonly submitting = signal(false);
  protected readonly pending = signal(false);
  protected readonly rawResults = signal<ExerciseTestResult[]>([]);
  protected readonly revealed = signal<
    { id: string; name: string }[] | undefined
  >(undefined);
  protected readonly verdict = signal<string | null>(null);
  protected readonly scorePct = signal(0);
  protected readonly passed = signal(false);
  protected readonly error = signal<RunnerError | null>(null);

  protected readonly view = computed<ExerciseView | null>(() => {
    const ex = this.exercise();
    return ex
      ? {
          language: ex.language,
          entryFunction: ex.entryFunction,
          starterCode: ex.starterCode,
          visibleTests: ex.visibleTests.map((t) => ({
            id: t.id,
            name: t.name,
          })),
        }
      : null;
  });
  protected readonly results = computed(() => {
    this.i18n.currentLocale();
    return testViews(this.rawResults(), this.revealed(), (k, p) =>
      this.i18n.t(k, p),
    );
  });
  protected readonly errorText = computed(() => {
    const e = this.error();
    this.i18n.currentLocale();
    return e ? this.i18n.t(e.key, e.params) : null;
  });

  constructor() {
    effect(() => {
      const id = this.lessonId();
      untracked(() => void this.load(id));
    });
    inject(DestroyRef).onDestroy(() => (this.destroyed = true));
  }

  private async load(lessonId: string): Promise<void> {
    this.loading.set(true);
    this.loadError.set(null);
    this.fromDownload.set(false);
    try {
      if (!this.network.online() && (await this.loadStub(lessonId))) return;
      const ex = await this.client.forLesson(lessonId);
      this.exercise.set(ex);
      this.code.set(ex.starterCode);
      this.passed.set(ex.alreadyPassed);
    } catch (err) {
      if (err instanceof ProblemDetailsError && err.status === 402)
        this.paywall.emit(err);
      if (toProblemDetails(err).status === 0 && (await this.loadStub(lessonId)))
        return;
      this.loadError.set(runnerError(err));
    } finally {
      this.loading.set(false);
    }
  }

  /** Starter code + visible tests from the download (docs/16 §5). */
  private async loadStub(lessonId: string): Promise<boolean> {
    const stub = (
      await this.downloads.getLessonBundle(lessonId).catch(() => null)
    )?.exercise;
    if (!stub) {
      if (this.network.online()) return false;
      this.loadError.set({ key: 'student.exercise.notDownloaded' });
      return true;
    }
    this.exercise.set({
      id: stub.id,
      lessonId,
      language: stub.language as ExerciseLanguage,
      entryFunction: stub.entryFunction,
      starterCode: stub.starterCode,
      visibleTests: stub.visibleTests,
      alreadyPassed: false,
      lastSubmissionId: null,
    } as StudentExercise);
    this.code.set(stub.starterCode);
    this.fromDownload.set(true);
    return true;
  }

  /** Browser exercise: render + probe the visible tests in the iframe. */
  private async runInBrowser(
    ex: StudentExercise,
    code: string,
  ): Promise<ExerciseTestResult[]> {
    const frame = this.webFrame();
    const tests = ex.visibleTests.map((t) => ({
      id: t.id,
      name: t.name,
      args: (t.args as unknown[]) ?? [],
      expected: t.expected,
    }));
    const answer = frame
      ? await frame.run(
          code,
          tests.map((t) => ({ id: t.id, args: t.args })),
        )
      : null;
    if (!answer) {
      this.error.set({ key: 'student.exercise.browserTimeout' });
      return tests.map((t) => ({
        id: t.id,
        name: t.name,
        passed: false,
        error: this.i18n.t('student.exercise.browserTimeout'),
      }));
    }
    if (answer.errors.length)
      this.error.set({
        key: 'student.exercise.diagnostics',
        params: { message: answer.errors[0] },
      });
    return gradeBrowserTests(tests, answer.probes);
  }

  protected async run(action: ExerciseAction): Promise<void> {
    const ex = this.exercise();
    if (!ex || this.running()) return;
    this.running.set(true);
    this.error.set(null);
    if (this.isWeb()) {
      try {
        const results = await this.runInBrowser(ex, action.code);
        this.rawResults.set(results);
        this.revealed.set(undefined);
        this.verdict.set(verdictFromResults(results));
        this.scorePct.set(scoreFromResults(results));
        this.telemetry.track('exercise_run', {
          exerciseId: ex.id,
          verdict: this.verdict(),
          runtimeMs: null,
          browser: true,
        });
      } finally {
        this.running.set(false);
      }
      return;
    }
    try {
      const res = await this.client.run(ex.id, action.code);
      this.rawResults.set(res.results);
      this.revealed.set(undefined);
      this.verdict.set(res.verdict);
      this.scorePct.set(res.scorePct);
      if (res.message)
        this.error.set({
          key: 'student.exercise.diagnostics',
          params: { message: res.message },
        });
      this.telemetry.track('exercise_run', {
        exerciseId: ex.id,
        verdict: res.verdict,
        runtimeMs: maxRuntime(res.results),
      });
    } catch (err) {
      this.error.set(runnerError(err));
    } finally {
      this.running.set(false);
    }
  }

  protected async submit(action: ExerciseAction): Promise<void> {
    const ex = this.exercise();
    if (!ex || this.submitting()) return;
    this.submitting.set(true);
    this.error.set(null);
    try {
      if (this.isWeb()) {
        // docs/12 §4: graded here, recorded (client-attested) by the API.
        const results = await this.runInBrowser(ex, action.code);
        const view = await this.client.browserResult(
          ex.id,
          {
            code: action.code,
            results: results.map((r) => ({
              id: r.id,
              passed: r.passed,
              ...(r.error ? { error: r.error.slice(0, 500) } : {}),
            })),
            clientTimestamp: new Date().toISOString(),
          },
          uuidV4(),
        );
        if (this.destroyed) return;
        this.apply(ex, { ...view, results }, action.sourceEl);
        return;
      }
      // One idempotency key for the submit + every poll: a retried tap
      // returns the same submission instead of grading twice.
      let view = await this.client.submitAndWait(ex.id, action.code, {
        idempotencyKey: uuidV4(),
        timeoutMs: 15_000,
      });
      if (!isSubmissionFinal(view)) view = await this.keepPolling(view);
      if (this.destroyed) return;
      this.apply(ex, view, action.sourceEl);
    } catch (err) {
      if (err instanceof ProblemDetailsError && err.status === 402)
        this.paywall.emit(err);
      this.error.set(runnerError(err));
    } finally {
      this.pending.set(false);
      this.submitting.set(false);
    }
  }

  /** Queued grading (202 / PENDING): keep checking with a gentle backoff. */
  private async keepPolling(start: SubmissionView): Promise<SubmissionView> {
    this.pending.set(true);
    let view = start;
    let wait = 1500;
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    while (
      !isSubmissionFinal(view) &&
      Date.now() < deadline &&
      !this.destroyed
    ) {
      await new Promise((r) => setTimeout(r, wait));
      wait = Math.min(wait * 1.5, 5000);
      view = await this.client.getSubmission(view.submissionId);
    }
    if (!isSubmissionFinal(view)) {
      throw new ProblemDetailsError({
        status: 504,
        code: 'SUBMISSION_TIMEOUT',
      });
    }
    return view;
  }

  private apply(
    ex: StudentExercise,
    view: SubmissionView,
    sourceEl: HTMLElement | null,
  ): void {
    this.rawResults.set(view.results ?? []);
    this.revealed.set(view.hiddenRevealed);
    this.verdict.set(view.verdict);
    this.scorePct.set(view.scorePct ?? 0);
    const passed = view.passed ?? view.verdict === 'PASS';
    if (passed) this.passed.set(true);
    if (view.status === 'WORKER_LOST') {
      this.error.set({ key: 'student.exercise.workerLost' });
    } else if (view.message) {
      this.error.set({
        key: 'student.exercise.diagnostics',
        params: { message: view.message },
      });
    }
    this.telemetry.track('exercise_submit', {
      exerciseId: ex.id,
      verdict: view.verdict,
      runtimeMs: view.runtimeMs,
    });
    if (passed) {
      if (view.reward) {
        void this.orchestrator.grant(
          rewardPayload(
            'exercisePass',
            view.reward,
            view.badgesUnlocked,
            sourceEl,
          ),
        );
      }
      this.completed.emit({
        xp: view.reward?.xp ?? 0,
        coins: view.reward?.coins ?? 0,
      });
    }
  }
}

function maxRuntime(results: readonly ExerciseTestResult[]): number | null {
  const times = results
    .map((r) => r.runtimeMs)
    .filter((t): t is number => typeof t === 'number');
  return times.length ? Math.max(...times) : null;
}
