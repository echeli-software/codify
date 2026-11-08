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
  toProblemDetails,
  type StudentScenario,
} from '@codify/api-client';
import { walkScenario, type ScenarioGraph } from '@codify/domain';
import { RewardOrchestrator } from '@codify/gamification-engine';
import { I18nService, TranslatePipe } from '@codify/i18n';
import { ScenarioRunner, type ScenarioFinish } from '@codify/ui-ionic';
import { TelemetryService } from '../telemetry/telemetry.service.js';
import { DownloadService } from '../offline/download.service.js';
import { NetworkStatusService } from '../offline/network-status.service.js';
import { OfflineSyncService } from '../offline/offline-sync.service.js';
import type { RunnerCompletion } from './lesson-exercise.component.js';
import { rewardPayload } from './reward-grant.js';
import { runnerError, type RunnerError } from './runner-errors.js';

/**
 * Wires the presentational `ScenarioRunner` (branching dialogue) to the
 * scenarios API: records each finished play-through, shows the outcome,
 * supports replay, explains the replay cooldown, and plays the first
 * completion's reward with canonical totals.
 *
 * Offline (docs/16 §3): the graph comes from the downloaded lesson, the
 * play-through is walked locally for the outcome, and the path is queued
 * as `scenario_complete` (Idempotency-Key + clientTimestamp) for the
 * server to re-score on sync.
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
      @if (queued()) {
        <p class="ls__queued" role="status" data-testid="scenario-queued">
          {{ 'student.runner.scenarioQueued' | translate }}
        </p>
      }
    }
  `,
  styles: [
    `
      .ls__error {
        color: var(--cdf-color-danger);
      }
      .ls__queued {
        color: var(--cdf-color-warning);
        font-size: var(--cdf-font-size-sm);
      }
    `,
  ],
})
export class LessonScenarioComponent {
  readonly lessonId = input.required<string>();
  /** For the sync sheet / estimated reward of a queued play-through. */
  readonly lessonTitle = input<string | null>(null);
  readonly estimate = input<{ xp: number; coins: number } | null>(null);
  readonly completed = output<RunnerCompletion>();
  readonly paywall = output<unknown>();

  private readonly client = inject(ScenariosClient);
  private readonly orchestrator = inject(RewardOrchestrator);
  private readonly i18n = inject(I18nService);
  private readonly telemetry = inject(TelemetryService);
  private readonly downloads = inject(DownloadService);
  private readonly network = inject(NetworkStatusService);
  private readonly sync = inject(OfflineSyncService);

  /** True when the graph came from the download (offline play). */
  protected readonly offline = signal(false);
  protected readonly queued = signal(false);
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
    this.offline.set(false);
    try {
      if (!this.network.online()) {
        if (await this.loadOffline(lessonId)) return;
      }
      this.scenario.set(await this.client.forLesson(lessonId));
    } catch (err) {
      if (err instanceof ProblemDetailsError && err.status === 402)
        this.paywall.emit(err);
      if (
        toProblemDetails(err).status === 0 &&
        (await this.loadOffline(lessonId))
      )
        return;
      this.loadError.set(runnerError(err));
    } finally {
      this.loading.set(false);
    }
  }

  /** Graph from the downloaded lesson; false when it isn't downloaded. */
  private async loadOffline(lessonId: string): Promise<boolean> {
    const bundle = await this.downloads
      .getLessonBundle(lessonId)
      .catch(() => null);
    const sc = bundle?.scenario;
    if (!sc) {
      this.loadError.set({ key: 'student.runner.scenarioOffline' });
      return !this.network.online();
    }
    this.scenario.set({
      id: sc.id,
      lessonId,
      graph: sc.graph as StudentScenario['graph'],
      alreadyCompleted: false,
    });
    this.offline.set(true);
    return true;
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
    this.queued.set(false);
  }

  protected async finish(ev: ScenarioFinish): Promise<void> {
    const s = this.scenario();
    if (!s) return;
    this.recording.set(true);
    this.error.set(null);
    try {
      const walk = walkScenario(s.graph as unknown as ScenarioGraph, ev.path);
      const outcome = await this.sync.completeScenario(
        this.lessonId(),
        s.id,
        ev.path,
        {
          title: this.lessonTitle() ?? undefined,
          estimate: this.estimate() ?? undefined,
          rubricScore: {
            depth: walk.depth,
            outcome: walk.outcome ?? null,
            completed: walk.completed,
          },
        },
      );
      if (outcome.status === 'queued') {
        this.outcome.set(walk.outcome ?? null);
        this.queued.set(true);
        this.telemetry.track('scenario_complete', {
          scenarioId: s.id,
          depth: walk.depth,
          outcome: walk.outcome ?? null,
          offline: true,
        });
        if (walk.completed)
          this.completed.emit({
            xp: this.estimate()?.xp ?? 0,
            coins: this.estimate()?.coins ?? 0,
            queued: true,
          });
        return;
      }
      const res = outcome.result;
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
