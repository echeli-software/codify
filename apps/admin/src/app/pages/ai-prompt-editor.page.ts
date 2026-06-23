import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Badge, Button, FormField, Icon, Input, Textarea, ToastService } from '@codify/ui-bootstrap';
import { AiPromptsClient, ProblemDetailsError, type CriterionResult, type RubricCriterion } from '@codify/api-client';

const SAMPLE_RUBRIC = JSON.stringify(
  [
    { id: 'kw', label: 'Mentions the key concept', weight: 2, kind: 'keyword', config: { all: ['try', 'catch'] } },
    { id: 'len', label: 'Explains in enough detail', weight: 1, kind: 'minWords', config: { min: 20 } },
    { id: 'why', label: 'Explains WHY it matters', weight: 2, kind: 'llm', config: { concepts: ['crash', 'user', 'recover'] } },
  ],
  null,
  2,
);

/**
 * Admin AI-prompt editor — author the rubric-graded prompt attached to an
 * AI_PROMPT lesson. The rubric is a list of weighted criteria (keyword / regex
 * / word-count / llm). "Preview" grades a sample answer through the same
 * pipeline students hit. See docs/17-ai-grading.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, Badge, Button, FormField, Icon, Input, Textarea],
  template: `
    <header class="page-header">
      <div>
        <h1>AI prompt editor</h1>
        <p class="text-muted">Rubric-graded answer for this lesson. <a [routerLink]="['/lessons', lessonId()]">← Back to lesson</a></p>
      </div>
    </header>

    <div class="card">
      <cdf-form-field label="Prompt (shown to the student)">
        <cdf-textarea [(ngModel)]="f.promptText" [rows]="3" data-testid="ai-prompt-text" />
      </cdf-form-field>
      <cdf-form-field label="Context (optional reference)">
        <cdf-textarea [(ngModel)]="f.contextText" [rows]="2" data-testid="ai-context" />
      </cdf-form-field>
      <div class="grid">
        <cdf-form-field label="Pass threshold (%)"><cdf-input type="number" [(ngModel)]="f.passThreshold" data-testid="ai-threshold" /></cdf-form-field>
        <cdf-form-field label="Max attempts (0 = unlimited)"><cdf-input type="number" [(ngModel)]="f.maxAttempts" data-testid="ai-attempts" /></cdf-form-field>
      </div>
      <cdf-form-field label="Rubric (JSON: [{ id, label, weight, kind, config }])" [error]="rubricError() ?? null">
        <cdf-textarea [(ngModel)]="f.rubric" [rows]="10" data-testid="ai-rubric" />
      </cdf-form-field>

      <div class="actions">
        <cdf-button kind="primary" [loading]="saving()" (click)="save()" data-testid="ai-save">
          {{ promptId() ? 'Save prompt' : 'Create prompt' }}
        </cdf-button>
        @if (promptId()) { <cdf-badge variant="success" [subtle]="true">Attached</cdf-badge> }
      </div>
      @if (formError()) { <p class="form-error">{{ formError() }}</p> }
    </div>

    <div class="card">
      <h3>Preview</h3>
      <cdf-form-field label="Sample answer">
        <cdf-textarea [(ngModel)]="sample" [rows]="4" data-testid="ai-sample" />
      </cdf-form-field>
      <cdf-button kind="ghost" [loading]="previewing()" (click)="preview()" data-testid="ai-preview-btn">
        <cdf-icon name="check-circle" size="sm" /> Grade sample
      </cdf-button>
      @if (previewResult(); as pr) {
      <p class="preview" [class.preview--ok]="pr.passed" data-testid="ai-preview-result">{{ pr.passed ? '✓' : '✗' }} {{ pr.scorePct }}%</p>
      <ul class="results">
        @for (r of pr.results; track r.id) {
        <li [class.results--fail]="!r.passed">{{ r.passed ? '✓' : '✗' }} {{ r.label }} <span class="muted">{{ r.detail }}</span></li>
        }
      </ul>
      }
    </div>
  `,
  styles: [
    `
      :host { display: block; max-width: 900px; margin: 0 auto; }
      .page-header { margin-bottom: var(--cdf-space-3); h1 { margin: 0; font-size: var(--cdf-font-size-xl); } p { margin: 4px 0 0; } }
      .card { background: var(--cdf-color-surface); border: 1px solid var(--cdf-color-border); border-radius: var(--cdf-radius-md); padding: var(--cdf-space-4); margin-bottom: var(--cdf-space-3); }
      .grid { display: grid; grid-template-columns: 1fr 1fr; gap: var(--cdf-space-3); }
      .actions { display: flex; align-items: center; gap: var(--cdf-space-2); margin-top: var(--cdf-space-3); }
      .form-error { color: var(--cdf-color-danger); font-size: 13px; margin: var(--cdf-space-2) 0 0; }
      .preview { font-weight: 700; color: var(--cdf-color-danger); }
      .preview--ok { color: var(--cdf-color-success); }
      .results { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 4px; font-size: 13px; }
      .results--fail { color: var(--cdf-color-danger); }
      .muted { color: var(--cdf-color-text-muted); }
    `,
  ],
})
export class AiPromptEditorPage {
  private readonly route = inject(ActivatedRoute);
  private readonly client = inject(AiPromptsClient);
  private readonly toast = inject(ToastService);

  protected readonly lessonId = signal<string>('');
  protected readonly promptId = signal<string | null>(null);
  protected readonly saving = signal(false);
  protected readonly previewing = signal(false);
  protected readonly formError = signal<string | null>(null);
  protected readonly rubricError = signal<string | null>(null);
  protected readonly previewResult = signal<{ scorePct: number; passed: boolean; results: CriterionResult[] } | null>(null);

  protected f = { promptText: 'Explain how to handle errors in JavaScript and why it matters.', contextText: '', passThreshold: 70, maxAttempts: 0, rubric: SAMPLE_RUBRIC };
  protected sample = '';

  constructor() {
    const id = this.route.snapshot.paramMap.get('lessonId') ?? '';
    this.lessonId.set(id);
    void this.load(id);
  }

  private async load(lessonId: string): Promise<void> {
    try {
      const p = await this.client.getByLesson(lessonId);
      if (p) {
        this.promptId.set(p.id);
        this.f = {
          promptText: p.promptText,
          contextText: p.contextText ?? '',
          passThreshold: p.passThreshold,
          maxAttempts: p.maxAttempts,
          rubric: JSON.stringify(p.rubricJson, null, 2),
        };
      }
    } catch {
      /* none yet */
    }
  }

  private parseRubric(): RubricCriterion[] | null {
    try {
      const parsed = JSON.parse(this.f.rubric);
      if (!Array.isArray(parsed)) throw new Error('not an array');
      this.rubricError.set(null);
      return parsed;
    } catch {
      this.rubricError.set('Invalid JSON');
      return null;
    }
  }

  protected async save(): Promise<void> {
    this.formError.set(null);
    const rubric = this.parseRubric();
    if (!rubric) return;
    this.saving.set(true);
    try {
      const body = {
        promptText: this.f.promptText,
        contextText: this.f.contextText || null,
        passThreshold: Number(this.f.passThreshold),
        maxAttempts: Number(this.f.maxAttempts),
        rubric,
      };
      const p = this.promptId() ? await this.client.update(this.promptId()!, body) : await this.client.create(this.lessonId(), body);
      this.promptId.set(p.id);
      this.toast.success('AI prompt saved');
    } catch (err) {
      this.formError.set(err instanceof ProblemDetailsError ? err.message || 'Save failed' : 'Save failed');
    } finally {
      this.saving.set(false);
    }
  }

  protected async preview(): Promise<void> {
    if (!this.promptId()) {
      await this.save();
      if (!this.promptId()) return;
    }
    this.previewing.set(true);
    try {
      this.previewResult.set(await this.client.preview(this.promptId()!, this.sample));
    } catch {
      this.previewResult.set(null);
    } finally {
      this.previewing.set(false);
    }
  }
}
