import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Badge, Button, FormField, Textarea, ToastService } from '@codify/ui-bootstrap';
import { ProblemDetailsError, ScenariosClient, type ScenarioGraph } from '@codify/api-client';

const SAMPLE = JSON.stringify(
  {
    startId: 'start',
    nodes: {
      start: {
        id: 'start',
        speaker: 'Customer',
        text: 'My order never arrived!',
        choices: [
          { id: 'a', label: 'Apologise and investigate', to: 'mid' },
          { id: 'b', label: 'Blame the courier', ending: true, outcome: 'bailed' },
        ],
      },
      mid: {
        id: 'mid',
        speaker: 'Customer',
        text: 'Okay, what now?',
        choices: [
          { id: 'x', label: 'Offer a refund', ending: true, outcome: 'resolved' },
          { id: 'y', label: 'Argue', ending: true, outcome: 'escalated' },
        ],
      },
    },
  },
  null,
  2,
);

/**
 * Admin scenario editor — author the branching dialogue graph attached to a
 * SCENARIO lesson. The graph is validated server-side on save (start node
 * exists, every choice target resolves, at least one ending). See
 * docs/17-ai-grading.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, Badge, Button, FormField, Textarea],
  template: `
    <header class="page-header">
      <div>
        <h1>Scenario editor</h1>
        <p class="text-muted">Branching dialogue for this lesson. <a [routerLink]="['/lessons', lessonId()]">← Back to lesson</a></p>
      </div>
    </header>

    <div class="card">
      <cdf-form-field label="Scenario graph (JSON: { startId, nodes })" [error]="graphError() ?? null">
        <cdf-textarea [(ngModel)]="graphText" [rows]="20" data-testid="scenario-graph" />
      </cdf-form-field>
      <div class="actions">
        <cdf-button kind="primary" [loading]="saving()" (click)="save()" data-testid="scenario-save">
          {{ scenarioId() ? 'Save scenario' : 'Create scenario' }}
        </cdf-button>
        @if (scenarioId()) { <cdf-badge variant="success" [subtle]="true">Attached</cdf-badge> }
      </div>
      @if (formError()) { <p class="form-error">{{ formError() }}</p> }
    </div>
  `,
  styles: [
    `
      :host { display: block; max-width: 900px; margin: 0 auto; }
      .page-header { margin-bottom: var(--cdf-space-3); h1 { margin: 0; font-size: var(--cdf-font-size-xl); } p { margin: 4px 0 0; } }
      .card { background: var(--cdf-color-surface); border: 1px solid var(--cdf-color-border); border-radius: var(--cdf-radius-md); padding: var(--cdf-space-4); }
      .actions { display: flex; align-items: center; gap: var(--cdf-space-2); margin-top: var(--cdf-space-3); }
      .form-error { color: var(--cdf-color-danger); font-size: 13px; margin: var(--cdf-space-2) 0 0; }
      cdf-textarea { font-family: ui-monospace, monospace; }
    `,
  ],
})
export class ScenarioEditorPage {
  private readonly route = inject(ActivatedRoute);
  private readonly client = inject(ScenariosClient);
  private readonly toast = inject(ToastService);

  protected readonly lessonId = signal<string>('');
  protected readonly scenarioId = signal<string | null>(null);
  protected readonly saving = signal(false);
  protected readonly formError = signal<string | null>(null);
  protected readonly graphError = signal<string | null>(null);
  protected graphText = SAMPLE;

  constructor() {
    const id = this.route.snapshot.paramMap.get('lessonId') ?? '';
    this.lessonId.set(id);
    void this.load(id);
  }

  private async load(lessonId: string): Promise<void> {
    try {
      const s = await this.client.getByLesson(lessonId);
      if (s) {
        this.scenarioId.set(s.id);
        this.graphText = JSON.stringify(s.graphJson, null, 2);
      }
    } catch {
      /* none yet */
    }
  }

  protected async save(): Promise<void> {
    this.formError.set(null);
    let graph: ScenarioGraph;
    try {
      graph = JSON.parse(this.graphText);
      this.graphError.set(null);
    } catch {
      this.graphError.set('Invalid JSON');
      return;
    }
    this.saving.set(true);
    try {
      const s = this.scenarioId() ? await this.client.update(this.scenarioId()!, graph) : await this.client.create(this.lessonId(), graph);
      this.scenarioId.set(s.id);
      this.toast.success('Scenario saved');
    } catch (err) {
      this.formError.set(err instanceof ProblemDetailsError ? err.message || 'Save failed' : 'Save failed');
    } finally {
      this.saving.set(false);
    }
  }
}
