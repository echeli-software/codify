import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import {
  Badge,
  Button,
  FormField,
  Icon,
  Input,
  Textarea,
  ToastService,
} from '@codify/ui-bootstrap';
import { ExercisesClient, ProblemDetailsError, type ExerciseTestCase } from '@codify/api-client';

const SAMPLE_VISIBLE = JSON.stringify(
  [{ id: 'v1', name: 'returns sum', args: [1, 2], expected: 3 }],
  null,
  2,
);
const SAMPLE_HIDDEN = JSON.stringify([{ id: 'h1', name: 'negatives', args: [-1, -2], expected: -3 }], null, 2);

/**
 * Admin exercise editor — author the auto-graded coding exercise attached to
 * an EXERCISE lesson: language, entry function, starter + reference solution,
 * and visible/hidden test JSON. "Verify" runs the reference solution against
 * all tests before students see it (docs/12 §11).
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, Badge, Button, FormField, Icon, Input, Textarea],
  template: `
    <header class="page-header">
      <div>
        <h1>Exercise editor</h1>
        <p class="text-muted">Auto-graded code for this lesson. <a [routerLink]="['/lessons', lessonId()]">← Back to lesson</a></p>
      </div>
      <cdf-button kind="ghost" size="sm" [loading]="verifying()" (click)="verify()" data-testid="verify-btn">
        <cdf-icon name="check-circle" size="sm" /> Verify solution
      </cdf-button>
    </header>

    @if (verifyMsg(); as v) {
    <p class="verify" [class.verify--ok]="verifyOk()" data-testid="verify-result">{{ v }}</p>
    }

    <div class="card">
      <div class="grid">
        <cdf-form-field label="Language"><cdf-input [(ngModel)]="f.language" data-testid="ex-language" /></cdf-form-field>
        <cdf-form-field label="Entry function"><cdf-input [(ngModel)]="f.entryFunction" data-testid="ex-entry" /></cdf-form-field>
      </div>
      <cdf-form-field label="Starter code (shown to students)">
        <cdf-textarea [(ngModel)]="f.starterCode" [rows]="5" data-testid="ex-starter" />
      </cdf-form-field>
      <cdf-form-field label="Reference solution (never sent to students)">
        <cdf-textarea [(ngModel)]="f.solutionCode" [rows]="5" data-testid="ex-solution" />
      </cdf-form-field>
      <div class="grid">
        <cdf-form-field label="Visible tests (JSON)" [error]="errors().visible ?? null">
          <cdf-textarea [(ngModel)]="f.visibleTests" [rows]="6" data-testid="ex-visible" />
        </cdf-form-field>
        <cdf-form-field label="Hidden tests (JSON)" [error]="errors().hidden ?? null">
          <cdf-textarea [(ngModel)]="f.hiddenTests" [rows]="6" data-testid="ex-hidden" />
        </cdf-form-field>
      </div>
      <div class="actions">
        <cdf-button kind="primary" [loading]="saving()" (click)="save()" data-testid="ex-save">
          {{ exerciseId() ? 'Save exercise' : 'Create exercise' }}
        </cdf-button>
        @if (exerciseId()) { <cdf-badge variant="success" [subtle]="true">Attached</cdf-badge> }
      </div>
      @if (formError()) { <p class="form-error">{{ formError() }}</p> }
    </div>
  `,
  styles: [
    `
      :host { display: block; max-width: 1000px; margin: 0 auto; }
      .page-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: var(--cdf-space-3); h1 { margin: 0; font-size: var(--cdf-font-size-xl); } p { margin: 4px 0 0; } }
      .card { background: var(--cdf-color-surface); border: 1px solid var(--cdf-color-border); border-radius: var(--cdf-radius-md); padding: var(--cdf-space-4); }
      .grid { display: grid; grid-template-columns: 1fr 1fr; gap: var(--cdf-space-3); }
      .actions { display: flex; align-items: center; gap: var(--cdf-space-2); margin-top: var(--cdf-space-3); }
      .form-error, .verify { color: var(--cdf-color-danger); font-size: 13px; margin: var(--cdf-space-2) 0 0; }
      .verify--ok { color: var(--cdf-color-success); }
      cdf-textarea { font-family: ui-monospace, monospace; }
    `,
  ],
})
export class ExerciseEditorPage {
  private readonly route = inject(ActivatedRoute);
  private readonly client = inject(ExercisesClient);
  private readonly toast = inject(ToastService);

  protected readonly lessonId = signal<string>('');
  protected readonly exerciseId = signal<string | null>(null);
  protected readonly saving = signal(false);
  protected readonly verifying = signal(false);
  protected readonly verifyMsg = signal<string | null>(null);
  protected readonly verifyOk = signal(false);
  protected readonly formError = signal<string | null>(null);
  protected readonly errors = signal<{ visible?: string | null; hidden?: string | null }>({});

  protected f = {
    language: 'javascript',
    entryFunction: 'solution',
    starterCode: 'function solution(a, b) {\n  // your code\n}',
    solutionCode: 'function solution(a, b) {\n  return a + b;\n}',
    visibleTests: SAMPLE_VISIBLE,
    hiddenTests: SAMPLE_HIDDEN,
  };

  constructor() {
    const id = this.route.snapshot.paramMap.get('lessonId') ?? '';
    this.lessonId.set(id);
    void this.load(id);
  }

  private async load(lessonId: string): Promise<void> {
    try {
      const ex = await this.client.getAdminByLesson(lessonId);
      if (ex) {
        this.exerciseId.set(ex.id);
        this.f = {
          language: ex.language,
          entryFunction: ex.entryFunction,
          starterCode: ex.starterCode,
          solutionCode: ex.solutionCode,
          visibleTests: JSON.stringify(ex.visibleTestsJson, null, 2),
          hiddenTests: JSON.stringify(ex.hiddenTestsJson, null, 2),
        };
      }
    } catch {
      /* none yet — create flow */
    }
  }

  private parseTests(): { visible: ExerciseTestCase[]; hidden: ExerciseTestCase[] } | null {
    const errs: { visible?: string; hidden?: string } = {};
    let visible: ExerciseTestCase[] = [];
    let hidden: ExerciseTestCase[] = [];
    try { visible = JSON.parse(this.f.visibleTests); } catch { errs.visible = 'Invalid JSON'; }
    try { hidden = JSON.parse(this.f.hiddenTests); } catch { errs.hidden = 'Invalid JSON'; }
    this.errors.set(errs);
    return errs.visible || errs.hidden ? null : { visible, hidden };
  }

  protected async save(): Promise<void> {
    this.formError.set(null);
    const tests = this.parseTests();
    if (!tests) return;
    this.saving.set(true);
    try {
      const body = {
        language: this.f.language.trim(),
        entryFunction: this.f.entryFunction.trim(),
        starterCode: this.f.starterCode,
        solutionCode: this.f.solutionCode,
        visibleTests: tests.visible,
        hiddenTests: tests.hidden,
      };
      const ex = this.exerciseId()
        ? await this.client.update(this.exerciseId()!, body)
        : await this.client.create(this.lessonId(), body);
      this.exerciseId.set(ex.id);
      this.toast.success('Exercise saved');
    } catch (err) {
      this.formError.set(err instanceof ProblemDetailsError ? err.message || 'Save failed' : 'Save failed');
    } finally {
      this.saving.set(false);
    }
  }

  protected async verify(): Promise<void> {
    if (!this.exerciseId()) {
      await this.save();
      if (!this.exerciseId()) return;
    }
    this.verifying.set(true);
    this.verifyMsg.set(null);
    try {
      const res = await this.client.verify(this.exerciseId()!);
      this.verifyOk.set(res.ok);
      this.verifyMsg.set(res.ok ? `✓ Reference solution passes all tests (${res.scorePct}%).` : `✗ Reference solution failed (${res.scorePct}%) — fix the solution or tests.`);
    } catch {
      this.verifyOk.set(false);
      this.verifyMsg.set('Verification failed to run.');
    } finally {
      this.verifying.set(false);
    }
  }
}
