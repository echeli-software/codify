import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { map } from 'rxjs';
import { I18nService, LocalePipe, TranslatePipe } from '@codify/i18n';
import {
  Badge,
  BreadcrumbBar,
  type BreadcrumbCrumb,
  Button,
  FormField,
  Icon,
  IconButton,
  Input,
  Select,
  type SelectOption,
  ToastService,
} from '@codify/ui-bootstrap';
import {
  AiPromptsClient,
  LessonsClient,
  type AiPromptPreview,
  type Lesson,
} from '@codify/api-client';
import { AdminErrors, validationProblemsOf } from '../core/errors';
import {
  ALLOWED_REGEX_FLAGS,
  CRITERION_KINDS,
  addCriterion,
  draftProblems,
  fromDraft,
  mapRubricErrors,
  moveCriterion,
  removeCriterion,
  toDraft,
  totalWeight,
  weightHint,
  weightShare,
  type CriterionDraft,
  type CriterionKind,
} from '../core/rubric';
import { type HasUnsavedChanges, warnOnUnload } from '../core/unsaved-changes';

/**
 * AI prompt / capstone editor (docs/17): prompt + context, a structured
 * rubric builder (add / remove / reorder criteria, kind-specific config,
 * weight guidance), pass threshold and attempt cap, and a preview that
 * grades a sample answer showing `gradedBy` and per-criterion results.
 * `INVALID_RUBRIC` problems from the API are shown on the criterion they
 * belong to.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    RouterLink,
    Badge,
    BreadcrumbBar,
    Button,
    FormField,
    Icon,
    IconButton,
    Input,
    Select,
    TranslatePipe,
    LocalePipe,
  ],
  template: `
    <div class="admin-page">
      <cdf-breadcrumb-bar [crumbs]="crumbs()" />
      <header class="page-head">
        <div>
          <h1>
            {{
              (isCapstone()
                ? 'admin.aiPrompt.capstoneTitle'
                : 'admin.aiPrompt.title'
              ) | translate
            }}
          </h1>
          <p class="muted">
            {{ 'admin.aiPrompt.subtitle' | translate }}
            <a [routerLink]="['/lessons', lessonId()]">{{
              'admin.exercise.backToLesson' | translate
            }}</a>
          </p>
        </div>
        <div class="page-head__actions">
          @if (promptId()) {
            <cdf-badge variant="success" [subtle]="true">{{
              'admin.exercise.attached' | translate
            }}</cdf-badge>
          }
          <cdf-button
            kind="primary"
            [loading]="saving()"
            [disabled]="!dirty() && !!promptId()"
            (click)="save()"
            data-testid="save-ai-prompt"
          >
            {{
              (promptId()
                ? 'admin.common.saveChanges'
                : 'admin.aiPrompt.create'
              ) | translate
            }}
          </cdf-button>
        </div>
      </header>

      @if (generalErrors().length > 0) {
        <div class="admin-card" role="alert">
          <p class="form-error">
            {{ 'admin.errors.code.INVALID_RUBRIC' | translate }}
          </p>
          <ul class="issue-list">
            @for (e of generalErrors(); track $index) {
              <li>{{ e }}</li>
            }
          </ul>
        </div>
      }
      @if (formError(); as e) {
        <p class="form-error" role="alert">{{ e }}</p>
      }

      <section class="admin-card">
        <h2>{{ 'admin.aiPrompt.promptSection' | translate }}</h2>
        <div class="form-grid form-grid--2">
          <div class="span-all">
            <label class="form-label" for="ai-prompt-text">{{
              'admin.aiPrompt.promptText' | translate
            }}</label>
            <textarea
              id="ai-prompt-text"
              class="form-control"
              rows="4"
              [(ngModel)]="promptText"
              (ngModelChange)="touch()"
              [attr.aria-invalid]="!!promptError() || null"
            ></textarea>
            @if (promptError(); as e) {
              <p class="form-error" role="alert">{{ e }}</p>
            }
          </div>
          <div class="span-all">
            <label class="form-label" for="ai-context-text">{{
              'admin.aiPrompt.contextText' | translate
            }}</label>
            <textarea
              id="ai-context-text"
              class="form-control"
              rows="3"
              [(ngModel)]="contextText"
              (ngModelChange)="touch()"
              aria-describedby="ai-context-help"
            ></textarea>
            <p class="muted small" id="ai-context-help">
              {{ 'admin.aiPrompt.contextHelp' | translate }}
            </p>
          </div>
          <cdf-form-field
            [label]="'admin.aiPrompt.passThreshold' | translate"
            [help]="'admin.aiPrompt.passThresholdHelp' | translate"
            controlId="ai-threshold"
          >
            <cdf-input
              inputId="ai-threshold"
              type="number"
              [(ngModel)]="passThreshold"
              (ngModelChange)="touch()"
            />
          </cdf-form-field>
          <cdf-form-field
            [label]="'admin.aiPrompt.maxAttempts' | translate"
            [help]="'admin.aiPrompt.maxAttemptsHelp' | translate"
            controlId="ai-attempts"
          >
            <cdf-input
              inputId="ai-attempts"
              type="number"
              [(ngModel)]="maxAttempts"
              (ngModelChange)="touch()"
            />
          </cdf-form-field>
        </div>
      </section>

      <section class="admin-card" aria-labelledby="rubric-title">
        <header class="section-head">
          <h2 id="rubric-title">{{ 'admin.aiPrompt.rubric' | translate }}</h2>
          <div class="row-actions">
            <cdf-select
              [ariaLabel]="'admin.aiPrompt.newKind' | translate"
              [options]="kindOptions()"
              [(ngModel)]="newKind"
            />
            <cdf-button
              kind="secondary"
              size="sm"
              (click)="add()"
              data-testid="add-criterion"
            >
              <cdf-icon name="plus" size="sm" />
              {{ 'admin.aiPrompt.addCriterion' | translate }}
            </cdf-button>
          </div>
        </header>

        <p
          class="small"
          [class.text-danger]="hint() === 'zero'"
          aria-live="polite"
        >
          {{
            'admin.aiPrompt.weightHint.' + hint()
              | translate: { total: total() }
          }}
        </p>

        <ol class="plain-list criteria">
          @for (
            c of criteria();
            track c.uid;
            let i = $index;
            let first = $first;
            let last = $last
          ) {
            <li class="criterion" [attr.data-criterion]="c.id">
              <header class="criterion__head">
                <span class="muted mono">{{ i + 1 }}</span>
                <strong>{{
                  c.label || ('admin.aiPrompt.untitled' | translate)
                }}</strong>
                <cdf-badge variant="neutral" [subtle]="true">{{
                  'admin.aiPrompt.kinds.' + c.kind | translate
                }}</cdf-badge>
                <span class="muted small">{{
                  share(c) | locale: 'percent'
                }}</span>
                <span class="row-actions">
                  <cdf-icon-button
                    icon="caret-up"
                    size="sm"
                    [disabled]="first"
                    [ariaLabel]="'admin.common.moveUp' | translate"
                    (click)="move(c.uid, -1)"
                  />
                  <cdf-icon-button
                    icon="caret-down"
                    size="sm"
                    [disabled]="last"
                    [ariaLabel]="'admin.common.moveDown' | translate"
                    (click)="move(c.uid, 1)"
                  />
                  <cdf-icon-button
                    icon="trash"
                    size="sm"
                    kind="danger"
                    [ariaLabel]="
                      'admin.aiPrompt.removeCriterion' | translate: { n: i + 1 }
                    "
                    (click)="remove(c.uid)"
                  />
                </span>
              </header>
              <div class="form-grid">
                <cdf-form-field
                  [label]="'admin.aiPrompt.fields.label' | translate"
                  [controlId]="c.uid + '-label'"
                  [error]="fieldError(c, 'label')"
                >
                  <cdf-input
                    [inputId]="c.uid + '-label'"
                    [(ngModel)]="c.label"
                    (ngModelChange)="touch()"
                  />
                </cdf-form-field>
                <cdf-form-field
                  [label]="'admin.aiPrompt.fields.id' | translate"
                  [controlId]="c.uid + '-id'"
                  [error]="fieldError(c, 'id')"
                >
                  <cdf-input
                    [inputId]="c.uid + '-id'"
                    [(ngModel)]="c.id"
                    (ngModelChange)="touch()"
                  />
                </cdf-form-field>
                <cdf-form-field
                  [label]="'admin.aiPrompt.fields.kind' | translate"
                  [controlId]="c.uid + '-kind'"
                >
                  <cdf-select
                    [inputId]="c.uid + '-kind'"
                    [options]="kindOptions()"
                    [(ngModel)]="c.kind"
                    (ngModelChange)="touch()"
                  />
                </cdf-form-field>
                <cdf-form-field
                  [label]="'admin.aiPrompt.fields.weight' | translate"
                  [controlId]="c.uid + '-weight'"
                  [error]="fieldError(c, 'weight')"
                >
                  <cdf-input
                    [inputId]="c.uid + '-weight'"
                    type="number"
                    [(ngModel)]="c.weight"
                    (ngModelChange)="touch()"
                  />
                </cdf-form-field>

                @switch (c.kind) {
                  @case ('keyword') {
                    <div class="span-all form-grid form-grid--2">
                      <div>
                        <label class="form-label" [for]="c.uid + '-any'">{{
                          'admin.aiPrompt.fields.any' | translate
                        }}</label>
                        <textarea
                          class="form-control"
                          rows="2"
                          [id]="c.uid + '-any'"
                          [(ngModel)]="c.any"
                          (ngModelChange)="touch()"
                        ></textarea>
                      </div>
                      <div>
                        <label class="form-label" [for]="c.uid + '-all'">{{
                          'admin.aiPrompt.fields.all' | translate
                        }}</label>
                        <textarea
                          class="form-control"
                          rows="2"
                          [id]="c.uid + '-all'"
                          [(ngModel)]="c.all"
                          (ngModelChange)="touch()"
                        ></textarea>
                      </div>
                      <p class="muted small span-all">
                        {{ 'admin.aiPrompt.fields.termsHelp' | translate }}
                      </p>
                      @if (fieldError(c, 'terms'); as e) {
                        <p class="form-error span-all">{{ e }}</p>
                      }
                    </div>
                  }
                  @case ('regex') {
                    <cdf-form-field
                      class="span-2"
                      [label]="'admin.aiPrompt.fields.pattern' | translate"
                      [controlId]="c.uid + '-pattern'"
                      [error]="fieldError(c, 'pattern')"
                    >
                      <cdf-input
                        [inputId]="c.uid + '-pattern'"
                        [(ngModel)]="c.pattern"
                        (ngModelChange)="touch()"
                      />
                    </cdf-form-field>
                    <cdf-form-field
                      [label]="'admin.aiPrompt.fields.flags' | translate"
                      [help]="
                        'admin.aiPrompt.fields.flagsHelp'
                          | translate: { flags: allowedFlags }
                      "
                      [controlId]="c.uid + '-flags'"
                      [error]="fieldError(c, 'flags')"
                    >
                      <cdf-input
                        [inputId]="c.uid + '-flags'"
                        [(ngModel)]="c.flags"
                        (ngModelChange)="touch()"
                      />
                    </cdf-form-field>
                  }
                  @case ('minWords') {
                    <cdf-form-field
                      [label]="'admin.aiPrompt.fields.min' | translate"
                      [controlId]="c.uid + '-min'"
                      [error]="fieldError(c, 'min')"
                    >
                      <cdf-input
                        [inputId]="c.uid + '-min'"
                        type="number"
                        [(ngModel)]="c.min"
                        (ngModelChange)="touch()"
                      />
                    </cdf-form-field>
                  }
                  @case ('maxWords') {
                    <cdf-form-field
                      [label]="'admin.aiPrompt.fields.max' | translate"
                      [controlId]="c.uid + '-max'"
                      [error]="fieldError(c, 'max')"
                    >
                      <cdf-input
                        [inputId]="c.uid + '-max'"
                        type="number"
                        [(ngModel)]="c.max"
                        (ngModelChange)="touch()"
                      />
                    </cdf-form-field>
                  }
                  @case ('llm') {
                    <div class="span-all form-grid form-grid--2">
                      <div>
                        <label class="form-label" [for]="c.uid + '-concepts'">{{
                          'admin.aiPrompt.fields.concepts' | translate
                        }}</label>
                        <textarea
                          class="form-control"
                          rows="2"
                          [id]="c.uid + '-concepts'"
                          [(ngModel)]="c.concepts"
                          (ngModelChange)="touch()"
                        ></textarea>
                      </div>
                      <div>
                        <label
                          class="form-label"
                          [for]="c.uid + '-instruction'"
                          >{{
                            'admin.aiPrompt.fields.instruction' | translate
                          }}</label
                        >
                        <textarea
                          class="form-control"
                          rows="2"
                          [id]="c.uid + '-instruction'"
                          [(ngModel)]="c.instruction"
                          (ngModelChange)="touch()"
                        ></textarea>
                      </div>
                    </div>
                  }
                }
              </div>
              @if (apiErrors()[c.uid]; as errs) {
                <ul class="issue-list" role="alert">
                  @for (e of errs; track $index) {
                    <li>{{ e }}</li>
                  }
                </ul>
              }
            </li>
          } @empty {
            <li class="muted small">
              {{ 'admin.aiPrompt.noCriteria' | translate }}
            </li>
          }
        </ol>
      </section>

      <section class="admin-card" aria-labelledby="preview-title">
        <h2 id="preview-title">{{ 'admin.aiPrompt.preview' | translate }}</h2>
        <label class="form-label" for="ai-sample">{{
          'admin.aiPrompt.sampleAnswer' | translate
        }}</label>
        <textarea
          id="ai-sample"
          class="form-control"
          rows="4"
          [(ngModel)]="sample"
        ></textarea>
        <div class="form-actions">
          <cdf-button
            kind="secondary"
            [loading]="previewing()"
            [disabled]="!sample.trim()"
            (click)="runPreview()"
            data-testid="preview-ai-prompt"
          >
            {{ 'admin.aiPrompt.runPreview' | translate }}
          </cdf-button>
          @if (dirty() && promptId()) {
            <span class="muted small">{{
              'admin.aiPrompt.previewUsesSaved' | translate
            }}</span>
          }
        </div>
        @if (preview(); as p) {
          <div
            class="preview"
            aria-live="polite"
            data-testid="ai-preview-result"
          >
            <p class="chip-row">
              <cdf-badge [variant]="p.passed ? 'success' : 'danger'">{{
                (p.passed ? 'admin.aiPrompt.passed' : 'admin.aiPrompt.failed')
                  | translate
              }}</cdf-badge>
              <strong>{{ p.scorePct / 100 | locale: 'percent' }}</strong>
              <span class="muted small">{{
                'admin.aiPrompt.gradedBy.' + p.gradedBy | translate
              }}</span>
            </p>
            <table class="admin-table">
              <thead>
                <tr>
                  <th scope="col">
                    {{ 'admin.aiPrompt.fields.label' | translate }}
                  </th>
                  <th scope="col" class="num">
                    {{ 'admin.aiPrompt.fields.weight' | translate }}
                  </th>
                  <th scope="col">
                    {{ 'admin.exercise.cols.result' | translate }}
                  </th>
                  <th scope="col">{{ 'admin.aiPrompt.detail' | translate }}</th>
                </tr>
              </thead>
              <tbody>
                @for (r of p.results; track r.id) {
                  <tr>
                    <td>{{ r.label }}</td>
                    <td class="num">{{ r.weight }}</td>
                    <td>
                      <cdf-badge
                        [variant]="r.passed ? 'success' : 'danger'"
                        [subtle]="true"
                        >{{
                          (r.passed
                            ? 'admin.exercise.passed'
                            : 'admin.exercise.failed'
                          ) | translate
                        }}</cdf-badge
                      >
                    </td>
                    <td class="small">{{ r.detail ?? '' }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      </section>
    </div>
  `,
  styles: [
    `
      .criteria {
        display: flex;
        flex-direction: column;
        gap: var(--cdf-space-3);
      }
      .criterion {
        border: 1px solid var(--cdf-color-border);
        border-radius: var(--cdf-radius-sm);
        padding: var(--cdf-space-3);
      }
      .criterion__head {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--cdf-space-2);
        margin-bottom: var(--cdf-space-2);
        .row-actions {
          margin-left: auto;
        }
      }
      .span-2 {
        grid-column: span 2;
      }
      .preview {
        margin-top: var(--cdf-space-3);
      }
    `,
  ],
})
export class AiPromptEditorPage implements HasUnsavedChanges {
  private readonly route = inject(ActivatedRoute);
  private readonly client = inject(AiPromptsClient);
  private readonly lessons = inject(LessonsClient);
  private readonly toast = inject(ToastService);
  private readonly errorsSvc = inject(AdminErrors);
  private readonly i18n = inject(I18nService);

  protected readonly allowedFlags = ALLOWED_REGEX_FLAGS;
  protected readonly lessonId = signal('');
  protected readonly lesson = signal<Lesson | null>(null);
  protected readonly isCapstone = computed(
    () => this.lesson()?.type === 'CAPSTONE',
  );
  protected readonly promptId = signal<string | null>(null);
  protected readonly criteria = signal<CriterionDraft[]>([]);
  protected readonly dirty = signal(false);
  protected readonly saving = signal(false);
  protected readonly previewing = signal(false);
  protected readonly preview = signal<AiPromptPreview | null>(null);
  protected readonly formError = signal<string | null>(null);
  protected readonly promptError = signal<string | null>(null);
  protected readonly apiErrors = signal<Record<string, string[]>>({});
  protected readonly generalErrors = signal<string[]>([]);
  /** Show client-side field problems only after a save attempt. */
  protected readonly validated = signal(false);
  private readonly version = signal(0);

  protected promptText = '';
  protected contextText = '';
  protected passThreshold = 70;
  protected maxAttempts = 0;
  protected newKind: CriterionKind = 'keyword';
  protected sample = '';

  protected readonly total = computed(() => {
    this.version();
    return totalWeight(this.criteria());
  });
  protected readonly hint = computed(() => {
    this.version();
    return weightHint(this.criteria());
  });

  protected readonly kindOptions = computed<SelectOption<CriterionKind>[]>(
    () => {
      this.i18n.currentLocale();
      return CRITERION_KINDS.map((k) => ({
        value: k,
        label: this.i18n.t(`admin.aiPrompt.kinds.${k}`),
      }));
    },
  );

  protected readonly crumbs = computed<BreadcrumbCrumb[]>(() => {
    this.i18n.currentLocale();
    return [
      { label: this.i18n.t('admin.nav.courses'), routerLink: ['/courses'] },
      {
        label: this.lesson()?.title ?? this.i18n.t('admin.lesson.lesson'),
        routerLink: ['/lessons', this.lessonId()],
      },
      { label: this.i18n.t('admin.aiPrompt.title') },
    ];
  });

  constructor() {
    warnOnUnload(() => this.dirty());
    this.route.paramMap
      .pipe(
        map((p) => p.get('lessonId') ?? ''),
        takeUntilDestroyed(),
      )
      .subscribe((id) => {
        this.lessonId.set(id);
        void this.load(id);
      });
  }

  hasUnsavedChanges(): boolean {
    return this.dirty();
  }

  private async load(lessonId: string): Promise<void> {
    try {
      const [lesson, prompt] = await Promise.all([
        this.lessons.detail(lessonId),
        this.client.getByLesson(lessonId),
      ]);
      this.lesson.set(lesson);
      if (prompt) {
        this.promptId.set(prompt.id);
        this.promptText = prompt.promptText;
        this.contextText = prompt.contextText ?? '';
        this.passThreshold = prompt.passThreshold;
        this.maxAttempts = prompt.maxAttempts;
        this.criteria.set(prompt.rubricJson.map(toDraft));
      } else {
        this.criteria.set(addCriterion([], 'minWords'));
      }
      this.dirty.set(false);
      this.version.update((v) => v + 1);
    } catch (err) {
      this.errorsSvc.toast(err, 'admin.errors.loadFailed');
    }
  }

  protected touch(): void {
    this.dirty.set(true);
    this.version.update((v) => v + 1);
  }

  protected share(c: CriterionDraft): number {
    this.version();
    return weightShare(this.criteria(), c);
  }

  protected add(): void {
    this.criteria.update((l) => addCriterion(l, this.newKind));
    this.touch();
  }

  protected remove(uid: string): void {
    this.criteria.update((l) => removeCriterion(l, uid));
    this.touch();
  }

  protected move(uid: string, delta: -1 | 1): void {
    this.criteria.update((l) => moveCriterion(l, uid, delta));
    this.touch();
  }

  /** First client-side problem for a field, shown after a save attempt. */
  protected fieldError(c: CriterionDraft, field: string): string | null {
    this.version();
    if (!this.validated()) return null;
    return draftProblems(c).includes(field)
      ? this.i18n.t(`admin.aiPrompt.problems.${field}`)
      : null;
  }

  protected async save(): Promise<void> {
    this.validated.set(true);
    this.version.update((v) => v + 1);
    this.formError.set(null);
    this.apiErrors.set({});
    this.generalErrors.set([]);
    this.promptError.set(
      this.promptText.trim() ? null : this.i18n.t('admin.common.required'),
    );
    const list = this.criteria();
    if (this.promptError() || list.some((c) => draftProblems(c).length)) {
      this.formError.set(this.i18n.t('admin.aiPrompt.fixFields'));
      return;
    }

    const body = {
      promptText: this.promptText.trim(),
      contextText: this.contextText.trim() || null,
      rubric: list.map(fromDraft),
      passThreshold: Math.min(
        100,
        Math.max(0, Math.round(Number(this.passThreshold) || 0)),
      ),
      maxAttempts: Math.min(
        50,
        Math.max(0, Math.round(Number(this.maxAttempts) || 0)),
      ),
    };
    this.saving.set(true);
    try {
      const id = this.promptId();
      const saved = id
        ? await this.client.update(id, body)
        : await this.client.create(this.lessonId(), body);
      this.promptId.set(saved.id);
      this.dirty.set(false);
      this.toast.success(this.i18n.t('admin.aiPrompt.saved'));
    } catch (err) {
      const problems = validationProblemsOf(err, 'INVALID_RUBRIC');
      if (problems.length) {
        const mapped = mapRubricErrors(problems, list);
        this.apiErrors.set(mapped.byUid);
        this.generalErrors.set(mapped.general);
      } else {
        this.formError.set(
          this.errorsSvc.message(err, 'admin.errors.saveFailed'),
        );
      }
    } finally {
      this.saving.set(false);
    }
  }

  protected async runPreview(): Promise<void> {
    if (!this.promptId() || (this.dirty() && !this.saving())) {
      await this.save();
      if (!this.promptId() || this.dirty()) return;
    }
    const id = this.promptId();
    if (!id) return;
    this.previewing.set(true);
    this.preview.set(null);
    try {
      this.preview.set(await this.client.preview(id, this.sample));
    } catch (err) {
      this.errorsSvc.toast(err, 'admin.aiPrompt.previewFailed');
    } finally {
      this.previewing.set(false);
    }
  }
}
