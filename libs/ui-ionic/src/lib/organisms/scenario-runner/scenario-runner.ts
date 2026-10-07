import {
  Component,
  ChangeDetectionStrategy,
  computed,
  effect,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { TranslatePipe } from '@codify/i18n';
import { AppBadge } from '../../atoms/app-badge/app-badge.js';
import { AppButton } from '../../atoms/app-button/app-button.js';
import { AppSkeleton } from '../../atoms/app-skeleton/app-skeleton.js';
import { Icon } from '../../atoms/icon/icon.js';

/** Structural mirrors of api-client scenario types. */
export interface ScenarioChoiceView {
  id: string;
  label: string;
  to?: string;
  ending?: boolean;
  outcome?: string;
}
export interface ScenarioNodeView {
  id: string;
  speaker?: string;
  text: string;
  choices: ScenarioChoiceView[];
}
export interface ScenarioGraphView {
  startId: string;
  nodes: Record<string, ScenarioNodeView>;
}

export interface ScenarioFinish {
  /** Choice ids in order — what `ScenariosClient.complete()` expects. */
  path: string[];
  sourceEl: HTMLElement | null;
}

/** Pure graph step: the next node (or null = ending) after a choice. */
export function stepScenario(
  graph: ScenarioGraphView,
  node: ScenarioNodeView,
  choiceId: string,
): { next: ScenarioNodeView | null; ended: boolean } {
  const choice = node.choices.find((c) => c.id === choiceId);
  if (!choice) return { next: node, ended: false };
  if (choice.ending) return { next: null, ended: true };
  const next = choice.to ? (graph.nodes[choice.to] ?? null) : null;
  if (!next) return { next: null, ended: true };
  return { next, ended: next.choices.length === 0 };
}

/**
 * Presentational branching-dialogue runner (docs/17-ai-grading §Scenario).
 * Walks the graph locally; when an ending is reached it emits `finished`
 * with the choice path so the app can record it (and play the reward).
 * The app passes back `outcome` / `error` / `recording`.
 *
 *   <cdf-scenario-runner [graph]="s.graph" [outcome]="outcome()" (finished)="complete($event)" />
 */
@Component({
  selector: 'cdf-scenario-runner',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AppBadge, AppButton, AppSkeleton, Icon, TranslatePipe],
  template: `
    @if (loading() || !graph()) {
      <cdf-app-skeleton shape="rect" [height]="160" />
    } @else {
      <div class="cdf-scenario">
        <ol class="cdf-scenario__transcript" aria-live="polite">
          @for (turn of transcript(); track $index) {
            <li
              class="cdf-scenario__bubble"
              [class.cdf-scenario__bubble--me]="turn.me"
            >
              @if (turn.speaker) {
                <p class="cdf-scenario__speaker">{{ turn.speaker }}</p>
              }
              <p class="cdf-scenario__text">{{ turn.text }}</p>
            </li>
          }
        </ol>

        @if (!ended() && node(); as n) {
          <div
            class="cdf-scenario__choices"
            role="group"
            [attr.aria-label]="'ui.scenario.choices' | translate"
          >
            @for (c of n.choices; track c.id) {
              <cdf-app-button
                kind="secondary"
                [fullWidth]="true"
                (buttonClick)="choose(c.id, $event)"
              >
                {{ c.label }} <cdf-icon name="chevron-forward" size="xs" />
              </cdf-app-button>
            }
          </div>
        }

        @if (ended()) {
          <div class="cdf-scenario__ending" role="status">
            @if (recording()) {
              <p class="cdf-scenario__done">
                {{ 'ui.scenario.saving' | translate }}
              </p>
            } @else {
              <p class="cdf-scenario__done">
                <cdf-icon name="trophy-outline" size="sm" />
                {{ 'ui.scenario.complete' | translate }}
              </p>
            }
            @if (outcome(); as o) {
              <cdf-app-badge variant="info" [subtle]="true">{{
                o
              }}</cdf-app-badge>
            }
            <cdf-app-button
              kind="ghost"
              size="sm"
              [disabled]="recording()"
              (buttonClick)="replay()"
            >
              <cdf-icon name="refresh" size="sm" />
              {{ 'ui.scenario.replay' | translate }}
            </cdf-app-button>
          </div>
        }

        @if (error(); as e) {
          <p class="cdf-scenario__error" role="alert">{{ e }}</p>
        }
      </div>
    }
  `,
  styleUrl: './scenario-runner.scss',
})
export class ScenarioRunner {
  readonly graph = input<ScenarioGraphView | null>(null);
  readonly loading = input(false);
  /** Outcome label returned by the server after `finished`. */
  readonly outcome = input<string | null>(null);
  readonly recording = input(false);
  readonly error = input<string | null>(null);

  readonly finished = output<ScenarioFinish>();
  readonly replayed = output<void>();
  readonly choiceMade = output<{ nodeId: string; choiceId: string }>();

  protected readonly node = signal<ScenarioNodeView | null>(null);
  protected readonly ended = signal(false);
  private readonly path = signal<string[]>([]);
  private readonly history = signal<
    { speaker?: string; text: string; me: boolean }[]
  >([]);

  protected readonly transcript = computed(() => {
    const n = this.node();
    const past = this.history();
    return n && !this.ended()
      ? [...past, { speaker: n.speaker, text: n.text, me: false }]
      : past;
  });

  constructor() {
    effect(() => {
      this.graph();
      untracked(() => this.reset());
    });
  }

  protected choose(choiceId: string, ev: MouseEvent): void {
    const g = this.graph();
    const n = this.node();
    if (!g || !n) return;
    const choice = n.choices.find((c) => c.id === choiceId);
    if (!choice) return;
    this.choiceMade.emit({ nodeId: n.id, choiceId });
    this.path.update((p) => [...p, choiceId]);
    this.history.update((h) => [
      ...h,
      { speaker: n.speaker, text: n.text, me: false },
      { text: choice.label, me: true },
    ]);
    const { next, ended } = stepScenario(g, n, choiceId);
    if (next && next !== n) this.node.set(next);
    if (ended) {
      if (next)
        this.history.update((h) => [
          ...h,
          { speaker: next.speaker, text: next.text, me: false },
        ]);
      this.ended.set(true);
      this.finished.emit({
        path: this.path(),
        sourceEl: (ev?.currentTarget as HTMLElement) ?? null,
      });
    }
  }

  protected replay(): void {
    this.reset();
    this.replayed.emit();
  }

  private reset(): void {
    const g = this.graph();
    this.path.set([]);
    this.history.set([]);
    this.ended.set(false);
    this.node.set(g ? (g.nodes[g.startId] ?? null) : null);
  }
}
