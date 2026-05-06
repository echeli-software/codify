import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import {
  Badge,
  BreadcrumbBar,
  type BreadcrumbCrumb,
  Button,
  ConfirmDialogService,
  EmptyState,
  FormField,
  Icon,
  IconButton,
  Input,
  Select,
  type SelectOption,
  ToastService,
} from '@codify/ui-bootstrap';
import {
  CoursesClient,
  LessonsClient,
  ModulesClient,
  ProblemDetailsError,
  type CourseDetail,
  type CourseModule,
  type CourseModuleSummary,
  type LessonType,
} from '@codify/api-client';

const LESSON_TYPE_OPTIONS: SelectOption<LessonType>[] = [
  { value: 'READING', label: 'Reading' },
  { value: 'QUIZ', label: 'Quiz' },
  { value: 'EXERCISE', label: 'Exercise' },
  { value: 'AI_PROMPT', label: 'AI prompt' },
  { value: 'SCENARIO', label: 'Scenario' },
];

interface NewLessonForm {
  moduleId: string;
  title: string;
  type: LessonType;
}

const EMPTY_LESSON_FORM: NewLessonForm = {
  moduleId: '',
  title: '',
  type: 'READING',
};

/**
 * Admin Course detail. Header shows status + meta; body lists modules
 * with their lessons. Two inline forms: "New module" at the page level,
 * "New lesson" per module (collapsed by default). Each lesson row has
 * an Edit link to /lessons/:id where the LessonBlockEditor lives.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    RouterLink,
    Badge,
    BreadcrumbBar,
    Button,
    EmptyState,
    FormField,
    Icon,
    IconButton,
    Input,
    Select,
  ],
  template: `
    <cdf-breadcrumb-bar [crumbs]="crumbs()" />

    @if (course(); as c) {
    <header class="page-head">
      <div>
        <h1>{{ c.title }}</h1>
        <p class="muted">
          <cdf-badge [variant]="statusVariant(c.status)" [subtle]="true">
            {{ c.status }}
          </cdf-badge>
          · {{ c.authorDisplayName }} · {{ c.moduleCount }} modules
        </p>
      </div>
      <a [routerLink]="['/courses']" class="back-link">← Back to all</a>
    </header>

    <section class="card">
      <header class="section-head">
        <h2>Modules</h2>
        <cdf-button kind="primary" size="sm" (click)="openModuleForm()">
          <cdf-icon name="plus" size="sm" /> Add module
        </cdf-button>
      </header>

      @if (newModuleOpen()) {
      <div class="inline-form">
        <cdf-form-field label="Module title" [error]="moduleErrors()['title'] ?? null">
          <cdf-input
            [(ngModel)]="newModuleInputs.title"
            (ngModelChange)="onModuleField('title', $event)"
            placeholder="Hooks fundamentals"
          />
        </cdf-form-field>
        <div class="form-actions">
          <cdf-button
            kind="primary"
            size="sm"
            [loading]="savingModule()"
            (click)="saveModule()"
          >
            Create module
          </cdf-button>
          <cdf-button kind="ghost" size="sm" (click)="closeModuleForm()">
            Cancel
          </cdf-button>
        </div>
        @if (moduleError()) {
        <p class="form-error">{{ moduleError() }}</p>
        }
      </div>
      }

      @if (modules().length === 0 && !loading()) {
      <cdf-empty-state
        icon="search"
        title="No modules yet"
        description="Add a module to start building the curriculum."
      />
      } @else {
      <ol class="module-list">
        @for (m of modulesWithLessons(); track m.id) {
        <li class="module">
          <header class="module-head">
            <div>
              <span class="module-order">Module {{ m.order + 1 }}</span>
              <h3>{{ m.title }}</h3>
              <p class="muted small">{{ m.lessons.length }} lessons</p>
            </div>
            <div class="module-actions">
              <cdf-button
                kind="ghost"
                size="sm"
                (click)="openLessonForm(m.id)"
              >
                Add lesson
              </cdf-button>
              <cdf-icon-button
                icon="trash"
                ariaLabel="Delete module"
                size="sm"
                kind="danger"
                (click)="deleteModule(m)"
              />
            </div>
          </header>

          @if (lessonForm().moduleId === m.id) {
          <div class="inline-form lesson-form">
            <cdf-form-field
              label="Lesson title"
              [error]="lessonErrors()['title'] ?? null"
            >
              <cdf-input
                [(ngModel)]="lessonInputs.title"
                (ngModelChange)="onLessonField('title', $event)"
                placeholder="Hooks intro"
              />
            </cdf-form-field>
            <cdf-form-field label="Type">
              <cdf-select
                [options]="lessonTypeOptions"
                [ngModel]="lessonInputs.type"
                (ngModelChange)="onLessonType($event)"
              />
            </cdf-form-field>
            <div class="form-actions">
              <cdf-button
                kind="primary"
                size="sm"
                [loading]="savingLesson()"
                (click)="saveLesson(m.id)"
              >
                Create lesson
              </cdf-button>
              <cdf-button
                kind="ghost"
                size="sm"
                (click)="closeLessonForm()"
              >
                Cancel
              </cdf-button>
            </div>
            @if (lessonError()) {
            <p class="form-error">{{ lessonError() }}</p>
            }
          </div>
          }

          @if (m.lessons.length > 0) {
          <ul class="lesson-list">
            @for (l of m.lessons; track l.id) {
            <li class="lesson">
              <span class="lesson-order">{{ l.order + 1 }}</span>
              <span class="lesson-type">{{ l.type }}</span>
              <a [routerLink]="['/lessons', l.id]" class="lesson-title">
                {{ l.title }}
              </a>
              <span class="muted small">~{{ l.estimatedMinutes }} min</span>
              @if (l.isFree) {
              <cdf-badge variant="success" [subtle]="true">FREE</cdf-badge>
              }
            </li>
            }
          </ul>
          }
        </li>
        }
      </ol>
      }
    </section>
    } @else if (notFound()) {
    <cdf-empty-state
      icon="x-circle"
      title="Course not found"
      description="The slug in the URL doesn't match a course you can edit."
    >
      <a [routerLink]="['/courses']" class="back-link">Back to courses</a>
    </cdf-empty-state>
    }
  `,
  styles: [
    `
      :host { display: block; max-width: 1080px; margin: 0 auto; }
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
      .back-link {
        color: var(--cdf-color-text-muted);
        text-decoration: none;
        font-size: 14px;
      }
      .back-link:hover { text-decoration: underline; }
      .muted { color: var(--cdf-color-text-muted); }
      .small { font-size: 13px; }
      .card {
        background: var(--cdf-color-surface);
        border: 1px solid var(--cdf-color-border);
        border-radius: var(--cdf-radius-md);
        padding: var(--cdf-space-4);
      }
      .section-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: var(--cdf-space-3);
      }
      .section-head h2 { margin: 0; font-size: var(--cdf-font-size-md); }
      .inline-form {
        background: var(--cdf-color-bg);
        border: 1px solid var(--cdf-color-border);
        border-radius: var(--cdf-radius-sm);
        padding: var(--cdf-space-3);
        margin-bottom: var(--cdf-space-3);
      }
      .form-actions {
        display: flex;
        gap: var(--cdf-space-2);
        margin-top: var(--cdf-space-2);
      }
      .form-error {
        margin-top: 8px;
        color: var(--cdf-color-danger);
        font-size: 13px;
      }
      .module-list {
        list-style: none;
        padding: 0;
        margin: 0;
        display: flex;
        flex-direction: column;
        gap: var(--cdf-space-3);
      }
      .module {
        border: 1px solid var(--cdf-color-border);
        border-radius: var(--cdf-radius-sm);
        padding: var(--cdf-space-3);
      }
      .module-head {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: var(--cdf-space-3);
      }
      .module-head h3 { margin: 4px 0; }
      .module-order {
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--cdf-color-text-muted);
      }
      .module-actions {
        display: flex;
        gap: 6px;
        align-items: center;
      }
      .lesson-list {
        list-style: none;
        padding: 0;
        margin: var(--cdf-space-3) 0 0;
        border-top: 1px solid var(--cdf-color-border);
      }
      .lesson {
        display: grid;
        grid-template-columns: 32px 100px 1fr auto auto;
        align-items: center;
        gap: var(--cdf-space-2);
        padding: 6px 0;
        border-bottom: 1px solid var(--cdf-color-border);
      }
      .lesson:last-child { border-bottom: none; }
      .lesson-order {
        text-align: right;
        color: var(--cdf-color-text-muted);
        font-variant-numeric: tabular-nums;
      }
      .lesson-type {
        font-size: 11px;
        letter-spacing: 0.04em;
        color: var(--cdf-color-text-muted);
      }
      .lesson-title {
        text-decoration: none;
        color: var(--cdf-color-primary);
        font-weight: 500;
      }
      .lesson-title:hover { text-decoration: underline; }
    `,
  ],
})
export class CourseDetailPage {
  private readonly route = inject(ActivatedRoute);
  private readonly courses = inject(CoursesClient);
  private readonly modulesClient = inject(ModulesClient);
  private readonly lessonsClient = inject(LessonsClient);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmDialogService);

  protected readonly slug = signal<string | null>(null);
  protected readonly course = signal<CourseDetail | null>(null);
  protected readonly modules = signal<readonly CourseModule[]>([]);
  protected readonly loading = signal<boolean>(false);
  protected readonly notFound = signal<boolean>(false);

  protected readonly newModuleOpen = signal<boolean>(false);
  protected readonly savingModule = signal<boolean>(false);
  protected newModuleInputs = { title: '' };
  protected readonly moduleErrors = signal<Record<string, string | undefined>>({});
  protected readonly moduleError = signal<string | null>(null);

  protected readonly lessonTypeOptions = LESSON_TYPE_OPTIONS;
  protected readonly lessonForm = signal<NewLessonForm>({ ...EMPTY_LESSON_FORM });
  protected readonly savingLesson = signal<boolean>(false);
  protected lessonInputs: NewLessonForm = { ...EMPTY_LESSON_FORM };
  protected readonly lessonErrors = signal<Record<string, string | undefined>>({});
  protected readonly lessonError = signal<string | null>(null);

  protected readonly crumbs = computed<BreadcrumbCrumb[]>(() => {
    const c = this.course();
    return [
      { label: 'Catalog', routerLink: ['/'] },
      { label: 'Courses', routerLink: ['/courses'] },
      { label: c?.title ?? 'Course' },
    ];
  });

  /**
   * Combine the modules list with the per-module lessons embedded in the
   * course detail response. The detail endpoint already joins lessons,
   * so we don't need to re-fetch unless the user adds a new lesson — in
   * that case `addLessonLocally` patches the cached structure.
   */
  protected readonly modulesWithLessons = computed<
    Array<CourseModule & { lessons: CourseModuleSummary['lessons'] }>
  >(() => {
    const list = this.modules();
    const detail = this.course();
    return list.map((m) => {
      const fromDetail = detail?.modules.find((dm) => dm.id === m.id);
      return { ...m, lessons: fromDetail?.lessons ?? [] };
    });
  });

  constructor() {
    effect(() => {
      this.route.paramMap.subscribe((map) => {
        const slug = map.get('slug');
        this.slug.set(slug);
        if (slug) void this.refresh(slug);
      });
    });
  }

  private async refresh(slug: string): Promise<void> {
    this.loading.set(true);
    this.notFound.set(false);
    try {
      const course = await this.courses.detail(slug);
      const modules = await this.modulesClient.listForCourse(course.id);
      this.course.set(course);
      this.modules.set(modules);
    } catch (err) {
      if (err instanceof ProblemDetailsError && err.isNotFound) {
        this.notFound.set(true);
      } else {
        this.toast.error(this.describeError(err, 'Failed to load course'));
      }
    } finally {
      this.loading.set(false);
    }
  }

  protected statusVariant(
    status: CourseDetail['status'],
  ): 'success' | 'warning' | 'neutral' {
    if (status === 'PUBLISHED') return 'success';
    if (status === 'DRAFT') return 'warning';
    return 'neutral';
  }

  // ─── Module form ──────────────────────────────────────────────────────
  protected openModuleForm(): void {
    this.newModuleInputs = { title: '' };
    this.moduleErrors.set({});
    this.moduleError.set(null);
    this.newModuleOpen.set(true);
  }

  protected closeModuleForm(): void {
    this.newModuleOpen.set(false);
  }

  protected onModuleField(field: 'title', value: string): void {
    this.newModuleInputs = { ...this.newModuleInputs, [field]: value };
    if (this.moduleErrors()[field]) {
      this.moduleErrors.update((e) => ({ ...e, [field]: undefined }));
    }
  }

  protected async saveModule(): Promise<void> {
    const title = this.newModuleInputs.title.trim();
    if (!title) {
      this.moduleErrors.set({ title: 'Required' });
      return;
    }
    const c = this.course();
    if (!c) return;
    this.savingModule.set(true);
    this.moduleError.set(null);
    try {
      const created = await this.modulesClient.create(c.id, { title });
      this.modules.update((ms) => [...ms, created]);
      // Patch the course detail so modulesWithLessons sees the new (empty) row.
      this.course.update((cur) =>
        cur
          ? {
              ...cur,
              moduleCount: cur.moduleCount + 1,
              modules: [
                ...cur.modules,
                {
                  id: created.id,
                  order: created.order,
                  title: created.title,
                  lessons: [],
                },
              ],
            }
          : cur,
      );
      this.toast.success(`Module "${title}" created`);
      this.closeModuleForm();
    } catch (err) {
      this.moduleError.set(this.describeError(err, 'Save failed'));
    } finally {
      this.savingModule.set(false);
    }
  }

  protected async deleteModule(m: CourseModule): Promise<void> {
    const ok = await this.confirm.open({
      title: `Delete module "${m.title}"?`,
      message: 'All lessons inside this module will be cascaded out. This is hard delete.',
      confirmKind: 'danger',
      confirmLabel: 'Delete',
      icon: 'trash',
    });
    if (!ok) return;
    try {
      await this.modulesClient.remove(m.id);
      this.modules.update((ms) => ms.filter((x) => x.id !== m.id));
      this.course.update((cur) =>
        cur
          ? {
              ...cur,
              moduleCount: Math.max(0, cur.moduleCount - 1),
              modules: cur.modules.filter((dm) => dm.id !== m.id),
            }
          : cur,
      );
      this.toast.success(`Module "${m.title}" deleted`);
    } catch (err) {
      this.toast.error(this.describeError(err, 'Delete failed'));
    }
  }

  // ─── Lesson form ──────────────────────────────────────────────────────
  protected openLessonForm(moduleId: string): void {
    this.lessonInputs = { ...EMPTY_LESSON_FORM, moduleId };
    this.lessonForm.set({ ...this.lessonInputs });
    this.lessonErrors.set({});
    this.lessonError.set(null);
  }

  protected closeLessonForm(): void {
    this.lessonForm.set({ ...EMPTY_LESSON_FORM });
  }

  protected onLessonField(field: 'title', value: string): void {
    this.lessonInputs = { ...this.lessonInputs, [field]: value };
    this.lessonForm.update((s) => ({ ...s, [field]: value }));
    if (this.lessonErrors()[field]) {
      this.lessonErrors.update((e) => ({ ...e, [field]: undefined }));
    }
  }

  protected onLessonType(value: LessonType | null): void {
    if (value) {
      this.lessonInputs = { ...this.lessonInputs, type: value };
      this.lessonForm.update((s) => ({ ...s, type: value }));
    }
  }

  protected async saveLesson(moduleId: string): Promise<void> {
    const title = this.lessonInputs.title.trim();
    if (!title) {
      this.lessonErrors.set({ title: 'Required' });
      return;
    }
    this.savingLesson.set(true);
    this.lessonError.set(null);
    try {
      const created = await this.lessonsClient.create(moduleId, {
        title,
        type: this.lessonInputs.type,
      });
      this.course.update((cur) =>
        cur
          ? {
              ...cur,
              modules: cur.modules.map((dm) =>
                dm.id === moduleId
                  ? {
                      ...dm,
                      lessons: [
                        ...dm.lessons,
                        {
                          id: created.id,
                          order: created.order,
                          type: created.type,
                          isFree: created.isFree,
                          estimatedMinutes: created.estimatedMinutes,
                          title: created.title,
                        },
                      ],
                    }
                  : dm,
              ),
            }
          : cur,
      );
      this.modules.update((ms) =>
        ms.map((m) =>
          m.id === moduleId ? { ...m, lessonCount: m.lessonCount + 1 } : m,
        ),
      );
      this.toast.success(`Lesson "${title}" created`);
      this.closeLessonForm();
    } catch (err) {
      this.lessonError.set(this.describeError(err, 'Save failed'));
    } finally {
      this.savingLesson.set(false);
    }
  }

  private describeError(err: unknown, fallback: string): string {
    if (err instanceof ProblemDetailsError) {
      if (err.isUnauthorized) return 'You are signed out.';
      if (err.isForbidden) return 'You do not have permission for that action.';
      if (err.status === 409) return err.message || 'Conflict';
      if (err.message) return err.message;
    }
    return fallback;
  }
}
