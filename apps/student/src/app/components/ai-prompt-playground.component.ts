import { ChangeDetectionStrategy, Component, type OnInit, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AppBadge, AppButton, AppSkeleton, Icon } from '@codify/ui-ionic';
import { RewardOrchestrator } from '@codify/gamification-engine';
import {
  AiPromptsClient,
  ProblemDetailsError,
  type CriterionResult,
  type GradeResult,
  type StudentAiPrompt,
} from '@codify/api-client';

interface ChecklistItem {
  id: string;
  label: string;
  weight: number;
  state: 'idle' | 'pass' | 'fail';
  detail?: string;
}

/**
 * AiPromptPlayground — the AI-prompt surface inside the lesson player
 * (docs/17-ai-grading §6). Write an answer, submit, and watch the rubric
 * checklist light up; a first pass plays the reward and reports completion.
 */
@Component({
  selector: 'cdf-ai-prompt-playground',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, AppBadge, AppButton, AppSkeleton, Icon],
  template: `
    @if (loading()) {
    <cdf-app-skeleton shape="rect" />
    } @else if (prompt(); as p) {
    <div class="playground" data-testid="ai-playground">
      <p class="prompt">{{ p.promptText }}</p>
      @if (p.contextText) { <p class="context">{{ p.contextText }}</p> }

      <textarea class="answer" spellcheck="true" [(ngModel)]="response" rows="7" data-testid="ai-answer" placeholder="Write your answer…"></textarea>

      <div class="actions">
        <cdf-app-button kind="primary" size="sm" [loading]="submitting()" (buttonClick)="submit($event)" data-testid="ai-submit">Submit</cdf-app-button>
        @if (scorePct() !== null) {
        <cdf-app-badge [variant]="passed() ? 'success' : 'danger'" [subtle]="true" data-testid="ai-score">
          {{ scorePct() }}% {{ passed() ? '· Passed' : '· Keep going' }}
        </cdf-app-badge>
        }
        @if (cached()) { <span class="cached" data-testid="ai-cached">cached</span> }
      </div>

      @if (error(); as e) { <p class="err" data-testid="ai-error">{{ e }}</p> }

      <ul class="rubric" data-testid="ai-rubric">
        @for (c of checklist(); track c.id) {
        <li [attr.data-state]="c.state" [attr.data-cid]="c.id">
          <cdf-icon [name]="c.state === 'pass' ? 'check-circle' : c.state === 'fail' ? 'x-circle' : 'help-circle'" size="sm" />
          <span class="rubric__label">{{ c.label }}</span>
          @if (c.detail) { <span class="rubric__detail">{{ c.detail }}</span> }
        </li>
        }
      </ul>

      @if (passed()) {
      <p class="done" data-testid="ai-passed"><cdf-icon name="trophy-outline" size="sm" /> Nice work — rubric met!</p>
      }
    </div>
    }
  `,
  styles: [
    `
      .playground { display: flex; flex-direction: column; gap: var(--cdf-space-2); }
      .prompt { font-weight: 600; margin: 0; }
      .context { color: var(--cdf-color-text-muted); font-size: 13px; margin: 0; }
      .answer { width: 100%; font: inherit; font-size: 14px; line-height: 1.5; padding: var(--cdf-space-2); border: 1px solid var(--cdf-color-border, #d0d5dd); border-radius: 8px; resize: vertical; }
      .actions { display: flex; align-items: center; gap: var(--cdf-space-2); }
      .cached { color: var(--cdf-color-text-muted); font-size: 12px; }
      .err { color: var(--cdf-color-danger, #d0454c); font-size: 13px; margin: 0; }
      .rubric { list-style: none; padding: 0; margin: var(--cdf-space-1) 0 0; display: flex; flex-direction: column; gap: 6px; }
      .rubric li { display: flex; align-items: center; gap: 8px; font-size: 14px; color: var(--cdf-color-text-muted); transition: color .2s; }
      .rubric li[data-state='pass'] { color: var(--cdf-color-success, #2e9e5b); }
      .rubric li[data-state='fail'] { color: var(--cdf-color-danger, #d0454c); }
      .rubric__label { font-weight: 500; }
      .rubric__detail { font-size: 12px; opacity: 0.85; }
      .done { color: var(--cdf-color-success, #2e9e5b); font-weight: 700; display: flex; align-items: center; gap: 6px; margin: var(--cdf-space-2) 0 0; }
    `,
  ],
})
export class AiPromptPlaygroundComponent implements OnInit {
  readonly lessonId = input.required<string>();
  readonly completed = output<GradeResult>();

  private readonly client = inject(AiPromptsClient);
  private readonly orchestrator = inject(RewardOrchestrator);

  protected readonly loading = signal(true);
  protected readonly prompt = signal<StudentAiPrompt | null>(null);
  protected response = '';
  protected readonly submitting = signal(false);
  protected readonly scorePct = signal<number | null>(null);
  protected readonly passed = signal(false);
  protected readonly cached = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly checklist = signal<ChecklistItem[]>([]);

  ngOnInit(): void {
    void this.load();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      const p = await this.client.forLesson(this.lessonId());
      this.prompt.set(p);
      this.passed.set(p.alreadyPassed);
      this.checklist.set(p.rubric.map((c) => ({ id: c.id, label: c.label, weight: c.weight, state: 'idle' })));
    } catch {
      this.prompt.set(null);
    } finally {
      this.loading.set(false);
    }
  }

  protected async submit(ev: MouseEvent): Promise<void> {
    const p = this.prompt();
    if (!p) return;
    this.submitting.set(true);
    this.error.set(null);
    try {
      const res = await this.client.submit(p.id, this.response);
      this.applyResults(res.results);
      this.scorePct.set(res.scorePct);
      this.cached.set(res.cached);
      if (res.passed) {
        this.passed.set(true);
        if (res.reward) {
          const src = (ev?.currentTarget as HTMLElement) ?? null;
          void this.orchestrator.grant({
            kind: 'lessonComplete',
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

  private applyResults(results: CriterionResult[]): void {
    const byId = new Map(results.map((r) => [r.id, r]));
    this.checklist.update((items) =>
      items.map((it) => {
        const r = byId.get(it.id);
        return r ? { ...it, state: r.passed ? 'pass' : 'fail', detail: r.detail } : it;
      }),
    );
  }

  private describe(err: unknown): string {
    if (err instanceof ProblemDetailsError) {
      if (err.status === 429) return 'Slow down — wait a few seconds between submissions.';
      if (err.isForbidden) return 'This lesson needs a subscription.';
      if (err.message) return err.message;
    }
    return 'Could not grade your answer.';
  }
}
