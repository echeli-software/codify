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
  AiPromptsClient,
  ProblemDetailsError,
  type CriterionResult,
  type StudentAiPrompt,
} from '@codify/api-client';
import { RewardOrchestrator } from '@codify/gamification-engine';
import { I18nService, TranslatePipe } from '@codify/i18n';
import {
  AiPromptPlayground,
  type AiCriterionView,
  type AiPromptView,
} from '@codify/ui-ionic';
import { OfflineGate } from '../platform/offline-gate.component.js';
import { TelemetryService } from '../telemetry/telemetry.service.js';
import type { RunnerCompletion } from './lesson-exercise.component.js';
import { rewardPayload } from './reward-grant.js';
import { runnerError, type RunnerError } from './runner-errors.js';

/**
 * Wires the presentational `AiPromptPlayground` to the AI-grading API
 * (docs/17): AI_PROMPT lessons and CAPSTONE projects (which reuse the same
 * machinery). Rubric rows light up from the grade; 429 cooldown / minute /
 * day limits and "no attempts left" are explained inline; a first pass
 * plays the reward with canonical totals. Online-only.
 */
@Component({
  selector: 'cdf-lesson-ai-prompt',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AiPromptPlayground, OfflineGate, TranslatePipe],
  template: `
    <cdf-offline-gate capability="aiPrompt">
      @if (loadError(); as e) {
        <p class="la__error" role="alert">{{ e.key | translate: e.params }}</p>
      } @else {
        @if (capstone()) {
          <p class="la__badge">{{ 'student.capstone.intro' | translate }}</p>
        }
        <cdf-ai-prompt-playground
          data-testid="ai-prompt-runner"
          [prompt]="view()"
          [(response)]="response"
          [loading]="loading()"
          [submitting]="submitting()"
          [results]="results()"
          [scorePct]="scorePct()"
          [passed]="passed()"
          [cached]="cached()"
          [error]="errorText()"
          (submitted)="submit($event)"
        />
      }
    </cdf-offline-gate>
  `,
  styles: [
    `
      .la__error {
        color: var(--cdf-color-danger);
      }
      .la__badge {
        font-size: var(--cdf-font-size-sm);
        color: var(--cdf-color-text-muted);
      }
    `,
  ],
})
export class LessonAiPromptComponent {
  readonly lessonId = input.required<string>();
  readonly completed = output<RunnerCompletion>();
  readonly paywall = output<unknown>();

  private readonly client = inject(AiPromptsClient);
  private readonly orchestrator = inject(RewardOrchestrator);
  private readonly i18n = inject(I18nService);
  private readonly telemetry = inject(TelemetryService);

  protected readonly prompt = signal<StudentAiPrompt | null>(null);
  protected readonly response = signal('');
  protected readonly loading = signal(true);
  protected readonly loadError = signal<RunnerError | null>(null);
  protected readonly submitting = signal(false);
  protected readonly results = signal<AiCriterionView[] | null>(null);
  protected readonly scorePct = signal<number | null>(null);
  protected readonly passed = signal(false);
  protected readonly cached = signal(false);
  protected readonly error = signal<RunnerError | null>(null);

  protected readonly capstone = computed(
    () => this.prompt()?.lessonType === 'CAPSTONE',
  );
  protected readonly view = computed<AiPromptView | null>(() => {
    const p = this.prompt();
    return p
      ? {
          promptText: p.promptText,
          contextText: p.contextText,
          passThreshold: p.passThreshold,
          maxAttempts: p.maxAttempts,
          attemptsUsed: p.attemptsUsed,
          rubric: p.rubric,
        }
      : null;
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
  }

  private async load(lessonId: string): Promise<void> {
    this.loading.set(true);
    this.loadError.set(null);
    try {
      const p = await this.client.forLesson(lessonId);
      this.prompt.set(p);
      this.passed.set(p.alreadyPassed);
    } catch (err) {
      if (err instanceof ProblemDetailsError && err.status === 402)
        this.paywall.emit(err);
      this.loadError.set(runnerError(err));
    } finally {
      this.loading.set(false);
    }
  }

  protected async submit(ev: {
    response: string;
    sourceEl: HTMLElement | null;
  }): Promise<void> {
    const p = this.prompt();
    if (!p || this.submitting()) return;
    this.submitting.set(true);
    this.error.set(null);
    try {
      const res = await this.client.submit(p.id, ev.response);
      this.results.set(res.results.map(toCriterionView));
      this.scorePct.set(res.scorePct);
      this.cached.set(res.cached);
      this.prompt.update((x) =>
        x ? { ...x, attemptsUsed: x.attemptsUsed + 1 } : x,
      );
      this.telemetry.track('ai_prompt_submit', {
        aiPromptId: p.id,
        scorePct: res.scorePct,
        passed: res.passed,
        cached: res.cached,
      });
      if (res.passed) {
        this.passed.set(true);
        if (res.reward) {
          void this.orchestrator.grant(
            rewardPayload(
              'aiPromptComplete',
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
      this.submitting.set(false);
    }
  }
}

function toCriterionView(r: CriterionResult): AiCriterionView {
  return {
    id: r.id,
    label: r.label,
    weight: r.weight,
    passed: r.passed,
    detail: r.detail,
  };
}
