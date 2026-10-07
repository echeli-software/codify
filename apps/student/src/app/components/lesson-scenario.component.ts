import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import {
  ProblemDetailsError,
  ScenariosClient,
  type StudentScenario,
} from '@codify/api-client';
import { RewardOrchestrator } from '@codify/gamification-engine';
import { I18nService, TranslatePipe } from '@codify/i18n';
import { ScenarioRunner, type ScenarioFinish } from '@codify/ui-ionic';
import { TelemetryService } from '../telemetry/telemetry.service.js';
import type { RunnerCompletion } from './lesson-exercise.component.js';
import { rewardPayload } from './reward-grant.js';
import { runnerError, type RunnerError } from './runner-errors.js';

/**
 * Wires the presentational `ScenarioRunner` (branching dialogue) to the
 * scenarios API: records each finished play-through, shows the outcome,
 * supports replay, explains the replay cooldown, and plays the first
 * completion's reward with canonical totals.
 */
@Component({
  selector: 'cdf-lesson-scenario',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ScenarioRunner, TranslatePipe],
  template: `
    @if (loadError(); as e) {
      <p class="ls__error" role="alert">{{ e.key | translate: e.params }}</p>
    } @else {
      <cdf-scenario-runner
        data-testid="scenario-runner"
        [graph]="scenario()?.graph ?? null"
        [loading]="loading()"
        [outcome]="outcome()"
        [recording]="recording()"
        [error]="errorText()"
        (choiceMade)="onChoice()"
        (finished)="finish($event)"
        (replayed)="replay()"
      />
    }
  `,
  styles: [
    `
      .ls__error {
        color: var(--cdf-color-danger);
      }
    `,
  ],
})
export class LessonScenarioComponent {
  readonly lessonId = input.required<string>();
  readonly completed = output<RunnerCompletion>();
  readonly paywall = output<unknown>();

  private readonly client = inject(ScenariosClient);
  private readonly orchestrator = inject(RewardOrchestrator);
  private readonly i18n = inject(I18nService);
  private readonly telemetry = inject(TelemetryService);

  protected readonly scenario = signal<StudentScenario | null>(null);
  protected readonly loading = signal(true);
  protected readonly loadError = signal<RunnerError | null>(null);
  protected readonly outcome = signal<string | null>(null);
  protected readonly recording = signal(false);
  protected readonly error = signal<RunnerError | null>(null);
  private depth = 0;

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
  }

  private async load(lessonId: string): Promise<void> {
    this.loading.set(true);
    this.loadError.set(null);
    try {
      this.scenario.set(await this.client.forLesson(lessonId));
    } catch (err) {
      if (err instanceof ProblemDetailsError && err.status === 402)
        this.paywall.emit(err);
      this.loadError.set(runnerError(err));
    } finally {
      this.loading.set(false);
    }
  }

  protected onChoice(): void {
    this.depth++;
    const s = this.scenario();
    if (s)
      this.telemetry.track('scenario_choice', {
        scenarioId: s.id,
        depth: this.depth,
      });
  }

  protected replay(): void {
    this.depth = 0;
    this.outcome.set(null);
    this.error.set(null);
  }

  protected async finish(ev: ScenarioFinish): Promise<void> {
    const s = this.scenario();
    if (!s) return;
    this.recording.set(true);
    this.error.set(null);
    try {
      const res = await this.client.complete(s.id, ev.path);
      this.outcome.set(res.outcome ?? null);
      this.telemetry.track('scenario_complete', {
        scenarioId: s.id,
        depth: res.depth,
        outcome: res.outcome ?? null,
      });
      if (res.completed) {
        if (res.reward) {
          void this.orchestrator.grant(
            rewardPayload(
              'scenarioComplete',
              res.reward,
              res.badgesUnlocked,
              ev.sourceEl,
            ),
          );
        }
        this.completed.emit({
          xp: res.reward?.xp ?? 0,
          coins: res.reward?.coins ?? 0,
        });
      }
    } catch (err) {
      if (err instanceof ProblemDetailsError && err.status === 402)
        this.paywall.emit(err);
      this.error.set(runnerError(err));
    } finally {
      this.recording.set(false);
    }
  }
}
