import { ChangeDetectionStrategy, Component, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  AppBadge,
  AppButton,
  AppCard,
  AppSkeleton,
  Icon,
} from '@codify/ui-ionic';
import { RewardOrchestrator } from '@codify/gamification-engine';
import {
  ExercisesClient,
  ProblemDetailsError,
  type ExerciseTestResult,
  type StudentExercise,
  type SubmitResult,
} from '@codify/api-client';

/**
 * ExerciseRunner — the code-exercise surface inside the lesson player
 * (docs/12-code-execution §6). Edit code, "Run" against visible tests, then
 * "Submit" to grade against visible + hidden tests; a first pass plays the
 * reward through RewardOrchestrator and reports completion to the parent.
 */
@Component({
  selector: 'cdf-exercise-runner',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, AppBadge, AppButton, AppCard, AppSkeleton, Icon],
  template: `
    @if (loading()) {
    <cdf-app-skeleton shape="rect" />
    } @else if (exercise(); as ex) {
    <div class="runner" data-testid="exercise-runner">
      <p class="lang"><cdf-icon name="rocket" size="xs" /> {{ ex.language }} · function <code>{{ ex.entryFunction }}</code></p>

      <textarea
        class="editor"
        spellcheck="false"
        [(ngModel)]="code"
        data-testid="code-editor"
        rows="10"
      ></textarea>

      <div class="actions">
        <cdf-app-button kind="secondary" size="sm" [loading]="running()" (buttonClick)="run()" data-testid="run-btn">Run</cdf-app-button>
        <cdf-app-button kind="primary" size="sm" [loading]="submitting()" (buttonClick)="submit($event)" data-testid="submit-btn">Submit</cdf-app-button>
        @if (verdict()) {
        <cdf-app-badge [variant]="verdict() === 'PASS' ? 'success' : 'danger'" [subtle]="true" data-testid="verdict">
          {{ verdict() }} · {{ scorePct() }}%
        </cdf-app-badge>
        }
      </div>

      @if (error(); as e) { <p class="err" data-testid="exec-error">{{ e }}</p> }

      @if (results().length > 0) {
      <ul class="tests" data-testid="test-results">
        @for (r of results(); track r.id) {
        <li [class.tests--fail]="!r.passed">
          <cdf-icon [name]="r.passed ? 'check-circle' : 'close'" size="sm" />
          <span class="tests__name">{{ r.name }}</span>
          @if (!r.passed && r.error) { <span class="tests__diff">{{ r.error }}</span> }
          @else if (!r.passed) { <span class="tests__diff">got {{ fmt(r.actual) }}, expected {{ fmt(r.expected) }}</span> }
        </li>
        }
      </ul>
      }

      @if (passed()) {
      <p class="done" data-testid="exercise-passed"><cdf-icon name="trophy" size="sm" /> Solved! All tests pass.</p>
      }
    </div>
    }
  `,
  styles: [
    `
      .runner { display: flex; flex-direction: column; gap: var(--cdf-space-2); }
      .lang { margin: 0; color: var(--cdf-color-text-muted); font-size: 13px; }
      .lang code { background: var(--cdf-color-surface-2, #eef1f6); padding: 1px 5px; border-radius: 4px; }
      .editor { width: 100%; font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 13px; line-height: 1.5; padding: var(--cdf-space-2); border: 1px solid var(--cdf-color-border, #d0d5dd); border-radius: 8px; background: #1e1e2e; color: #e6e6f0; resize: vertical; }
      .actions { display: flex; align-items: center; gap: var(--cdf-space-2); }
      .err { color: var(--cdf-color-danger, #d0454c); font-size: 13px; margin: 0; }
      .tests { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 4px; }
      .tests li { display: flex; align-items: center; gap: 6px; font-size: 13px; }
      .tests--fail { color: var(--cdf-color-danger, #d0454c); }
      .tests__name { font-weight: 600; }
      .tests__diff { color: var(--cdf-color-text-muted); font-size: 12px; }
      .done { color: var(--cdf-color-success, #2e9e5b); font-weight: 700; display: flex; align-items: center; gap: 6px; margin: var(--cdf-space-2) 0 0; }
    `,
  ],
})
export class ExerciseRunnerComponent {
  readonly lessonId = input.required<string>();
  /** Emits the SubmitResult when the exercise is first passed. */
  readonly completed = output<SubmitResult>();

  private readonly client = inject(ExercisesClient);
  private readonly orchestrator = inject(RewardOrchestrator);

  protected readonly loading = signal(true);
  protected readonly exercise = signal<StudentExercise | null>(null);
  protected code = '';
  protected readonly running = signal(false);
  protected readonly submitting = signal(false);
  protected readonly results = signal<ExerciseTestResult[]>([]);
  protected readonly verdict = signal<string | null>(null);
  protected readonly scorePct = signal(0);
  protected readonly error = signal<string | null>(null);
  protected readonly passed = signal(false);

  constructor() {
    // Reload whenever the bound lesson changes.
    void this.load();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      const ex = await this.client.forLesson(this.lessonId());
      this.exercise.set(ex);
      this.code = ex.starterCode;
      this.passed.set(ex.alreadyPassed);
    } catch {
      this.exercise.set(null);
    } finally {
      this.loading.set(false);
    }
  }

  protected async run(): Promise<void> {
    const ex = this.exercise();
    if (!ex) return;
    this.running.set(true);
    this.error.set(null);
    try {
      const res = await this.client.run(ex.id, this.code);
      this.applyResults(res);
    } catch (err) {
      this.error.set(this.describe(err));
    } finally {
      this.running.set(false);
    }
  }

  protected async submit(ev: MouseEvent): Promise<void> {
    const ex = this.exercise();
    if (!ex) return;
    this.submitting.set(true);
    this.error.set(null);
    try {
      const res = await this.client.submit(ex.id, this.code);
      this.applyResults(res);
      if (res.passed) {
        this.passed.set(true);
        if (res.reward) {
          const src = (ev?.currentTarget as HTMLElement) ?? null;
          void this.orchestrator.grant({
            kind: 'exercisePass',
            canonical: { xp: res.reward.xp, coins: res.reward.coins, multiplier: res.reward.multiplier, breakdown: res.reward.breakdown },
            levelUp: res.reward.levelUp ? { newLevel: res.reward.levelUp.newLevel, xpForNextLevel: res.reward.levelUp.xpForNextLevel } : null,
            badgesUnlocked: (res.badgesUnlocked ?? []).map((b) => ({ id: b.id, name: b.name, icon: b.icon, description: b.description })),
            sourceEl: src,
          });
        }
        this.completed.emit(res);
      }
    } catch (err) {
      this.error.set(this.describe(err));
    } finally {
      this.submitting.set(false);
    }
  }

  private applyResults(res: { results: ExerciseTestResult[]; verdict: string; scorePct: number }): void {
    this.results.set(res.results);
    this.verdict.set(res.verdict);
    this.scorePct.set(res.scorePct);
  }

  protected fmt(v: unknown): string {
    try {
      return JSON.stringify(v);
    } catch {
      return String(v);
    }
  }

  private describe(err: unknown): string {
    if (err instanceof ProblemDetailsError) {
      if (err.status === 429) return 'Slow down — one submission every few seconds.';
      if (err.isForbidden) return 'This lesson needs a subscription.';
      if (err.message) return err.message;
    }
    return 'Could not run your code.';
  }
}
