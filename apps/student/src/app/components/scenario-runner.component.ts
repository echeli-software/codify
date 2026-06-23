import { ChangeDetectionStrategy, Component, type OnInit, inject, input, output, signal } from '@angular/core';
import { AppBadge, AppButton, AppSkeleton, Icon } from '@codify/ui-ionic';
import { RewardOrchestrator } from '@codify/gamification-engine';
import {
  ProblemDetailsError,
  ScenariosClient,
  type CompleteResult,
  type ScenarioGraph,
  type ScenarioNode,
  type StudentScenario,
} from '@codify/api-client';

/**
 * ScenarioRunner — branching-dialogue surface inside the lesson player
 * (docs/17-ai-grading §Scenario). Walk the graph by choosing replies; on
 * reaching an ending we record the play-through, play the first-completion
 * reward, and offer a replay.
 */
@Component({
  selector: 'cdf-scenario-runner',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AppBadge, AppButton, AppSkeleton, Icon],
  template: `
    @if (loading()) {
    <cdf-app-skeleton shape="rect" />
    } @else if (graph(); as g) {
    <div class="scenario" data-testid="scenario-runner">
      @if (node(); as n) {
      <div class="bubble" data-testid="scenario-node" [attr.data-node-id]="n.id">
        @if (n.speaker) { <p class="speaker">{{ n.speaker }}</p> }
        <p class="text">{{ n.text }}</p>
      </div>

      @if (!ended()) {
      <div class="choices" data-testid="scenario-choices">
        @for (c of n.choices; track c.id) {
        <cdf-app-button kind="secondary" [fullWidth]="true" (buttonClick)="choose(c.id, $event)" [attr.data-choice-id]="c.id">
          {{ c.label }} <cdf-icon name="chevron-forward" size="xs" />
        </cdf-app-button>
        }
      </div>
      }
      }

      @if (ended()) {
      <div class="ending" data-testid="scenario-ending">
        <p class="done"><cdf-icon name="trophy-outline" size="sm" /> Scenario complete</p>
        @if (outcome()) { <cdf-app-badge variant="info" [subtle]="true" data-testid="scenario-outcome">{{ outcome() }}</cdf-app-badge> }
        <cdf-app-button kind="ghost" size="sm" (buttonClick)="replay()" data-testid="scenario-replay">
          <cdf-icon name="refresh" size="sm" /> Play again
        </cdf-app-button>
      </div>
      }

      @if (error(); as e) { <p class="err" data-testid="scenario-error">{{ e }}</p> }
    </div>
    }
  `,
  styles: [
    `
      .scenario { display: flex; flex-direction: column; gap: var(--cdf-space-3); }
      .bubble { background: var(--cdf-color-surface-2, #eef1f6); border-radius: 12px; padding: var(--cdf-space-3); }
      .speaker { margin: 0 0 4px; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; color: var(--cdf-color-text-muted); }
      .text { margin: 0; font-size: 15px; line-height: 1.5; }
      .choices { display: flex; flex-direction: column; gap: var(--cdf-space-2); }
      .ending { display: flex; flex-direction: column; align-items: flex-start; gap: var(--cdf-space-2); }
      .done { color: var(--cdf-color-success, #2e9e5b); font-weight: 700; display: flex; align-items: center; gap: 6px; margin: 0; }
      .err { color: var(--cdf-color-danger, #d0454c); font-size: 13px; margin: 0; }
    `,
  ],
})
export class ScenarioRunnerComponent implements OnInit {
  readonly lessonId = input.required<string>();
  readonly completed = output<CompleteResult>();

  private readonly client = inject(ScenariosClient);
  private readonly orchestrator = inject(RewardOrchestrator);

  protected readonly loading = signal(true);
  protected readonly graph = signal<ScenarioGraph | null>(null);
  protected readonly node = signal<ScenarioNode | null>(null);
  protected readonly ended = signal(false);
  protected readonly outcome = signal<string | undefined>(undefined);
  protected readonly error = signal<string | null>(null);

  private scenarioId = '';
  private rewarded = false;
  private path: string[] = [];

  ngOnInit(): void {
    void this.load();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      const s: StudentScenario = await this.client.forLesson(this.lessonId());
      this.scenarioId = s.id;
      this.rewarded = s.alreadyCompleted;
      this.graph.set(s.graph);
      this.reset();
    } catch {
      this.graph.set(null);
    } finally {
      this.loading.set(false);
    }
  }

  protected replay(): void {
    this.reset();
  }

  private reset(): void {
    const g = this.graph();
    if (!g) return;
    this.path = [];
    this.ended.set(false);
    this.outcome.set(undefined);
    this.error.set(null);
    this.node.set(g.nodes[g.startId] ?? null);
  }

  protected async choose(choiceId: string, ev: MouseEvent): Promise<void> {
    const g = this.graph();
    const current = this.node();
    if (!g || !current) return;
    const choice = current.choices.find((c) => c.id === choiceId);
    if (!choice) return;
    this.path = [...this.path, choiceId];

    if (choice.ending) {
      await this.finish(ev);
      return;
    }
    const next = choice.to ? g.nodes[choice.to] : null;
    if (!next) {
      await this.finish(ev); // terminal with no target
      return;
    }
    this.node.set(next);
    // A choiceless node is itself an ending.
    if (next.choices.length === 0) await this.finish(ev);
  }

  private async finish(ev: MouseEvent): Promise<void> {
    try {
      const res = await this.client.complete(this.scenarioId, this.path);
      this.ended.set(true);
      this.outcome.set(res.outcome);
      if (res.completed && res.reward && !this.rewarded) {
        this.rewarded = true;
        const src = (ev?.currentTarget as HTMLElement) ?? null;
        void this.orchestrator.grant({
          kind: 'lessonComplete',
          canonical: { xp: res.reward.xp, coins: res.reward.coins, multiplier: res.reward.multiplier, breakdown: res.reward.breakdown },
          levelUp: res.reward.levelUp ? { newLevel: res.reward.levelUp.newLevel, xpForNextLevel: res.reward.levelUp.xpForNextLevel } : null,
          badgesUnlocked: (res.badgesUnlocked ?? []).map((b) => ({ id: b.id, name: b.name, icon: b.icon, description: b.description })),
          sourceEl: src,
        });
        this.completed.emit(res);
      }
    } catch (err) {
      this.error.set(err instanceof ProblemDetailsError && err.message ? err.message : 'Could not record this scenario.');
    }
  }
}
