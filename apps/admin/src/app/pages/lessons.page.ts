import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { emptyLessonDoc, type LessonDoc } from '@codify/lesson-schema';
import {
  Badge,
  BreadcrumbBar,
  type BreadcrumbCrumb,
  Button,
  Checkbox,
  ConfirmDialogService,
  EmptyState,
  FormField,
  Icon,
  Input,
  LessonBlockEditor,
  LessonBlockRenderer,
  Select,
  type SelectOption,
  ToastService,
} from '@codify/ui-bootstrap';
import {
  CoursesClient,
  LessonsClient,
  ProblemDetailsError,
  type Lesson,
  type LessonType,
} from '@codify/api-client';

const TYPE_OPTIONS: SelectOption<LessonType>[] = [
  { value: 'READING', label: 'Reading' },
  { value: 'QUIZ', label: 'Quiz' },
  { value: 'EXERCISE', label: 'Exercise' },
  { value: 'AI_PROMPT', label: 'AI prompt' },
  { value: 'SCENARIO', label: 'Scenario' },
];

/**
 * Lesson editor — loads a Lesson from /api/lessons/:id, hands the
 * contentJson to LessonBlockEditor, saves on demand. The page also
 * exposes the meta fields (title, type, isFree, estimated minutes,
 * baseXp/baseCoins) on the right rail.
 *
 * Route param `id` is required; without it the page renders an
 * EmptyState pointing back to /courses. The student-facing player
 * lives in apps/student and consumes the same contentJson.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    RouterLink,
    Badge,
    BreadcrumbBar,
    Button,
    Checkbox,
    EmptyState,
    FormField,
    Icon,
    Input,
    LessonBlockEditor,
    LessonBlockRenderer,
    Select,
  ],
  template: `
    <cdf-breadcrumb-bar [crumbs]="crumbs()" />

    @if (lesson(); as l) {
    <header class="page-head">
      <div>
        <h1>{{ titleModel || l.title }}</h1>
        <p class="muted">
          <cdf-badge variant="info" [subtle]="true">{{ l.type }}</cdf-badge>
          @if (l.isFree) {
          <cdf-badge variant="success" [subtle]="true">FREE</cdf-badge>
          }
          · ~{{ l.estimatedMinutes }} min · +{{ l.baseXp }} XP · +{{ l.baseCoins }} coins
        </p>
      </div>
      <div class="head-actions">
        <cdf-button kind="ghost" (click)="setMode('edit')">Edit</cdf-button>
        <cdf-button kind="ghost" (click)="setMode('preview')">Preview</cdf-button>
        <cdf-button kind="ghost" (click)="setMode('split')">Split</cdf-button>
        <cdf-button
          kind="primary"
          [loading]="saving()"
          [disabled]="!dirty()"
          (click)="save()"
        >
          {{ dirty() ? 'Save changes' : 'Saved' }}
        </cdf-button>
        <cdf-button kind="danger" (click)="deleteLesson()">Delete</cdf-button>
      </div>
    </header>

    <div class="grid" [attr.data-mode]="previewMode()">
      <section class="editor-card">
        <cdf-lesson-block-editor [(ngModel)]="docModel" (ngModelChange)="onDocChange($event)" />
      </section>

      <section class="preview-card">
        <h3>Preview</h3>
        <cdf-lesson-block-renderer [doc]="docModel" />
      </section>

      <aside class="meta-card">
        <h3>Lesson</h3>
        <cdf-form-field label="Title" [error]="errors()['title'] ?? null">
          <cdf-input
            [(ngModel)]="titleModel"
            (ngModelChange)="onMetaField('title', $event)"
          />
        </cdf-form-field>
        <cdf-form-field label="Type">
          <cdf-select
            [options]="typeOptions"
            [ngModel]="typeModel"
            (ngModelChange)="onTypeChange($event)"
          />
        </cdf-form-field>
        <cdf-form-field label="Estimated minutes">
          <cdf-input
            type="number"
            [(ngModel)]="minutesModel"
            (ngModelChange)="onMetaField('estimatedMinutes', $event)"
          />
        </cdf-form-field>
        <cdf-form-field label="Base XP">
          <cdf-input
            type="number"
            [(ngModel)]="xpModel"
            (ngModelChange)="onMetaField('baseXp', $event)"
          />
        </cdf-form-field>
        <cdf-form-field label="Base coins">
          <cdf-input
            type="number"
            [(ngModel)]="coinsModel"
            (ngModelChange)="onMetaField('baseCoins', $event)"
          />
        </cdf-form-field>
        <cdf-checkbox
          [(ngModel)]="freeModel"
          (ngModelChange)="onFreeChange($event)"
          label="Free preview"
        />
      </aside>
    </div>
    } @else if (notFound()) {
    <cdf-empty-state
      icon="x-circle"
      title="Lesson not found"
      description="The id in the URL doesn't match a lesson you can edit."
    >
      <a [routerLink]="['/courses']" class="back-link">Back to courses</a>
    </cdf-empty-state>
    } @else {
    <p class="muted">Loading lesson…</p>
    }
  `,
  styles: [
    `
      :host { display: block; max-width: 1280px; margin: 0 auto; }
      .page-head {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: var(--cdf-space-3);
        margin: var(--cdf-space-3) 0 var(--cdf-space-4);
      }
      .page-head h1 { margin: 0; }
      .page-head p {
        margin: 6px 0 0;
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .head-actions {
        display: flex;
        gap: 6px;
        align-items: flex-start;
      }
      .grid {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) 280px;
        gap: var(--cdf-space-3);
      }
      .grid[data-mode='edit'] { grid-template-columns: minmax(0, 1fr) 280px; }
      .grid[data-mode='edit'] .preview-card { display: none; }
      .grid[data-mode='preview'] { grid-template-columns: minmax(0, 1fr) 280px; }
      .grid[data-mode='preview'] .editor-card { display: none; }
      @media (max-width: 1100px) {
        .grid { grid-template-columns: minmax(0, 1fr); }
        .meta-card { order: -1; }
      }
      .editor-card,
      .preview-card,
      .meta-card {
        background: var(--cdf-color-surface);
        border: 1px solid var(--cdf-color-border);
        border-radius: var(--cdf-radius-md);
        padding: var(--cdf-space-3);
      }
      .preview-card h3,
      .meta-card h3 {
        margin: 0 0 var(--cdf-space-2);
        font-size: var(--cdf-font-size-sm);
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: var(--cdf-color-text-muted);
      }
      .meta-card cdf-form-field { margin-bottom: var(--cdf-space-3); }
      .muted { color: var(--cdf-color-text-muted); margin: 0; }
      .back-link {
        color: var(--cdf-color-primary);
        text-decoration: none;
      }
      .back-link:hover { text-decoration: underline; }
    `,
  ],
})
export class LessonsPage {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly lessons = inject(LessonsClient);
  private readonly courses = inject(CoursesClient);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmDialogService);

  protected readonly typeOptions = TYPE_OPTIONS;
  protected readonly lesson = signal<Lesson | null>(null);
  protected readonly notFound = signal<boolean>(false);
  protected readonly saving = signal<boolean>(false);
  protected readonly dirty = signal<boolean>(false);
  protected readonly previewMode = signal<'edit' | 'preview' | 'split'>('split');
  protected readonly errors = signal<Record<string, string | undefined>>({});

  // Form state mirrors the lesson — separate so we don't reach into the
  // signal for two-way bindings.
  protected docModel: LessonDoc = emptyLessonDoc();
  protected titleModel = '';
  protected typeModel: LessonType = 'READING';
  protected minutesModel = 5;
  protected xpModel = 10;
  protected coinsModel = 5;
  protected freeModel = false;

  protected readonly courseSlug = signal<string | null>(null);

  protected readonly crumbs = computed<BreadcrumbCrumb[]>(() => {
    const slug = this.courseSlug();
    return [
      { label: 'Catalog', routerLink: ['/'] },
      { label: 'Courses', routerLink: ['/courses'] },
      ...(slug ? [{ label: 'Course', routerLink: ['/courses', slug] }] : []),
      { label: this.titleModel || 'Lesson' },
    ];
  });

  constructor() {
    effect(() => {
      this.route.paramMap.subscribe((map) => {
        const id = map.get('id');
        if (id) void this.load(id);
      });
    });
  }

  private async load(id: string): Promise<void> {
    this.notFound.set(false);
    try {
      const l = await this.lessons.detail(id);
      this.lesson.set(l);
      this.docModel = (l.contentJson as LessonDoc) ?? emptyLessonDoc();
      this.titleModel = l.title;
      this.typeModel = l.type;
      this.minutesModel = l.estimatedMinutes;
      this.xpModel = l.baseXp;
      this.coinsModel = l.baseCoins;
      this.freeModel = l.isFree;
      this.dirty.set(false);
      // Best-effort: resolve the course slug so the breadcrumb links back.
      try {
        // The detail response gives us courseId; fetch the parent for the slug.
        const courses = await this.courses.list({ take: 200 });
        const parent = courses.items.find((c) => c.id === l.courseId);
        this.courseSlug.set(parent?.slug ?? null);
      } catch {
        /* breadcrumb is non-fatal */
      }
    } catch (err) {
      if (err instanceof ProblemDetailsError && err.isNotFound) {
        this.notFound.set(true);
      } else {
        this.toast.error(this.describeError(err, 'Failed to load lesson'));
      }
    }
  }

  protected setMode(mode: 'edit' | 'preview' | 'split'): void {
    this.previewMode.set(mode);
  }

  protected onDocChange(_doc: LessonDoc): void {
    this.dirty.set(true);
  }

  protected onMetaField(
    field: 'title' | 'estimatedMinutes' | 'baseXp' | 'baseCoins',
    _value: unknown,
  ): void {
    if (this.errors()[field]) {
      this.errors.update((e) => ({ ...e, [field]: undefined }));
    }
    this.dirty.set(true);
  }

  protected onTypeChange(value: LessonType | null): void {
    if (value) {
      this.typeModel = value;
      this.dirty.set(true);
    }
  }

  protected onFreeChange(_v: boolean): void {
    this.dirty.set(true);
  }

  protected async save(): Promise<void> {
    const l = this.lesson();
    if (!l) return;
    if (!this.titleModel.trim()) {
      this.errors.set({ title: 'Required' });
      return;
    }
    this.saving.set(true);
    try {
      const updated = await this.lessons.update(l.id, {
        title: this.titleModel.trim(),
        type: this.typeModel,
        isFree: this.freeModel,
        estimatedMinutes: Number(this.minutesModel),
        baseXp: Number(this.xpModel),
        baseCoins: Number(this.coinsModel),
        contentJson: this.docModel,
      });
      this.lesson.set(updated);
      this.dirty.set(false);
      this.toast.success(`Lesson "${updated.title}" saved`);
    } catch (err) {
      this.toast.error(this.describeError(err, 'Save failed'));
    } finally {
      this.saving.set(false);
    }
  }

  protected async deleteLesson(): Promise<void> {
    const l = this.lesson();
    if (!l) return;
    const ok = await this.confirm.open({
      title: `Delete "${l.title}"?`,
      message: 'The lesson will be soft-deleted and disappear from the curriculum.',
      confirmKind: 'danger',
      confirmLabel: 'Delete',
      icon: 'trash',
    });
    if (!ok) return;
    try {
      await this.lessons.remove(l.id);
      this.toast.success(`Lesson "${l.title}" deleted`);
      const slug = this.courseSlug();
      void this.router.navigateByUrl(slug ? `/courses/${slug}` : '/courses');
    } catch (err) {
      this.toast.error(this.describeError(err, 'Delete failed'));
    }
  }

  private describeError(err: unknown, fallback: string): string {
    if (err instanceof ProblemDetailsError) {
      if (err.isUnauthorized) return 'You are signed out.';
      if (err.isForbidden) return 'You do not have permission for that action.';
      if (err.message) return err.message;
    }
    return fallback;
  }
}
