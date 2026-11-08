import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  model,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import {
  CdkDrag,
  CdkDragHandle,
  CdkDropList,
  type CdkDragDrop,
} from '@angular/cdk/drag-drop';
import { I18nService, TranslatePipe } from '@codify/i18n';
import {
  Badge,
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
  Toggle,
} from '@codify/ui-bootstrap';
import {
  AdminCatalogClient,
  LessonsClient,
  ModulesClient,
  type CourseDetail,
  type CourseLessonSummary,
  type CourseModuleSummary,
  type LessonType,
} from '@codify/api-client';
import { AdminErrors } from '../core/errors';
import { LESSON_TYPES, lessonCompanion } from '../core/catalog';
import {
  firstLessonIds,
  moveLesson,
  moveModule,
  orderBody,
  renumber,
  stepLesson,
  withFreeSet,
} from '../core/curriculum';

/**
 * Curriculum tab of the course editor (docs/04 Course → Curriculum):
 * collapsible modules, drag-to-reorder modules and lessons (lessons can
 * move between modules) with move-up / move-down buttons as the keyboard
 * alternative, per-lesson free toggle / duplicate / delete, add module /
 * lesson, and "mark first N lessons free" with undo. Every reorder is one
 * atomic `PUT /courses/:id/curriculum/order`; failures roll back.
 */
@Component({
  selector: 'cdf-course-curriculum',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    RouterLink,
    CdkDrag,
    CdkDragHandle,
    CdkDropList,
    Badge,
    Button,
    EmptyState,
    FormField,
    Icon,
    IconButton,
    Input,
    Select,
    Toggle,
    TranslatePipe,
  ],
  template: `
    @if (course(); as c) {
      <header class="section-head">
        <h2>{{ 'admin.course.modules' | translate }}</h2>
        <div class="row-actions">
          @if (c.modules.length > 0) {
            <cdf-button kind="ghost" size="sm" (click)="toggleAll()">
              {{
                (allCollapsed()
                  ? 'admin.curriculum.expandAll'
                  : 'admin.curriculum.collapseAll'
                ) | translate
              }}
            </cdf-button>
          }
          @if (canEdit()) {
            <cdf-button
              kind="primary"
              size="sm"
              (click)="moduleFormOpen.set(true)"
              data-testid="add-module"
            >
              <cdf-icon name="plus" size="sm" />
              {{ 'admin.course.addModule' | translate }}
            </cdf-button>
          }
        </div>
      </header>

      @if (canEdit() && c.lessonCount > 0) {
        <div class="free-bar" data-testid="free-bar">
          <cdf-form-field
            [label]="'admin.curriculum.firstN' | translate"
            [help]="'admin.curriculum.firstNHelp' | translate"
            controlId="first-n-free"
          >
            <cdf-input
              inputId="first-n-free"
              type="number"
              [(ngModel)]="firstN"
            />
          </cdf-form-field>
          <cdf-button
            kind="secondary"
            size="sm"
            [loading]="busy() === 'free'"
            (click)="markFirstFree()"
            data-testid="apply-first-free"
          >
            {{ 'admin.curriculum.applyFirstN' | translate }}
          </cdf-button>
          @if (undoFree(); as prev) {
            <cdf-button
              kind="ghost"
              size="sm"
              (click)="applyFree(prev, true)"
              data-testid="undo-free"
            >
              {{ 'admin.curriculum.undo' | translate }}
            </cdf-button>
          }
        </div>
      }

      @if (moduleFormOpen()) {
        <div class="inline-form">
          <cdf-form-field
            [label]="'admin.course.moduleTitle' | translate"
            controlId="new-module-title"
            [error]="moduleError()"
          >
            <cdf-input
              inputId="new-module-title"
              [(ngModel)]="newModuleTitle"
            />
          </cdf-form-field>
          <div class="form-actions">
            <cdf-button
              kind="primary"
              size="sm"
              [loading]="busy() === 'module'"
              (click)="saveModule()"
              data-testid="create-module"
            >
              {{ 'admin.course.createModule' | translate }}
            </cdf-button>
            <cdf-button
              kind="ghost"
              size="sm"
              (click)="moduleFormOpen.set(false)"
            >
              {{ 'admin.common.cancel' | translate }}
            </cdf-button>
          </div>
        </div>
      }

      <p class="visually-hidden" aria-live="polite">{{ announcement() }}</p>

      @if (c.modules.length === 0) {
        <cdf-empty-state
          icon="folder-open"
          [title]="'admin.course.noModules' | translate"
          [description]="'admin.course.noModulesHelp' | translate"
        >
          @if (canEdit()) {
            <cdf-button kind="primary" (click)="moduleFormOpen.set(true)">
              <cdf-icon name="plus" size="sm" />
              {{ 'admin.course.addModule' | translate }}
            </cdf-button>
          }
        </cdf-empty-state>
      } @else {
        <ol
          class="plain-list module-list"
          cdkDropList
          [cdkDropListDisabled]="!canEdit() || saving()"
          (cdkDropListDropped)="dropModule($event)"
        >
          @for (
            m of c.modules;
            track m.id;
            let mi = $index;
            let lastM = $last
          ) {
            <li
              class="module"
              cdkDrag
              [cdkDragData]="m"
              [attr.data-module-id]="m.id"
            >
              <header class="module-head">
                @if (canEdit()) {
                  <span
                    class="handle"
                    cdkDragHandle
                    [attr.aria-hidden]="true"
                    [title]="'admin.curriculum.drag' | translate"
                  >
                    <cdf-icon name="menu" size="sm" />
                  </span>
                }
                <button
                  type="button"
                  class="collapse"
                  [attr.aria-expanded]="!collapsed().has(m.id)"
                  [attr.aria-controls]="'lessons-' + m.id"
                  (click)="toggle(m.id)"
                >
                  <cdf-icon
                    [name]="
                      collapsed().has(m.id) ? 'caret-right' : 'caret-down'
                    "
                    size="sm"
                  />
                  <span class="muted small">{{
                    'admin.course.moduleN' | translate: { n: mi + 1 }
                  }}</span>
                  <span class="module-title">{{ m.title }}</span>
                  <span class="muted small">{{
                    'admin.curriculum.lessonCount'
                      | translate: { count: m.lessons.length }
                  }}</span>
                </button>
                @if (canEdit()) {
                  <div class="row-actions">
                    <cdf-icon-button
                      icon="caret-up"
                      size="sm"
                      kind="ghost"
                      [disabled]="mi === 0 || saving()"
                      [ariaLabel]="
                        'admin.curriculum.moduleUp'
                          | translate: { title: m.title }
                      "
                      (click)="stepModule(mi, -1)"
                    />
                    <cdf-icon-button
                      icon="caret-down"
                      size="sm"
                      kind="ghost"
                      [disabled]="lastM || saving()"
                      [ariaLabel]="
                        'admin.curriculum.moduleDown'
                          | translate: { title: m.title }
                      "
                      (click)="stepModule(mi, 1)"
                    />
                    <cdf-button
                      kind="ghost"
                      size="sm"
                      (click)="openLessonForm(m.id)"
                    >
                      {{ 'admin.course.addLesson' | translate }}
                    </cdf-button>
                    <cdf-icon-button
                      icon="trash"
                      size="sm"
                      kind="danger"
                      [ariaLabel]="
                        'admin.course.deleteModuleAria'
                          | translate: { title: m.title }
                      "
                      (click)="deleteModule(m)"
                    />
                  </div>
                }
              </header>

              @if (lessonFormFor() === m.id) {
                <div class="inline-form form-grid">
                  <cdf-form-field
                    [label]="'admin.course.lessonTitle' | translate"
                    [controlId]="'new-lesson-title-' + m.id"
                    [error]="lessonError()"
                  >
                    <cdf-input
                      [inputId]="'new-lesson-title-' + m.id"
                      [(ngModel)]="newLesson.title"
                    />
                  </cdf-form-field>
                  <cdf-form-field
                    [label]="'admin.course.lessonType' | translate"
                    [controlId]="'new-lesson-type-' + m.id"
                  >
                    <cdf-select
                      [inputId]="'new-lesson-type-' + m.id"
                      [options]="lessonTypeOptions()"
                      [(ngModel)]="newLesson.type"
                    />
                  </cdf-form-field>
                  <div class="form-actions span-all">
                    <cdf-button
                      kind="primary"
                      size="sm"
                      [loading]="busy() === 'lesson'"
                      (click)="saveLesson(m.id)"
                      data-testid="create-lesson"
                    >
                      {{ 'admin.course.createLesson' | translate }}
                    </cdf-button>
                    <cdf-button
                      kind="ghost"
                      size="sm"
                      (click)="lessonFormFor.set(null)"
                    >
                      {{ 'admin.common.cancel' | translate }}
                    </cdf-button>
                  </div>
                </div>
              }

              <ul
                class="plain-list lesson-list"
                [id]="'lessons-' + m.id"
                [hidden]="collapsed().has(m.id)"
                cdkDropList
                [cdkDropListData]="m.id"
                [cdkDropListConnectedTo]="lessonListIds()"
                [cdkDropListDisabled]="!canEdit() || saving()"
                (cdkDropListDropped)="dropLesson($event)"
              >
                @for (
                  l of m.lessons;
                  track l.id;
                  let li = $index;
                  let lastL = $last
                ) {
                  <li
                    class="lesson"
                    cdkDrag
                    [cdkDragData]="l"
                    [attr.data-lesson-id]="l.id"
                  >
                    @if (canEdit()) {
                      <span class="handle" cdkDragHandle aria-hidden="true">
                        <cdf-icon name="menu" size="sm" />
                      </span>
                    }
                    <span class="muted mono">{{ li + 1 }}</span>
                    <cdf-badge variant="neutral" [subtle]="true">{{
                      'admin.lessonTypes.' + l.type | translate
                    }}</cdf-badge>
                    <span class="lesson-title">
                      @if (canEditLessons()) {
                        <a [routerLink]="['/lessons', l.id]">{{ l.title }}</a>
                      } @else {
                        {{ l.title }}
                      }
                      @if (canEditLessons() && companion(l.type); as comp) {
                        <a
                          class="small companion"
                          [routerLink]="['/lessons', l.id, comp]"
                          >{{ 'admin.course.companion.' + comp | translate }}</a
                        >
                      }
                    </span>
                    <span class="muted small">{{
                      'admin.common.minutes'
                        | translate: { n: l.estimatedMinutes }
                    }}</span>
                    <cdf-toggle
                      [ngModel]="l.isFree"
                      (ngModelChange)="toggleFree(l, $event)"
                      [disabled]="!canEditLessons()"
                      [label]="'admin.course.free' | translate"
                    />
                    @if (canEdit()) {
                      <span class="row-actions">
                        <cdf-icon-button
                          icon="caret-up"
                          size="sm"
                          kind="ghost"
                          [disabled]="(mi === 0 && li === 0) || saving()"
                          [ariaLabel]="
                            'admin.curriculum.lessonUp'
                              | translate: { title: l.title }
                          "
                          (click)="stepLessonAt(m.id, li, -1)"
                        />
                        <cdf-icon-button
                          icon="caret-down"
                          size="sm"
                          kind="ghost"
                          [disabled]="(lastM && lastL) || saving()"
                          [ariaLabel]="
                            'admin.curriculum.lessonDown'
                              | translate: { title: l.title }
                          "
                          (click)="stepLessonAt(m.id, li, 1)"
                        />
                        <cdf-button
                          kind="ghost"
                          size="sm"
                          [loading]="busy() === 'dup:' + l.id"
                          [attr.aria-label]="
                            'admin.curriculum.duplicateAria'
                              | translate: { title: l.title }
                          "
                          (click)="duplicate(l)"
                          [attr.data-testid]="'duplicate-' + l.id"
                        >
                          {{ 'admin.curriculum.duplicate' | translate }}
                        </cdf-button>
                        <cdf-icon-button
                          icon="trash"
                          size="sm"
                          kind="danger"
                          [ariaLabel]="
                            'admin.curriculum.deleteLessonAria'
                              | translate: { title: l.title }
                          "
                          (click)="deleteLesson(m, l)"
                        />
                      </span>
                    }
                  </li>
                } @empty {
                  <li class="muted small empty-drop">
                    {{ 'admin.curriculum.emptyModule' | translate }}
                  </li>
                }
              </ul>
            </li>
          }
        </ol>
      }
    }
  `,
  styles: [
    `
      .inline-form,
      .free-bar {
        background: var(--cdf-color-bg);
        border: 1px solid var(--cdf-color-border);
        border-radius: var(--cdf-radius-sm);
        padding: var(--cdf-space-3);
        margin-bottom: var(--cdf-space-3);
      }
      .free-bar {
        display: flex;
        flex-wrap: wrap;
        align-items: flex-end;
        gap: var(--cdf-space-3);
      }
      .module-list {
        display: flex;
        flex-direction: column;
        gap: var(--cdf-space-3);
      }
      .module {
        border: 1px solid var(--cdf-color-border);
        border-radius: var(--cdf-radius-sm);
        padding: var(--cdf-space-2) var(--cdf-space-3);
        background: var(--cdf-color-surface);
      }
      .module-head {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--cdf-space-2);
      }
      .collapse {
        flex: 1 1 240px;
        min-width: 0;
        display: inline-flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 6px;
        border: 0;
        background: none;
        padding: 4px;
        text-align: start;
        color: inherit;
        border-radius: var(--cdf-radius-sm);
      }
      .collapse:focus-visible {
        box-shadow: var(--cdf-shadow-focus-ring);
        outline: none;
      }
      .module-title {
        font-weight: 600;
      }
      .handle {
        cursor: grab;
        color: var(--cdf-color-text-subtle);
        display: inline-flex;
      }
      .lesson-list {
        min-height: 32px;
      }
      .lesson {
        display: grid;
        grid-template-columns: 20px 24px 110px minmax(0, 1fr) 64px 96px auto;
        align-items: center;
        gap: var(--cdf-space-2);
        padding: 6px 0;
        border-top: 1px solid var(--cdf-color-border);
        background: var(--cdf-color-surface);
      }
      .lesson-title {
        display: flex;
        flex-direction: column;
        min-width: 0;
      }
      .companion {
        font-size: 12px;
      }
      .empty-drop {
        padding: 8px 0;
        border-top: 1px dashed var(--cdf-color-border);
      }
      .cdk-drag-preview {
        box-shadow: var(--cdf-shadow-3);
      }
      .cdk-drag-placeholder {
        opacity: 0.4;
      }
      @media (max-width: 1023.98px) {
        .lesson {
          grid-template-columns: 20px 24px minmax(0, 1fr) auto;
        }
        .lesson > cdf-badge,
        .lesson > .muted.small {
          display: none;
        }
      }
      @media (max-width: 599.98px) {
        .lesson {
          grid-template-columns: 20px minmax(0, 1fr);
        }
        .lesson > .mono {
          display: none;
        }
      }
    `,
  ],
})
export class CourseCurriculum {
  private readonly admin = inject(AdminCatalogClient);
  private readonly modulesClient = inject(ModulesClient);
  private readonly lessonsClient = inject(LessonsClient);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmDialogService);
  private readonly errorsSvc = inject(AdminErrors);
  private readonly i18n = inject(I18nService);

  /** The course being edited; updated in place (two-way). */
  readonly course = model.required<CourseDetail>();
  readonly canEdit = input(false);
  readonly canEditLessons = input(false);

  protected readonly companion = lessonCompanion;
  protected readonly busy = signal<string | null>(null);
  protected readonly saving = signal(false);
  protected readonly collapsed = signal<Set<string>>(new Set());
  protected readonly announcement = signal('');
  protected readonly undoFree = signal<string[] | null>(null);
  protected firstN = 3;

  protected readonly moduleFormOpen = signal(false);
  protected newModuleTitle = '';
  protected readonly moduleError = signal<string | null>(null);
  protected readonly lessonFormFor = signal<string | null>(null);
  protected newLesson: { title: string; type: LessonType } = {
    title: '',
    type: 'READING',
  };
  protected readonly lessonError = signal<string | null>(null);

  protected readonly lessonListIds = computed(() =>
    this.course().modules.map((m) => `lessons-${m.id}`),
  );

  protected readonly allCollapsed = computed(
    () =>
      this.course().modules.length > 0 &&
      this.course().modules.every((m) => this.collapsed().has(m.id)),
  );

  protected readonly lessonTypeOptions = computed<SelectOption<LessonType>[]>(
    () => {
      this.i18n.currentLocale();
      return LESSON_TYPES.map((t) => ({
        value: t,
        label: this.i18n.t(`admin.lessonTypes.${t}`),
      }));
    },
  );

  /** True while an inline form holds typed-in text (unsaved-changes guard). */
  hasUnsavedChanges(): boolean {
    return (
      (this.moduleFormOpen() && !!this.newModuleTitle.trim()) ||
      (this.lessonFormFor() !== null && !!this.newLesson.title.trim())
    );
  }

  private setModules(modules: CourseModuleSummary[]): void {
    this.course.update((c) => ({
      ...c,
      modules,
      moduleCount: modules.length,
      lessonCount: modules.reduce((n, m) => n + m.lessons.length, 0),
    }));
  }

  // ─── Collapse ─────────────────────────────────────────────────────────

  protected toggle(id: string): void {
    this.collapsed.update((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  protected toggleAll(): void {
    this.collapsed.set(
      this.allCollapsed()
        ? new Set()
        : new Set(this.course().modules.map((m) => m.id)),
    );
  }

  // ─── Reorder ──────────────────────────────────────────────────────────

  protected dropModule(ev: CdkDragDrop<unknown>): void {
    if (ev.previousIndex === ev.currentIndex) return;
    void this.persistOrder(
      moveModule(this.course().modules, ev.previousIndex, ev.currentIndex),
    );
  }

  protected dropLesson(ev: CdkDragDrop<string>): void {
    const from = {
      moduleId: ev.previousContainer.data,
      index: ev.previousIndex,
    };
    const to = { moduleId: ev.container.data, index: ev.currentIndex };
    if (from.moduleId === to.moduleId && from.index === to.index) return;
    void this.persistOrder(moveLesson(this.course().modules, from, to));
  }

  protected stepModule(index: number, dir: -1 | 1): void {
    const m = this.course().modules[index];
    void this.persistOrder(
      moveModule(this.course().modules, index, index + dir),
      `[data-module-id="${m?.id}"] .collapse`,
    );
  }

  protected stepLessonAt(moduleId: string, index: number, dir: -1 | 1): void {
    const lesson = this.course().modules.find((m) => m.id === moduleId)
      ?.lessons[index];
    const next = stepLesson(this.course().modules, moduleId, index, dir);
    if (next && lesson)
      void this.persistOrder(next, `[data-lesson-id="${lesson.id}"] a`);
  }

  /** Optimistic reorder; rolls back when the API refuses. */
  private async persistOrder(
    next: CourseModuleSummary[],
    refocus?: string,
  ): Promise<void> {
    const before = this.course().modules;
    this.setModules(renumber(next));
    this.saving.set(true);
    try {
      await this.admin.reorderCurriculum(this.course().id, orderBody(next));
      this.announcement.set(this.i18n.t('admin.curriculum.reordered'));
      if (refocus)
        queueMicrotask(() =>
          setTimeout(() =>
            document.querySelector<HTMLElement>(refocus)?.focus(),
          ),
        );
    } catch (err) {
      this.setModules([...before]);
      this.errorsSvc.toast(err, 'admin.errors.saveFailed');
    } finally {
      this.saving.set(false);
    }
  }

  // ─── Free lessons ─────────────────────────────────────────────────────

  protected async markFirstFree(): Promise<void> {
    const n = Math.max(0, Math.round(Number(this.firstN) || 0));
    await this.applyFree(firstLessonIds(this.course().modules, n), false);
  }

  async applyFree(ids: string[], isUndo: boolean): Promise<void> {
    this.busy.set('free');
    try {
      const res = await this.admin.setFreeLessons(this.course().id, ids);
      this.setModules(withFreeSet(this.course().modules, res.freeLessonIds));
      this.undoFree.set(isUndo ? null : res.previousFreeLessonIds);
      this.toast.success(
        this.i18n.t(
          isUndo ? 'admin.curriculum.freeRestored' : 'admin.curriculum.freeSet',
          { count: res.freeLessonIds.length },
        ),
      );
    } catch (err) {
      this.errorsSvc.toast(err, 'admin.errors.saveFailed');
    } finally {
      this.busy.set(null);
    }
  }

  protected async toggleFree(
    l: CourseLessonSummary,
    isFree: boolean,
  ): Promise<void> {
    const patch = (free: boolean) =>
      this.setModules(
        this.course().modules.map((m) => ({
          ...m,
          lessons: m.lessons.map((x) =>
            x.id === l.id ? { ...x, isFree: free } : x,
          ),
        })),
      );
    patch(isFree); // optimistic
    try {
      await this.lessonsClient.update(l.id, { isFree });
    } catch (err) {
      patch(!isFree); // rollback
      this.errorsSvc.toast(err, 'admin.errors.saveFailed');
    }
  }

  // ─── Lessons ──────────────────────────────────────────────────────────

  protected async duplicate(l: CourseLessonSummary): Promise<void> {
    this.busy.set(`dup:${l.id}`);
    try {
      const copy = await this.admin.duplicateLesson(this.course().id, l.id);
      const summary: CourseLessonSummary = {
        id: copy.id,
        order: copy.order,
        type: copy.type as LessonType,
        isFree: copy.isFree,
        estimatedMinutes: copy.estimatedMinutes,
        title: copy.title,
      };
      this.setModules(
        this.course().modules.map((m) => {
          if (m.id !== copy.moduleId) return m;
          const at = m.lessons.findIndex((x) => x.id === l.id);
          const lessons = [...m.lessons];
          lessons.splice(at + 1, 0, summary);
          return { ...m, lessons };
        }),
      );
      this.toast.success(
        this.i18n.t('admin.curriculum.duplicated', { title: copy.title }),
      );
    } catch (err) {
      this.errorsSvc.toast(err, 'admin.errors.actionFailed');
    } finally {
      this.busy.set(null);
    }
  }

  protected async deleteLesson(
    m: CourseModuleSummary,
    l: CourseLessonSummary,
  ): Promise<void> {
    const ok = await this.confirm.open({
      title: this.i18n.t('admin.common.deleteConfirmTitle', { name: l.title }),
      message: this.i18n.t('admin.curriculum.deleteLessonMessage'),
      confirmKind: 'danger',
      confirmLabel: this.i18n.t('admin.common.delete'),
      icon: 'trash',
    });
    if (!ok) return;
    try {
      await this.lessonsClient.remove(l.id);
      this.setModules(
        this.course().modules.map((x) =>
          x.id === m.id
            ? { ...x, lessons: x.lessons.filter((y) => y.id !== l.id) }
            : x,
        ),
      );
      this.toast.success(
        this.i18n.t('admin.curriculum.lessonDeleted', { title: l.title }),
      );
    } catch (err) {
      this.errorsSvc.toast(err, 'admin.errors.deleteFailed');
    }
  }

  protected openLessonForm(moduleId: string): void {
    this.newLesson = { title: '', type: 'READING' };
    this.lessonError.set(null);
    this.lessonFormFor.set(moduleId);
    this.collapsed.update((s) => {
      const next = new Set(s);
      next.delete(moduleId);
      return next;
    });
  }

  protected async saveLesson(moduleId: string): Promise<void> {
    const title = this.newLesson.title.trim();
    if (!title) {
      this.lessonError.set(this.i18n.t('admin.common.required'));
      return;
    }
    this.lessonError.set(null);
    this.busy.set('lesson');
    try {
      const created = await this.lessonsClient.create(moduleId, {
        title,
        type: this.newLesson.type,
      });
      const summary: CourseLessonSummary = {
        id: created.id,
        order: created.order,
        type: created.type,
        isFree: created.isFree,
        estimatedMinutes: created.estimatedMinutes,
        title: created.title,
      };
      this.setModules(
        this.course().modules.map((m) =>
          m.id === moduleId ? { ...m, lessons: [...m.lessons, summary] } : m,
        ),
      );
      this.lessonFormFor.set(null);
      this.newLesson = { title: '', type: 'READING' };
      this.toast.success(this.i18n.t('admin.course.lessonCreated', { title }));
    } catch (err) {
      this.lessonError.set(
        this.errorsSvc.message(err, 'admin.errors.saveFailed'),
      );
    } finally {
      this.busy.set(null);
    }
  }

  // ─── Modules ──────────────────────────────────────────────────────────

  protected async saveModule(): Promise<void> {
    const title = this.newModuleTitle.trim();
    if (!title) {
      this.moduleError.set(this.i18n.t('admin.common.required'));
      return;
    }
    this.moduleError.set(null);
    this.busy.set('module');
    try {
      const created = await this.modulesClient.create(this.course().id, {
        title,
      });
      this.setModules([
        ...this.course().modules,
        { id: created.id, order: created.order, title, lessons: [] },
      ]);
      this.newModuleTitle = '';
      this.moduleFormOpen.set(false);
      this.toast.success(this.i18n.t('admin.course.moduleCreated', { title }));
    } catch (err) {
      this.moduleError.set(
        this.errorsSvc.message(err, 'admin.errors.saveFailed'),
      );
    } finally {
      this.busy.set(null);
    }
  }

  protected async deleteModule(m: CourseModuleSummary): Promise<void> {
    const ok = await this.confirm.open({
      title: this.i18n.t('admin.common.deleteConfirmTitle', { name: m.title }),
      message: this.i18n.t('admin.course.deleteModuleMessage', {
        count: m.lessons.length,
      }),
      confirmKind: 'danger',
      confirmLabel: this.i18n.t('admin.common.delete'),
      icon: 'trash',
    });
    if (!ok) return;
    try {
      await this.modulesClient.remove(m.id);
      this.setModules(this.course().modules.filter((x) => x.id !== m.id));
      this.toast.success(
        this.i18n.t('admin.course.moduleDeleted', { title: m.title }),
      );
    } catch (err) {
      this.errorsSvc.toast(err, 'admin.errors.deleteFailed');
    }
  }
}
