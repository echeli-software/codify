import {
  Component,
  ChangeDetectionStrategy,
  computed,
  input,
  model,
  output,
} from '@angular/core';
import { TranslatePipe } from '@codify/i18n';
import { AppBadge } from '../../atoms/app-badge/app-badge.js';
import { AppButton } from '../../atoms/app-button/app-button.js';
import { AppSkeleton } from '../../atoms/app-skeleton/app-skeleton.js';
import { Icon, type IconName } from '../../atoms/icon/icon.js';

/** Structural mirror of api-client `StudentAiPrompt` (presentation subset). */
export interface AiPromptView {
  promptText: string;
  contextText: string | null;
  passThreshold: number;
  maxAttempts: number;
  attemptsUsed: number;
  rubric: { id: string; label: string; weight: number }[];
}

/** Structural mirror of api-client `CriterionResult`. */
export interface AiCriterionView {
  id: string;
  label: string;
  weight: number;
  passed: boolean;
  detail?: string;
}

export type RubricState = 'idle' | 'pass' | 'fail';

export interface RubricRow {
  id: string;
  label: string;
  weight: number;
  state: RubricState;
  detail?: string;
}

/** Merge the static rubric with the latest grading results (pure). */
export function rubricRows(
  prompt: AiPromptView | null,
  results: readonly AiCriterionView[] | null,
): RubricRow[] {
  if (!prompt) return [];
  const byId = new Map((results ?? []).map((r) => [r.id, r]));
  return prompt.rubric.map((c) => {
    const r = byId.get(c.id);
    return {
      id: c.id,
      label: c.label,
      weight: c.weight,
      state: r ? (r.passed ? 'pass' : 'fail') : 'idle',
      detail: r?.detail,
    };
  });
}

const STATE_ICON: Record<RubricState, IconName> = {
  idle: 'help-circle',
  pass: 'check-circle',
  fail: 'x-circle',
};

let playgroundSeq = 0;

/**
 * Presentational AI-prompt surface (docs/17-ai-grading §6): prompt + context,
 * answer box with word count, submit, score badge, and a rubric checklist
 * that lights up with the grading result. Pure inputs / outputs — the app
 * calls `AiPromptsClient.submit()` and plays the reward.
 *
 *   <cdf-ai-prompt-playground [prompt]="p" [(response)]="answer" [results]="grade()?.results ?? null"
 *     [scorePct]="grade()?.scorePct ?? null" [passed]="grade()?.passed ?? false" (submitted)="submit($event)" />
 */
@Component({
  selector: 'cdf-ai-prompt-playground',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AppBadge, AppButton, AppSkeleton, Icon, TranslatePipe],
  template: `
    @if (loading() || !prompt()) {
      <cdf-app-skeleton shape="rect" [height]="200" />
    } @else {
      @let p = prompt()!;
      <div class="cdf-ai">
        <p class="cdf-ai__prompt">{{ p.promptText }}</p>
        @if (p.contextText) {
          <p class="cdf-ai__context">{{ p.contextText }}</p>
        }

        <label class="cdf-ai__label" [for]="answerId">{{
          'ui.aiPrompt.answer' | translate
        }}</label>
        <textarea
          class="cdf-ai__answer"
          rows="7"
          spellcheck="true"
          [id]="answerId"
          [attr.aria-describedby]="countId"
          [placeholder]="'ui.aiPrompt.placeholder' | translate"
          [value]="response()"
          [readonly]="submitting()"
          (input)="response.set($any($event.target).value)"
        ></textarea>
        <p class="cdf-ai__meta" [id]="countId">
          {{ 'ui.aiPrompt.words' | translate: { count: wordCount() } }}
          @if (p.maxAttempts > 0) {
            ·
            {{
              'ui.aiPrompt.attempts'
                | translate: { used: p.attemptsUsed, max: p.maxAttempts }
            }}
          }
        </p>

        <div class="cdf-ai__actions">
          <cdf-app-button
            kind="primary"
            size="sm"
            [loading]="submitting()"
            [disabled]="!canSubmit()"
            (buttonClick)="emitSubmit($event)"
          >
            <cdf-icon name="send" size="sm" />
            {{ 'ui.aiPrompt.submit' | translate }}
          </cdf-app-button>
          @if (scorePct() !== null) {
            <cdf-app-badge
              [variant]="passed() ? 'success' : 'danger'"
              [subtle]="true"
            >
              {{
                (passed()
                  ? 'ui.aiPrompt.scorePassed'
                  : 'ui.aiPrompt.scoreKeepGoing'
                ) | translate: { score: scorePct(), threshold: p.passThreshold }
              }}
            </cdf-app-badge>
          }
          @if (cached()) {
            <span class="cdf-ai__cached">{{
              'ui.aiPrompt.cached' | translate
            }}</span>
          }
        </div>

        @if (error(); as e) {
          <p class="cdf-ai__error" role="alert">{{ e }}</p>
        }

        <h3 class="cdf-ai__heading">{{ 'ui.aiPrompt.rubric' | translate }}</h3>
        <ul class="cdf-ai__rubric" aria-live="polite">
          @for (c of rows(); track c.id) {
            <li [attr.data-state]="c.state">
              <cdf-icon
                [name]="icon(c.state)"
                size="sm"
                [label]="'ui.aiPrompt.state.' + c.state | translate"
              />
              <span class="cdf-ai__criterion">{{ c.label }}</span>
              @if (c.detail) {
                <span class="cdf-ai__detail">{{ c.detail }}</span>
              }
            </li>
          }
        </ul>

        @if (passed()) {
          <p class="cdf-ai__done" role="status">
            <cdf-icon name="trophy-outline" size="sm" />
            {{ 'ui.aiPrompt.passed' | translate }}
          </p>
        }
      </div>
    }
  `,
  styleUrl: './ai-prompt-playground.scss',
})
export class AiPromptPlayground {
  readonly prompt = input<AiPromptView | null>(null);
  readonly response = model('');
  readonly loading = input(false);
  readonly submitting = input(false);
  readonly results = input<AiCriterionView[] | null>(null);
  readonly scorePct = input<number | null>(null);
  readonly passed = input(false);
  readonly cached = input(false);
  readonly error = input<string | null>(null);
  /** Minimum words before submit enables. */
  readonly minWords = input(1);

  readonly submitted = output<{
    response: string;
    sourceEl: HTMLElement | null;
  }>();

  protected readonly answerId = `cdf-ai-answer-${++playgroundSeq}`;
  protected readonly countId = `cdf-ai-count-${playgroundSeq}`;
  protected readonly rows = computed(() =>
    rubricRows(this.prompt(), this.results()),
  );
  protected readonly wordCount = computed(() => {
    const t = this.response().trim();
    return t ? t.split(/\s+/).length : 0;
  });
  protected readonly canSubmit = computed(() => {
    const p = this.prompt();
    const attemptsLeft =
      !p || p.maxAttempts <= 0 || p.attemptsUsed < p.maxAttempts;
    return (
      !this.submitting() && attemptsLeft && this.wordCount() >= this.minWords()
    );
  });

  protected icon(state: RubricState): IconName {
    return STATE_ICON[state];
  }

  protected emitSubmit(ev: MouseEvent): void {
    if (!this.canSubmit()) return;
    this.submitted.emit({
      response: this.response(),
      sourceEl: (ev?.currentTarget as HTMLElement) ?? null,
    });
  }
}
