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
import { Icon } from '../../atoms/icon/icon.js';
import { CodeEditor } from '../../molecules/code-editor/code-editor.js';

/** Structural mirror of api-client `StudentExercise` (presentation subset). */
export interface ExerciseView {
  language: string;
  entryFunction: string;
  starterCode: string;
  visibleTests?: { id: string; name: string }[];
}

/** Structural mirror of api-client `ExerciseTestResult`. */
export interface ExerciseTestView {
  id: string;
  name: string;
  passed: boolean;
  actual?: unknown;
  expected?: unknown;
  error?: string;
  runtimeMs?: number;
}

export interface ExerciseAction {
  code: string;
  /** Origin element for the reward coin-fly. */
  sourceEl: HTMLElement | null;
}

let runnerSeq = 0;

/**
 * Presentational code-exercise surface (docs/12 §6): editor, Run / Submit,
 * verdict badge and per-test results. Pure inputs / outputs — the student
 * app owns the API calls and the reward (RewardOrchestrator).
 *
 *   <cdf-exercise-runner [exercise]="ex" [(code)]="code" [results]="results()"
 *     [verdict]="verdict()" [scorePct]="score()" [running]="running()"
 *     (run)="run($event.code)" (submitted)="submit($event)" />
 */
@Component({
  selector: 'cdf-exercise-runner',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AppBadge, AppButton, AppSkeleton, CodeEditor, Icon, TranslatePipe],
  template: `
    @if (loading() || !exercise()) {
      <cdf-app-skeleton shape="rect" [height]="180" />
    } @else {
      @let ex = exercise()!;
      <div class="cdf-runner" [attr.aria-busy]="running() || submitting()">
        <p class="cdf-runner__lang">
          <cdf-icon name="chip" size="xs" />
          {{
            'ui.exercise.signature'
              | translate: { language: ex.language, fn: ex.entryFunction }
          }}
        </p>

        <label class="cdf-runner__label" [for]="editorId">{{
          'ui.exercise.editor' | translate
        }}</label>
        <cdf-code-editor
          class="cdf-runner__editor"
          [inputId]="editorId"
          [value]="code()"
          (valueChange)="code.set($event)"
          [language]="ex.language"
          [readonly]="submitting() || offline()"
          [plain]="plainEditor()"
          [height]="editorHeight()"
        />

        <ng-content select="[cdfRunnerPreview]" />

        @if (offline()) {
          <p
            class="cdf-runner__offline"
            role="status"
            data-testid="runner-offline"
          >
            <cdf-icon name="cloud-offline" size="sm" />
            {{ 'ui.exercise.connectToRun' | translate }}
          </p>
        }

        <div class="cdf-runner__actions">
          <cdf-app-button
            kind="secondary"
            size="sm"
            [loading]="running()"
            [disabled]="submitting() || offline()"
            (buttonClick)="emitRun($event)"
          >
            <cdf-icon name="play" size="sm" />
            {{ 'ui.exercise.run' | translate }}
          </cdf-app-button>
          <cdf-app-button
            kind="primary"
            size="sm"
            [loading]="submitting()"
            [disabled]="running() || offline()"
            (buttonClick)="emitSubmit($event)"
          >
            {{ 'ui.exercise.submit' | translate }}
          </cdf-app-button>
          <cdf-app-button
            kind="ghost"
            size="sm"
            [disabled]="code() === ex.starterCode || offline()"
            (buttonClick)="code.set(ex.starterCode)"
          >
            {{ 'ui.exercise.reset' | translate }}
          </cdf-app-button>
          @if (verdict(); as v) {
            <cdf-app-badge
              [variant]="v === 'PASS' ? 'success' : 'danger'"
              [subtle]="true"
            >
              {{
                'ui.exercise.verdict'
                  | translate: { verdict: v, score: scorePct() }
              }}
            </cdf-app-badge>
          }
        </div>

        @if (error(); as e) {
          <p class="cdf-runner__error" role="alert">{{ e }}</p>
        }

        @if (results().length > 0) {
          <h3 class="cdf-runner__heading">
            {{
              'ui.exercise.testsSummary'
                | translate: { passed: passedCount(), total: results().length }
            }}
          </h3>
          <ul class="cdf-runner__tests" aria-live="polite">
            @for (r of results(); track r.id) {
              <li [class.cdf-runner__test--fail]="!r.passed">
                <cdf-icon
                  [name]="r.passed ? 'check-circle' : 'x-circle'"
                  size="sm"
                  [label]="
                    (r.passed ? 'ui.exercise.passed' : 'ui.exercise.failed')
                      | translate
                  "
                />
                <span class="cdf-runner__test-name">{{ r.name }}</span>
                @if (!r.passed && r.error) {
                  <span class="cdf-runner__diff">{{ r.error }}</span>
                } @else if (!r.passed) {
                  <span class="cdf-runner__diff">
                    {{
                      'ui.exercise.diff'
                        | translate
                          : { actual: fmt(r.actual), expected: fmt(r.expected) }
                    }}
                  </span>
                }
              </li>
            }
          </ul>
        }

        @if (passed()) {
          <p class="cdf-runner__done" role="status">
            <cdf-icon name="trophy" size="sm" />
            {{ 'ui.exercise.solved' | translate }}
          </p>
        }
      </div>
    }
  `,
  styleUrl: './exercise-runner.scss',
})
export class ExerciseRunner {
  readonly exercise = input<ExerciseView | null>(null);
  readonly code = model('');
  readonly loading = input(false);
  readonly running = input(false);
  readonly submitting = input(false);
  readonly results = input<ExerciseTestView[]>([]);
  readonly verdict = input<string | null>(null);
  readonly scorePct = input(0);
  readonly error = input<string | null>(null);
  readonly passed = input(false);
  /** Offline: code is shown read-only with "Connect to run code" (docs/16 §3). */
  readonly offline = input(false);
  /** Force the plain textarea instead of Monaco. */
  readonly plainEditor = input(false);
  readonly editorHeight = input(280);

  readonly run = output<ExerciseAction>();
  readonly submitted = output<ExerciseAction>();

  protected readonly editorId = `cdf-exercise-editor-${++runnerSeq}`;
  protected readonly passedCount = computed(
    () => this.results().filter((r) => r.passed).length,
  );

  protected emitRun(ev: MouseEvent): void {
    this.run.emit({
      code: this.code(),
      sourceEl: (ev?.currentTarget as HTMLElement) ?? null,
    });
  }

  protected emitSubmit(ev: MouseEvent): void {
    this.submitted.emit({
      code: this.code(),
      sourceEl: (ev?.currentTarget as HTMLElement) ?? null,
    });
  }

  protected fmt(v: unknown): string {
    try {
      return JSON.stringify(v);
    } catch {
      return String(v);
    }
  }
}
