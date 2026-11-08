import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { map } from 'rxjs';
import {
  emptyLessonDoc,
  stripQuizAnswers,
  validateLessonDoc,
  type LessonDoc,
  type QuizAnswers,
} from '@codify/lesson-schema';
import { I18nService, LocalePipe, TranslatePipe } from '@codify/i18n';
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
  ModalFrame,
  ModalService,
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
  type LessonMultiplier,
  type LessonType,
} from '@codify/api-client';
import { AuthService } from '@codify/auth';
import { canAccess } from '../core/roles';
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
import { Autosave, formatClockTime } from '../core/autosave';

/**
 * "Preview as student" (docs/04 Lessons, docs/06 §9): the doc as a student
 * gets it (answer keys stripped, quizzes interactive but ungraded) at a
 * mobile and a desktop width side by side.
 */
@Component({
  selector: 'cdf-admin-lesson-preview',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ModalFrame, LessonBlockRenderer, TranslatePipe],
  template: `
    <cdf-modal-frame [title]="'admin.lesson.previewTitle' | translate">
      <p class="muted small">{{ 'admin.lesson.previewNote' | translate }}</p>
      <div class="previews">
        <section
          class="device device--mobile"
          [attr.aria-label]="'admin.lesson.previewMobile' | translate"
        >
          <h3 class="device__label">
            {{ 'admin.lesson.previewMobile' | translate }}
          </h3>
          <div class="device__screen" data-testid="preview-mobile">
            <h2 class="device__title">{{ title() }}</h2>
            <cdf-lesson-block-renderer
              [doc]="studentDoc()"
              [(quizAnswers)]="mobileAnswers"
            />
          </div>
        </section>
        <section
          class="device device--desktop"
          [attr.aria-label]="'admin.lesson.previewDesktop' | translate"
        >
          <h3 class="device__label">
            {{ 'admin.lesson.previewDesktop' | translate }}
          </h3>
          <div class="device__screen" data-testid="preview-desktop">
            <h2 class="device__title">{{ title() }}</h2>
            <cdf-lesson-block-renderer
              [doc]="studentDoc()"
              [(quizAnswers)]="desktopAnswers"
            />
          </div>
        </section>
      </div>
    </cdf-modal-frame>
  `,
  styles: [
    `
      .previews {
        display: flex;
        gap: var(--cdf-space-4);
        align-items: flex-start;
        overflow-x: auto;
        padding-bottom: var(--cdf-space-2);
      }
      .device {
        flex: 0 0 auto;
      }
      .device__label {
        margin: 0 0 var(--cdf-space-1);
        font-size: var(--cdf-font-size-sm);
        color: var(--cdf-color-text-muted);
      }
      .device__screen {
        border: 1px solid var(--cdf-color-border);
        border-radius: var(--cdf-radius-md);
        background: var(--cdf-color-bg);
        padding: var(--cdf-space-4);
        max-height: 70vh;
        overflow: auto;
        /* Own containing block so the renderer lays out at this width. */
        container-type: inline-size;
      }
      .device--mobile .device__screen {
        width: 390px;
        border-radius: 24px;
      }
      .device--desktop .device__screen {
        width: 1024px;
      }
      .device__title {
        margin-top: 0;
      }
    `,
  ],
})
export class LessonPreviewDialog {
  readonly doc = input<LessonDoc | null>(null);
  readonly title = input('');
  protected readonly studentDoc = computed(() => {
    const d = this.doc();
    return d ? stripQuizAnswers(d) : null;
  });
  protected mobileAnswers: QuizAnswers = {};
  protected desktopAnswers: QuizAnswers = {};
}

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
    LocalePipe,
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
              <span role="status" class="save-status" data-testid="save-status">
                @switch (saveStatus()) {
                  @case ('saving') {
                    {{ 'admin.lesson.autosave.saving' | translate }}
                  }
                  @case ('paused') {
                    {{ 'admin.lesson.autosave.paused' | translate }}
                  }
                  @case ('failed') {
                    {{ 'admin.lesson.autosave.failed' | translate }}
                  }
                  @case ('unsaved') {
                    {{ 'admin.lesson.unsaved' | translate }}
                  }
                  @case ('saved') {
                    {{
                      'admin.lesson.autosave.savedAt'
                        | translate: { time: savedAtLabel() }
                    }}
                  }
                }
              </span>
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
              kind="secondary"
              (click)="openPreview()"
              data-testid="preview-lesson"
            >
              <cdf-icon name="eye" size="sm" />
              {{ 'admin.lesson.previewStudent' | translate }}
            </cdf-button>
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
            <ul class="issue-list" data-testid="content-issues">
              @for (i of issues(); track $index) {
                <li>
                  @if (blockOf(i.path); as n) {
                    <strong>{{
                      'admin.lesson.issueBlock' | translate: { n }
                    }}</strong>
                    ·
                  }
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
              {{ 'admin.lesson.multipliers.title' | translate }}
            </h2>
            @if (multipliers(); as list) {
              @if (list.length === 0) {
                <p class="muted small">
                  {{ 'admin.lesson.multipliers.none' | translate }}
                </p>
              } @else {
                <ul
                  class="plain-list mult-list"
                  data-testid="lesson-multipliers"
                >
                  @for (m of list; track m.id) {
                    <li class="mult">
                      <strong
                        >×{{ m.value | locale: 'number' }}
                        {{
                          'admin.promotions.targets.' + m.target | translate
                        }}</strong
                      >
                      <cdf-badge
                        [variant]="m.activeNow ? 'success' : 'neutral'"
                        [subtle]="true"
                        >{{
                          (m.activeNow
                            ? 'admin.lesson.multipliers.running'
                            : 'admin.lesson.multipliers.notRunning'
                          ) | translate
                        }}</cdf-badge
                      >
                      <div class="muted small">
                        {{ 'admin.promotions.kinds.' + m.kind | translate }} ·
                        {{
                          (m.scope === 'lesson'
                            ? 'admin.lesson.multipliers.scopeLesson'
                            : 'admin.lesson.multipliers.scopeCourse'
                          ) | translate
                        }}
                      </div>
                      <div class="muted small">
                        @if (m.startsAt || m.endsAt) {
                          {{
                            m.startsAt ? (m.startsAt | locale: 'datetime') : '…'
                          }}
                          →
                          {{ m.endsAt ? (m.endsAt | locale: 'datetime') : '…' }}
                        } @else {
                          {{ 'admin.lesson.multipliers.always' | translate }}
                        }
                      </div>
                      @if (m.description) {
                        <div class="small">{{ m.description }}</div>
                      }
                    </li>
                  }
                </ul>
              }
              @if (canManagePromotions()) {
                <a class="small" [routerLink]="['/promotions']">{{
                  'admin.lesson.multipliers.manage' | translate
                }}</a>
              }
            } @else {
              <cdf-skeleton shape="text" />
            }

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
      .mult-list {
        display: flex;
        flex-direction: column;
        gap: var(--cdf-space-2);
        margin: 0;
      }
      .mult {
        border: 1px solid var(--cdf-color-border);
        border-radius: var(--cdf-radius-sm);
        padding: 6px 8px;
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
  private readonly modals = inject(ModalService);
  private readonly auth = inject(AuthService);

  protected readonly modes = ['edit', 'split', 'preview'] as const;
  /** Promotions applying to this lesson (null while loading). */
  protected readonly multipliers = signal<LessonMultiplier[] | null>(null);
  protected readonly canManagePromotions = computed(() =>
    canAccess('promotions', this.auth.role()),
  );
  protected readonly mode = signal<'edit' | 'split' | 'preview'>('split');
  protected readonly companion = lessonCompanion;
  protected readonly lesson = signal<Lesson | null>(null);
  protected readonly course = signal<CourseDetail | null>(null);
  protected readonly notFound = signal(false);
  protected readonly saving = signal(false);
  protected readonly dirty = signal(false);
  /** When the last save (manual or auto) succeeded. */
  protected readonly savedAt = signal<Date | null>(null);
  protected readonly autosaveFailed = signal(false);
  /** Autosave revision at which the API last rejected the content. */
  private issuesRev = -1;
  /** docs/04 §5: autosave 5 s after the last change, only while valid. */
  private readonly autosave = new Autosave({
    canSave: () => this.canAutosave(),
    isSaving: () => this.saving(),
    save: () => this.save(true),
  });
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
    inject(DestroyRef).onDestroy(() => this.autosave.cancel());
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
    this.autosave.cancel();
    this.savedAt.set(null);
    this.autosaveFailed.set(false);
    this.notFound.set(false);
    this.lesson.set(null);
    this.issues.set([]);
    try {
      const l = await this.lessons.detail(id);
      if (seq !== this.loadSeq) return;
      this.applyLesson(l);
      void this.loadMultipliers(l.id, seq);
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

  private async loadMultipliers(id: string, seq: number): Promise<void> {
    this.multipliers.set(null);
    try {
      const list = await this.lessons.multipliers(id);
      if (seq === this.loadSeq) this.multipliers.set(list);
    } catch {
      if (seq === this.loadSeq) this.multipliers.set([]);
    }
  }

  /** "Preview as student" at mobile + desktop widths. */
  protected openPreview(): void {
    this.modals.open(LessonPreviewDialog, {
      size: 'xl',
      scrollable: true,
      inputs: { doc: this.doc, title: this.meta.title },
    });
  }

  /** 1-based top-level block number of an issue path (`content.3.…`). */
  protected blockOf(path: string): number | null {
    const m = /^content\.(\d+)/.exec(path);
    return m ? Number(m[1]) + 1 : null;
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
    this.autosave.changed();
  }

  /** Valid enough to autosave: a title, and not the content just rejected. */
  private canAutosave(): boolean {
    if (!this.lesson() || !this.dirty()) return false;
    if (!this.meta.title.trim()) return false;
    // docs/06 §6: never send a doc that fails lessonDocSchema.
    if (!validateLessonDoc(this.doc).ok) return false;
    return !(
      this.issues().length > 0 && this.autosave.isCurrent(this.issuesRev)
    );
  }

  /** Header status line (role="status"). */
  protected saveStatus():
    | 'saving'
    | 'paused'
    | 'failed'
    | 'unsaved'
    | 'saved'
    | null {
    if (this.saving()) return 'saving';
    if (this.dirty()) {
      const rejected =
        this.issues().length > 0 && this.autosave.isCurrent(this.issuesRev);
      if (
        !this.meta.title.trim() ||
        rejected ||
        !validateLessonDoc(this.doc).ok
      )
        return 'paused';
      if (this.autosaveFailed()) return 'failed';
      return 'unsaved';
    }
    return this.savedAt() ? 'saved' : null;
  }

  protected savedAtLabel(): string {
    const d = this.savedAt();
    return d ? formatClockTime(d, this.i18n.currentLocale()) : '';
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

  protected async save(auto = false): Promise<void> {
    const l = this.lesson();
    if (!l || this.saving()) return;
    if (!this.meta.title.trim()) {
      this.titleError.set(this.i18n.t('admin.common.required'));
      return;
    }
    if (!auto) this.autosave.cancel();
    this.titleError.set(null);
    // docs/06 §6: validate client-side first and list problems inline.
    const local = validateLessonDoc(this.doc);
    if (!local.ok) {
      this.issues.set(local.issues);
      this.issuesRev = this.autosave.revision;
      return;
    }
    this.issues.set([]);
    this.saving.set(true);
    const rev = this.autosave.revision;
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
      this.savedAt.set(new Date());
      this.autosaveFailed.set(false);
      // Edits made while the request was in flight stay dirty and get
      // their own autosave.
      if (this.autosave.isCurrent(rev)) this.dirty.set(false);
      else this.autosave.restart();
      if (!auto)
        this.toast.success(
          this.i18n.t('admin.lesson.saved', { title: updated.title }),
        );
    } catch (err) {
      const issues = contentIssuesOf(err);
      this.issues.set(issues);
      this.issuesRev = rev;
      if (auto) this.autosaveFailed.set(issues.length === 0);
      else if (issues.length === 0)
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
      this.autosave.cancel();
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
