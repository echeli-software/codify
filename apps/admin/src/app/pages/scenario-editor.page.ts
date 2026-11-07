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
import { I18nService, TranslatePipe } from '@codify/i18n';
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
  Toggle,
} from '@codify/ui-bootstrap';
import {
  LessonsClient,
  ScenariosClient,
  type Lesson,
  type ScenarioGraph,
} from '@codify/api-client';
import { AdminErrors, validationProblemsOf } from '../core/errors';
import {
  addChoice,
  addNode,
  draftToGraph,
  emptyScenario,
  graphToDraft,
  removeChoice,
  removeNode,
  renameNode,
  scenarioProblems,
  unreachableNodeIds,
  type ScenarioDraft,
} from '../core/scenario-model';
import { type HasUnsavedChanges, warnOnUnload } from '../core/unsaved-changes';

/**
 * Scenario editor (branching dialogue, docs/17): a visual node list —
 * speaker + text, choices with target dropdowns or endings with an outcome,
 * the start node — with live validation (the same rules the API runs), a
 * reachability hint, the API's `INVALID_SCENARIO` problems after save, and
 * a raw JSON view as an advanced toggle.
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
    Toggle,
    TranslatePipe,
  ],
  template: `
    <div class="admin-page">
      <cdf-breadcrumb-bar [crumbs]="crumbs()" />
      <header class="page-head">
        <div>
          <h1>{{ 'admin.scenario.title' | translate }}</h1>
          <p class="muted">
            {{ 'admin.scenario.subtitle' | translate }}
            <a [routerLink]="['/lessons', lessonId()]">{{
              'admin.exercise.backToLesson' | translate
            }}</a>
          </p>
        </div>
        <div class="page-head__actions">
          <cdf-toggle
            [ngModel]="jsonMode()"
            (ngModelChange)="toggleJson($event)"
            [label]="'admin.scenario.jsonView' | translate"
          />
          @if (scenarioId()) {
            <cdf-badge variant="success" [subtle]="true">{{
              'admin.exercise.attached' | translate
            }}</cdf-badge>
          }
          <cdf-button
            kind="primary"
            [loading]="saving()"
            [disabled]="!dirty() && !!scenarioId()"
            (click)="save()"
            data-testid="scenario-save"
          >
            {{
              (scenarioId()
                ? 'admin.common.saveChanges'
                : 'admin.scenario.create'
              ) | translate
            }}
          </cdf-button>
        </div>
      </header>

      <section
        class="admin-card checks"
        aria-live="polite"
        data-testid="scenario-checks"
      >
        <h2>{{ 'admin.scenario.checks' | translate }}</h2>
        @if (apiErrors().length > 0) {
          <p class="form-error">
            {{ 'admin.errors.code.INVALID_SCENARIO' | translate }}
          </p>
          <ul class="issue-list" role="alert">
            @for (e of apiErrors(); track $index) {
              <li>{{ e }}</li>
            }
          </ul>
        }
        @if (problems().length === 0) {
          <p class="ok small">
            <cdf-icon name="check-circle" size="sm" />
            {{ 'admin.scenario.valid' | translate }}
          </p>
        } @else {
          <ul class="issue-list">
            @for (p of problems(); track $index) {
              <li>{{ p }}</li>
            }
          </ul>
        }
        @if (unreachable().length > 0) {
          <p class="small warn">
            <cdf-icon name="warning" size="sm" />
            {{
              'admin.scenario.unreachable'
                | translate: { ids: unreachable().join(', ') }
            }}
          </p>
        }
        @if (formError(); as e) {
          <p class="form-error" role="alert">{{ e }}</p>
        }
      </section>

      @if (jsonMode()) {
        <section class="admin-card">
          <label class="form-label" for="scenario-json">{{
            'admin.scenario.json' | translate
          }}</label>
          <textarea
            id="scenario-json"
            class="form-control mono"
            rows="22"
            spellcheck="false"
            [(ngModel)]="jsonText"
            data-testid="scenario-graph"
          ></textarea>
          @if (jsonError(); as e) {
            <p class="form-error" role="alert">{{ e }}</p>
          }
          <div class="form-actions">
            <cdf-button kind="secondary" (click)="applyJson()">
              {{ 'admin.scenario.applyJson' | translate }}
            </cdf-button>
          </div>
        </section>
      } @else {
        <section class="admin-card">
          <header class="section-head">
            <h2>{{ 'admin.scenario.nodes' | translate }}</h2>
            <div class="row-actions">
              <cdf-form-field
                [label]="'admin.scenario.startNode' | translate"
                controlId="scenario-start"
              >
                <cdf-select
                  inputId="scenario-start"
                  [options]="nodeOptions()"
                  [ngModel]="draft().startId"
                  (ngModelChange)="setStart($event)"
                />
              </cdf-form-field>
              <cdf-button
                kind="secondary"
                size="sm"
                (click)="onAddNode()"
                data-testid="add-node"
              >
                <cdf-icon name="plus" size="sm" />
                {{ 'admin.scenario.addNode' | translate }}
              </cdf-button>
            </div>
          </header>

          <ol class="plain-list nodes">
            @for (n of draft().nodes; track n.uid) {
              <li
                class="node"
                [class.node--start]="n.id === draft().startId"
                [class.node--orphan]="unreachable().includes(n.id)"
                [attr.data-node]="n.id"
              >
                <header class="node__head">
                  @if (n.id === draft().startId) {
                    <cdf-badge variant="primary" [subtle]="true">{{
                      'admin.scenario.start' | translate
                    }}</cdf-badge>
                  }
                  <code>{{ n.id }}</code>
                  <cdf-icon-button
                    class="node__remove"
                    icon="trash"
                    size="sm"
                    kind="danger"
                    [ariaLabel]="
                      'admin.scenario.removeNode' | translate: { id: n.id }
                    "
                    (click)="onRemoveNode(n.uid)"
                  />
                </header>
                <div class="form-grid">
                  <cdf-form-field
                    [label]="'admin.scenario.nodeId' | translate"
                    [controlId]="n.uid + '-id'"
                  >
                    <cdf-input
                      [inputId]="n.uid + '-id'"
                      [ngModel]="n.id"
                      (ngModelChange)="onRename(n.uid, $event)"
                    />
                  </cdf-form-field>
                  <cdf-form-field
                    [label]="'admin.scenario.speaker' | translate"
                    [controlId]="n.uid + '-speaker'"
                  >
                    <cdf-input
                      [inputId]="n.uid + '-speaker'"
                      [(ngModel)]="n.speaker"
                      (ngModelChange)="touch()"
                    />
                  </cdf-form-field>
                  <div class="span-all">
                    <label class="form-label" [for]="n.uid + '-text'">{{
                      'admin.scenario.text' | translate
                    }}</label>
                    <textarea
                      class="form-control"
                      rows="2"
                      [id]="n.uid + '-text'"
                      [(ngModel)]="n.text"
                      (ngModelChange)="touch()"
                    ></textarea>
                  </div>
                </div>

                <h3 class="choices-title">
                  {{ 'admin.scenario.choices' | translate }}
                </h3>
                <ul class="plain-list choices">
                  @for (c of n.choices; track c.uid) {
                    <li class="choice">
                      <cdf-form-field
                        [label]="'admin.scenario.choiceLabel' | translate"
                        [controlId]="c.uid + '-label'"
                      >
                        <cdf-input
                          [inputId]="c.uid + '-label'"
                          [(ngModel)]="c.label"
                          (ngModelChange)="touch()"
                        />
                      </cdf-form-field>
                      <cdf-toggle
                        [(ngModel)]="c.ending"
                        (ngModelChange)="touch()"
                        [label]="'admin.scenario.ending' | translate"
                      />
                      @if (c.ending) {
                        <cdf-form-field
                          [label]="'admin.scenario.outcome' | translate"
                          [controlId]="c.uid + '-outcome'"
                        >
                          <cdf-input
                            [inputId]="c.uid + '-outcome'"
                            [(ngModel)]="c.outcome"
                            (ngModelChange)="touch()"
                          />
                        </cdf-form-field>
                      } @else {
                        <cdf-form-field
                          [label]="'admin.scenario.goesTo' | translate"
                          [controlId]="c.uid + '-target'"
                        >
                          <cdf-select
                            [inputId]="c.uid + '-target'"
                            [options]="nodeOptions()"
                            [placeholder]="
                              'admin.scenario.pickTarget' | translate
                            "
                            [(ngModel)]="c.target"
                            (ngModelChange)="touch()"
                          />
                        </cdf-form-field>
                      }
                      <cdf-icon-button
                        icon="x"
                        size="sm"
                        [ariaLabel]="'admin.scenario.removeChoice' | translate"
                        (click)="onRemoveChoice(n.uid, c.uid)"
                      />
                    </li>
                  } @empty {
                    <li class="muted small">
                      {{ 'admin.scenario.terminal' | translate }}
                    </li>
                  }
                </ul>
                <cdf-button kind="ghost" size="sm" (click)="onAddChoice(n.uid)">
                  <cdf-icon name="plus" size="sm" />
                  {{ 'admin.scenario.addChoice' | translate }}
                </cdf-button>
              </li>
            }
          </ol>
        </section>
      }
    </div>
  `,
  styles: [
    `
      .checks h2 {
        margin-bottom: var(--cdf-space-2);
      }
      .ok {
        color: var(--cdf-color-success);
        display: flex;
        gap: 6px;
        align-items: center;
        margin: 0;
      }
      .warn {
        color: var(--cdf-color-warning);
        display: flex;
        gap: 6px;
        align-items: center;
      }
      .nodes {
        display: flex;
        flex-direction: column;
        gap: var(--cdf-space-3);
      }
      .node {
        border: 1px solid var(--cdf-color-border);
        border-left-width: 4px;
        border-radius: var(--cdf-radius-sm);
        padding: var(--cdf-space-3);
      }
      .node--start {
        border-left-color: var(--cdf-color-primary);
      }
      .node--orphan {
        border-left-color: var(--cdf-color-warning);
      }
      .node__head {
        display: flex;
        align-items: center;
        gap: var(--cdf-space-2);
        margin-bottom: var(--cdf-space-2);
      }
      .node__remove {
        margin-left: auto;
      }
      .choices-title {
        font-size: var(--cdf-font-size-sm);
        margin: var(--cdf-space-3) 0 var(--cdf-space-2);
      }
      .choice {
        display: grid;
        grid-template-columns: minmax(0, 2fr) auto minmax(0, 1.5fr) auto;
        gap: var(--cdf-space-2);
        align-items: end;
        padding: 6px 0;
        border-top: 1px dashed var(--cdf-color-border);
      }
      @media (max-width: 760px) {
        .choice {
          grid-template-columns: minmax(0, 1fr);
        }
      }
    `,
  ],
})
export class ScenarioEditorPage implements HasUnsavedChanges {
  private readonly route = inject(ActivatedRoute);
  private readonly client = inject(ScenariosClient);
  private readonly lessons = inject(LessonsClient);
  private readonly toast = inject(ToastService);
  private readonly errorsSvc = inject(AdminErrors);
  private readonly i18n = inject(I18nService);

  protected readonly lessonId = signal('');
  protected readonly lesson = signal<Lesson | null>(null);
  protected readonly scenarioId = signal<string | null>(null);
  protected readonly draft = signal<ScenarioDraft>(emptyScenario());
  protected readonly dirty = signal(false);
  protected readonly saving = signal(false);
  protected readonly jsonMode = signal(false);
  protected readonly jsonError = signal<string | null>(null);
  protected readonly formError = signal<string | null>(null);
  protected readonly apiErrors = signal<string[]>([]);
  private readonly version = signal(0);
  protected jsonText = '';

  protected readonly problems = computed(() => {
    this.version();
    return scenarioProblems(this.draft());
  });
  protected readonly unreachable = computed(() => {
    this.version();
    return unreachableNodeIds(this.draft());
  });
  protected readonly nodeOptions = computed<SelectOption<string>[]>(() => {
    this.version();
    return this.draft().nodes.map((n) => ({ value: n.id, label: n.id }));
  });

  protected readonly crumbs = computed<BreadcrumbCrumb[]>(() => {
    this.i18n.currentLocale();
    return [
      { label: this.i18n.t('admin.nav.courses'), routerLink: ['/courses'] },
      {
        label: this.lesson()?.title ?? this.i18n.t('admin.lesson.lesson'),
        routerLink: ['/lessons', this.lessonId()],
      },
      { label: this.i18n.t('admin.scenario.title') },
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
      const [lesson, s] = await Promise.all([
        this.lessons.detail(lessonId),
        this.client.getByLesson(lessonId),
      ]);
      this.lesson.set(lesson);
      if (s) {
        this.scenarioId.set(s.id);
        this.draft.set(graphToDraft(s.graphJson));
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

  private update(fn: (d: ScenarioDraft) => ScenarioDraft): void {
    this.draft.update(fn);
    this.touch();
  }

  protected setStart(id: string | null): void {
    if (id) this.update((d) => ({ ...d, startId: id }));
  }
  protected onAddNode(): void {
    this.update(addNode);
  }
  protected onRemoveNode(uid: string): void {
    this.update((d) => removeNode(d, uid));
  }
  protected onRename(uid: string, id: string): void {
    this.update((d) => renameNode(d, uid, id.trim()));
  }
  protected onAddChoice(nodeUid: string): void {
    this.update((d) => addChoice(d, nodeUid));
  }
  protected onRemoveChoice(nodeUid: string, choiceUid: string): void {
    this.update((d) => removeChoice(d, nodeUid, choiceUid));
  }

  protected toggleJson(on: boolean): void {
    if (on) {
      this.jsonText = JSON.stringify(draftToGraph(this.draft()), null, 2);
      this.jsonError.set(null);
      this.jsonMode.set(true);
    } else if (this.applyJson()) {
      this.jsonMode.set(false);
    }
  }

  /** Parse the JSON view into the visual model; false (with an error) if invalid. */
  protected applyJson(): boolean {
    try {
      const g = JSON.parse(this.jsonText) as ScenarioGraph;
      if (
        !g ||
        typeof g !== 'object' ||
        typeof g.nodes !== 'object' ||
        !g.nodes
      )
        throw new Error(this.i18n.t('admin.scenario.jsonShape'));
      const before = JSON.stringify(draftToGraph(this.draft()));
      this.draft.set(graphToDraft(g));
      if (JSON.stringify(draftToGraph(this.draft())) !== before) this.touch();
      else this.version.update((v) => v + 1);
      this.jsonError.set(null);
      return true;
    } catch (e) {
      this.jsonError.set(
        this.i18n.t('admin.common.invalidJson', {
          message: e instanceof Error ? e.message : String(e),
        }),
      );
      return false;
    }
  }

  protected async save(): Promise<void> {
    if (this.jsonMode() && !this.applyJson()) return;
    this.formError.set(null);
    this.apiErrors.set([]);
    const graph = draftToGraph(this.draft());
    this.saving.set(true);
    try {
      const id = this.scenarioId();
      const saved = id
        ? await this.client.update(id, graph)
        : await this.client.create(this.lessonId(), graph);
      this.scenarioId.set(saved.id);
      this.dirty.set(false);
      this.toast.success(this.i18n.t('admin.scenario.saved'));
    } catch (err) {
      const problems = validationProblemsOf(err, 'INVALID_SCENARIO');
      if (problems.length) this.apiErrors.set(problems);
      else
        this.formError.set(
          this.errorsSvc.message(err, 'admin.errors.saveFailed'),
        );
    } finally {
      this.saving.set(false);
    }
  }
}
