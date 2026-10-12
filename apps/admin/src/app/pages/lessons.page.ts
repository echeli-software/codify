import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { map } from 'rxjs';
import { emptyLessonDoc, type LessonDoc } from '@codify/lesson-schema';
import { I18nService, TranslatePipe } from '@codify/i18n';
import {
  Badge,
  BreadcrumbBar,
  type BreadcrumbCrumb,
  Button,
  Checkbox,
  Combobox,
  type ComboboxOption,
  ConfirmDialogService,
  EmptyState,
  FormField,
  Icon,
  Input,
  LessonBlockEditor,
  LessonBlockRenderer,
  Select,
  type SelectOption,
  Skeleton,
  ToastService,
} from '@codify/ui-bootstrap';
import {
  AiPromptsClient,
  CoursesClient,
  ExercisesClient,
  LessonsClient,
  ProblemDetailsError,
  ScenariosClient,
  type CourseDetail,
  type Lesson,
  type LessonType,
} from '@codify/api-client';
import {
  AdminErrors,
  contentIssuesOf,
  type ContentIssue,
} from '../core/errors';
import { LESSON_TYPES, lessonCompanion } from '../core/catalog';
import {
  REF_KINDS,
  appendDocRef,
  docRefs,
  refKindForLessonType,
  setDocRef,
  type RefCandidate,
  type RefKind,
} from '../core/lesson-refs';
import { type HasUnsavedChanges, warnOnUnload } from '../core/unsaved-changes';
import { EditorDocBinding } from '../core/editor-doc';

interface MetaForm {
  title: string;
  type: LessonType;
  estimatedMinutes: number;
  baseXp: number;
  baseCoins: number;
  isFree: boolean;
}

/**
 * Lesson editor: LessonBlockEditor (image uploads go through the app's
 * LESSON_ASSET_UPLOADER), live preview, lesson properties, and reference
 * pickers that point exercise / AI-prompt / scenario blocks at the course's
 * interactive lessons. Content validation failures from the API (400 +
 * `issues`) are listed inline. Unsaved work is protected by the
 * `unsavedChangesGuard` and a `beforeunload` prompt.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    ReactiveFormsModule,
    RouterLink,
    Badge,
    BreadcrumbBar,
    Button,
    Checkbox,
    Combobox,
    EmptyState,
    FormField,
    Icon,
    Input,
    LessonBlockEditor,
    LessonBlockRenderer,
    Select,
    Skeleton,
    TranslatePipe,
  ],
  template: `
    <div class="admin-page admin-page--wide">
      <cdf-breadcrumb-bar [crumbs]="crumbs()" />

      @if (lesson(); as l) {
        <header class="page-head">
          <div>
            <h1>{{ meta.title || l.title }}</h1>
            <p class="muted chip-row">
              <cdf-badge variant="info" [subtle]="true">{{
                'admin.lessonTypes.' + l.type | translate
              }}</cdf-badge>
              @if (l.isFree) {
                <cdf-badge variant="success" [subtle]="true">{{
                  'admin.course.free' | translate
                }}</cdf-badge>
              }
              @if (dirty()) {
                <span role="status">{{
                  'admin.lesson.unsaved' | translate
                }}</span>
              }
            </p>
          </div>
          <div class="page-head__actions">
            <div
              class="mode-switch"
              role="group"
              [attr.aria-label]="'admin.lesson.view' | translate"
            >
              @for (m of modes; track m) {
                <button
                  type="button"
                  class="seg"
                  [attr.aria-pressed]="mode() === m"
                  (click)="mode.set(m)"
                >
                  {{ 'admin.lesson.modes.' + m | translate }}
                </button>
              }
            </div>
            <cdf-button
              kind="primary"
              [loading]="saving()"
              [disabled]="!dirty()"
              (click)="save()"
              data-testid="save-lesson"
            >
              {{
                (dirty() ? 'admin.common.saveChanges' : 'admin.common.saved')
                  | translate
              }}
            </cdf-button>
            <cdf-button kind="danger" (click)="deleteLesson()">
              {{ 'admin.common.delete' | translate }}
            </cdf-button>
          </div>
        </header>

        @if (issues().length > 0) {
          <section
            class="admin-card issues"
            role="alert"
            aria-labelledby="issues-title"
          >
            <h2 id="issues-title">
              <cdf-icon name="warning" size="sm" />
              {{ 'admin.lesson.issuesTitle' | translate }}
            </h2>
            <ul class="issue-list">
              @for (i of issues(); track $index) {
                <li>
                  <code>{{ i.path || '/' }}</code> — {{ i.message }}
                </li>
              }
            </ul>
          </section>
        }

        <div class="grid" [attr.data-mode]="mode()">
          <section
            class="pane editor-pane"
            [attr.aria-label]="'admin.lesson.content' | translate"
          >
            <cdf-lesson-block-editor
              [formControl]="docBinding.control"
              [placeholder]="'admin.lesson.placeholder' | translate"
            />
          </section>

          <section
            class="pane preview-pane"
            [attr.aria-label]="'admin.lesson.preview' | translate"
          >
            <h2 class="pane-title">{{ 'admin.lesson.preview' | translate }}</h2>
            <cdf-lesson-block-renderer [doc]="doc" />
          </section>

          <aside class="pane meta-pane">
            <h2 class="pane-title">
              {{ 'admin.lesson.properties' | translate }}
            </h2>
            <cdf-form-field
              [label]="'admin.lesson.title' | translate"
              controlId="lesson-title"
              [error]="titleError()"
            >
              <cdf-input
                inputId="lesson-title"
                [(ngModel)]="meta.title"
                (ngModelChange)="markDirty()"
              />
            </cdf-form-field>
            <cdf-form-field
              [label]="'admin.course.lessonType' | translate"
              controlId="lesson-type"
            >
              <cdf-select
                inputId="lesson-type"
                [options]="typeOptions()"
                [(ngModel)]="meta.type"
                (ngModelChange)="markDirty()"
              />
            </cdf-form-field>
            @if (companion(meta.type); as comp) {
              <cdf-button
                kind="secondary"
                size="sm"
                [routerLink]="['/lessons', l.id, comp]"
              >
                <cdf-icon name="pencil" size="sm" />
                {{ 'admin.course.companion.' + comp | translate }}
              </cdf-button>
            }
            <div class="form-grid">
              <cdf-form-field
                [label]="'admin.course.estimatedMinutes' | translate"
                controlId="lesson-minutes"
              >
                <cdf-input
                  inputId="lesson-minutes"
                  type="number"
                  [(ngModel)]="meta.estimatedMinutes"
                  (ngModelChange)="markDirty()"
                />
              </cdf-form-field>
              <cdf-form-field
                [label]="'admin.lesson.baseXp' | translate"
                controlId="lesson-xp"
              >
                <cdf-input
                  inputId="lesson-xp"
                  type="number"
                  [(ngModel)]="meta.baseXp"
                  (ngModelChange)="markDirty()"
                />
              </cdf-form-field>
              <cdf-form-field
                [label]="'admin.lesson.baseCoins' | translate"
                controlId="lesson-coins"
              >
                <cdf-input
                  inputId="lesson-coins"
                  type="number"
                  [(ngModel)]="meta.baseCoins"
                  (ngModelChange)="markDirty()"
                />
              </cdf-form-field>
            </div>
            <cdf-checkbox
              [(ngModel)]="meta.isFree"
              (ngModelChange)="markDirty()"
              [label]="'admin.lesson.freePreview' | translate"
            />

            <h2 class="pane-title refs-title">
              {{ 'admin.lesson.refs.title' | translate }}
            </h2>
            @if (candidates() === null) {
              <cdf-skeleton shape="text" />
            } @else {
              @if (refs().length === 0) {
                <p class="muted small">
                  {{ 'admin.lesson.refs.none' | translate }}
                </p>
              }
              @for (r of refs(); track r.index) {
                <cdf-form-field
                  [label]="
                    'admin.lesson.refs.blockLabel'
                      | translate
                        : {
                            kind:
                              ('admin.lesson.refs.kinds.' + r.kind | translate),
                            n: $index + 1,
                          }
                  "
                  [controlId]="'ref-' + r.index"
                >
                  <cdf-combobox
                    [inputId]="'ref-' + r.index"
                    [options]="optionsFor(r.kind)"
                    [ngModel]="r.id"
                    (ngModelChange)="pointRef(r.index, $event)"
                    [emptyLabel]="'admin.lesson.refs.noCandidates' | translate"
                  />
                </cdf-form-field>
              }
              <div class="insert-ref">
                <cdf-form-field
                  [label]="'admin.lesson.refs.insertKind' | translate"
                  controlId="ref-insert-kind"
                >
                  <cdf-select
                    inputId="ref-insert-kind"
                    [options]="refKindOptions()"
                    [(ngModel)]="insertKind"
                  />
                </cdf-form-field>
                <cdf-form-field
                  [label]="'admin.lesson.refs.insertTarget' | translate"
                  controlId="ref-insert-target"
                >
                  <cdf-combobox
                    inputId="ref-insert-target"
                    [options]="optionsFor(insertKind)"
                    [(ngModel)]="insertTarget"
                    [emptyLabel]="'admin.lesson.refs.noCandidates' | translate"
                  />
                </cdf-form-field>
                <cdf-button
                  kind="secondary"
                  size="sm"
                  [disabled]="!insertTarget"
                  (click)="insertRef()"
                >
                  <cdf-icon name="plus" size="sm" />
                  {{ 'admin.lesson.refs.insert' | translate }}
                </cdf-button>
              </div>
            }
          </aside>
        </div>
      } @else if (notFound()) {
        <cdf-empty-state
          icon="x-circle"
          [title]="'admin.lesson.notFound' | translate"
          [description]="'admin.lesson.notFoundHelp' | translate"
        >
          <a [routerLink]="['/courses']">{{
            'admin.course.backToCourses' | translate
          }}</a>
        </cdf-empty-state>
      } @else {
        <cdf-skeleton shape="rect" height="320px" />
      }
    </div>
  `,
  styles: [
    `
      .grid {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) 300px;
        gap: var(--cdf-space-3);
      }
      .grid[data-mode='edit'] {
        grid-template-columns: minmax(0, 1fr) 300px;
      }
      .grid[data-mode='edit'] .preview-pane,
      .grid[data-mode='preview'] .editor-pane {
        display: none;
      }
      .grid[data-mode='preview'] {
        grid-template-columns: minmax(0, 1fr) 300px;
      }
      @media (max-width: 1100px) {
        .grid,
        .grid[data-mode] {
          grid-template-columns: minmax(0, 1fr);
        }
      }
      .pane {
        background: var(--cdf-color-surface);
        border: 1px solid var(--cdf-color-border);
        border-radius: var(--cdf-radius-md);
        padding: var(--cdf-space-3);
        min-width: 0;
      }
      .meta-pane {
        display: flex;
        flex-direction: column;
        gap: var(--cdf-space-2);
      }
      .pane-title {
        margin: 0 0 var(--cdf-space-2);
        font-size: var(--cdf-font-size-sm);
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: var(--cdf-color-text-muted);
      }
      .refs-title {
        margin-top: var(--cdf-space-3);
      }
      .mode-switch {
        display: inline-flex;
        border: 1px solid var(--cdf-color-border);
        border-radius: var(--cdf-radius-sm);
        overflow: hidden;
      }
      .seg {
        border: 0;
        background: var(--cdf-color-surface);
        color: var(--cdf-color-text);
        padding: 6px 12px;
        font: inherit;
        font-size: 14px;
        cursor: pointer;
      }
      .seg[aria-pressed='true'] {
        background: var(--cdf-color-primary);
        color: var(--cdf-color-primary-on);
      }
      .seg:focus-visible {
        outline: 2px solid var(--cdf-color-primary);
        outline-offset: -2px;
      }
      .insert-ref {
        border-top: 1px dashed var(--cdf-color-border);
        padding-top: var(--cdf-space-2);
      }
      .issues h2 {
        display: flex;
        align-items: center;
        gap: 6px;
        color: var(--cdf-color-danger);
      }
    `,
  ],
})
export class LessonsPage implements HasUnsavedChanges {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly lessons = inject(LessonsClient);
  private readonly courses = inject(CoursesClient);
  private readonly exercises = inject(ExercisesClient);
  private readonly aiPrompts = inject(AiPromptsClient);
  private readonly scenarios = inject(ScenariosClient);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmDialogService);
  private readonly errorsSvc = inject(AdminErrors);
  private readonly i18n = inject(I18nService);

  protected readonly modes = ['edit', 'split', 'preview'] as const;
  protected readonly mode = signal<'edit' | 'split' | 'preview'>('split');
  protected readonly companion = lessonCompanion;
  protected readonly lesson = signal<Lesson | null>(null);
  protected readonly course = signal<CourseDetail | null>(null);
  protected readonly notFound = signal(false);
  protected readonly saving = signal(false);
  protected readonly dirty = signal(false);
  protected readonly titleError = signal<string | null>(null);
  protected readonly issues = signal<ContentIssue[]>([]);
  /** null while loading the course's interactive lessons. */
  protected readonly candidates = signal<RefCandidate[] | null>(null);
  /** Bumped on doc edits so `refs()` recomputes. */
  private readonly docVersion = signal(0);
  protected readonly docBinding = new EditorDocBinding(
    (doc) => {
      this.doc = doc;
      this.markDirty();
    },
    (doc) => {
      this.doc = doc;
      this.docVersion.update((v) => v + 1);
    },
  );

  protected doc: LessonDoc = emptyLessonDoc();
  protected meta: MetaForm = {
    title: '',
    type: 'READING',
    estimatedMinutes: 5,
    baseXp: 10,
    baseCoins: 5,
    isFree: false,
  };
  protected insertKind: RefKind = 'exercise';
  protected insertTarget: string | null = null;
  private loadSeq = 0;

  protected readonly crumbs = computed<BreadcrumbCrumb[]>(() => {
    this.i18n.currentLocale();
    const c = this.course();
    return [
      { label: this.i18n.t('admin.nav.courses'), routerLink: ['/courses'] },
      ...(c ? [{ label: c.title, routerLink: ['/courses', c.slug] }] : []),
      { label: this.lesson()?.title ?? this.i18n.t('admin.lesson.lesson') },
    ];
  });

  protected readonly typeOptions = computed<SelectOption<LessonType>[]>(() => {
    this.i18n.currentLocale();
    return LESSON_TYPES.map((t) => ({
      value: t,
      label: this.i18n.t(`admin.lessonTypes.${t}`),
    }));
  });

  protected readonly refKindOptions = computed<SelectOption<RefKind>[]>(() => {
    this.i18n.currentLocale();
    return REF_KINDS.map((k) => ({
      value: k,
      label: this.i18n.t(`admin.lesson.refs.kinds.${k}`),
    }));
  });

  protected readonly refs = computed(() => {
    this.docVersion();
    return docRefs(this.doc);
  });

  constructor() {
    warnOnUnload(() => this.dirty());
    this.route.paramMap
      .pipe(
        map((p) => p.get('id')),
        takeUntilDestroyed(),
      )
      .subscribe((id) => {
        if (id) void this.load(id);
      });
  }

  hasUnsavedChanges(): boolean {
    return this.dirty();
  }

  private async load(id: string): Promise<void> {
    const seq = ++this.loadSeq;
    this.notFound.set(false);
    this.lesson.set(null);
    this.issues.set([]);
    try {
      const l = await this.lessons.detail(id);
      if (seq !== this.loadSeq) return;
      this.applyLesson(l);
      // Breadcrumb + ref candidates come from the parent course (by id).
      const course = await this.courses.detail(l.courseId);
      if (seq !== this.loadSeq) return;
      this.course.set(course);
      void this.loadCandidates(course, seq);
    } catch (err) {
      if (seq !== this.loadSeq) return;
      if (err instanceof ProblemDetailsError && err.isNotFound)
        this.notFound.set(true);
      else this.errorsSvc.toast(err, 'admin.errors.loadFailed');
    }
  }

  private applyLesson(l: Lesson): void {
    this.lesson.set(l);
    this.doc = (l.contentJson as LessonDoc | null) ?? emptyLessonDoc();
    this.docBinding.reset(this.doc);
    this.meta = {
      title: l.title,
      type: l.type,
      estimatedMinutes: l.estimatedMinutes,
      baseXp: l.baseXp,
      baseCoins: l.baseCoins,
      isFree: l.isFree,
    };
    this.docVersion.update((v) => v + 1);
    this.dirty.set(false);
  }

  /** Resolve the exercise / AI prompt / scenario ids of the course's lessons. */
  private async loadCandidates(
    course: CourseDetail,
    seq: number,
  ): Promise<void> {
    const lessons = course.modules.flatMap((m) => m.lessons);
    const results = await Promise.all(
      lessons.map(async (l): Promise<RefCandidate | null> => {
        const kind = refKindForLessonType(l.type);
        if (!kind) return null;
        try {
          const found =
            kind === 'exercise'
              ? await this.exercises.getAdminByLesson(l.id)
              : kind === 'aiPrompt'
                ? await this.aiPrompts.getByLesson(l.id)
                : await this.scenarios.getByLesson(l.id);
          return found
            ? { kind, id: found.id, lessonId: l.id, lessonTitle: l.title }
            : null;
        } catch {
          return null; // lesson without an attached exercise/prompt/scenario
        }
      }),
    );
    if (seq === this.loadSeq)
      this.candidates.set(results.filter((r): r is RefCandidate => !!r));
  }

  protected optionsFor(kind: RefKind): ComboboxOption<string>[] {
    return (this.candidates() ?? [])
      .filter((c) => c.kind === kind)
      .map((c) => ({ value: c.id, label: c.lessonTitle, description: c.id }));
  }

  protected markDirty(): void {
    this.dirty.set(true);
    this.docVersion.update((v) => v + 1);
  }

  protected pointRef(index: number, id: string | null): void {
    if (!id) return;
    this.doc = setDocRef(this.doc, index, id);
    this.docBinding.set(this.doc);
    this.markDirty();
  }

  protected insertRef(): void {
    if (!this.insertTarget) return;
    this.doc = appendDocRef(this.doc, this.insertKind, this.insertTarget);
    this.docBinding.set(this.doc);
    this.insertTarget = null;
    this.markDirty();
  }

  protected async save(): Promise<void> {
    const l = this.lesson();
    if (!l) return;
    if (!this.meta.title.trim()) {
      this.titleError.set(this.i18n.t('admin.common.required'));
      return;
    }
    this.titleError.set(null);
    this.issues.set([]);
    this.saving.set(true);
    try {
      const updated = await this.lessons.update(l.id, {
        title: this.meta.title.trim(),
        type: this.meta.type,
        isFree: this.meta.isFree,
        estimatedMinutes: Math.max(
          1,
          Math.round(Number(this.meta.estimatedMinutes) || 1),
        ),
        baseXp: Math.max(0, Math.round(Number(this.meta.baseXp) || 0)),
        baseCoins: Math.max(0, Math.round(Number(this.meta.baseCoins) || 0)),
        contentJson: this.doc,
      });
      this.lesson.set(updated);
      this.dirty.set(false);
      this.toast.success(
        this.i18n.t('admin.lesson.saved', { title: updated.title }),
      );
    } catch (err) {
      const issues = contentIssuesOf(err);
      this.issues.set(issues);
      if (issues.length === 0)
        this.errorsSvc.toast(err, 'admin.errors.saveFailed');
    } finally {
      this.saving.set(false);
    }
  }

  protected async deleteLesson(): Promise<void> {
    const l = this.lesson();
    if (!l) return;
    const ok = await this.confirm.open({
      title: this.i18n.t('admin.common.deleteConfirmTitle', { name: l.title }),
      message: this.i18n.t('admin.lesson.deleteMessage'),
      confirmKind: 'danger',
      confirmLabel: this.i18n.t('admin.common.delete'),
      icon: 'trash',
    });
    if (!ok) return;
    try {
      await this.lessons.remove(l.id);
      this.dirty.set(false);
      this.toast.success(
        this.i18n.t('admin.lesson.deleted', { title: l.title }),
      );
      const slug = this.course()?.slug;
      void this.router.navigate(slug ? ['/courses', slug] : ['/courses']);
    } catch (err) {
      this.errorsSvc.toast(err, 'admin.errors.deleteFailed');
    }
  }
}
