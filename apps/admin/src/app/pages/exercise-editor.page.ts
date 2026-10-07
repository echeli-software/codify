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
  Input,
  Select,
  type SelectOption,
  ToastService,
} from '@codify/ui-bootstrap';
import {
  ExercisesClient,
  LessonsClient,
  type CreateExerciseBody,
  type ExerciseLanguage,
  type ExerciseTestCase,
  type RunResult,
} from '@codify/api-client';
import { AdminErrors } from '../core/errors';
import { type HasUnsavedChanges, warnOnUnload } from '../core/unsaved-changes';
import { CodeEditor } from '../shared/code-editor/code-editor';

const LANGUAGES: readonly ExerciseLanguage[] = [
  'javascript',
  'typescript',
  'python',
];

const STARTERS: Record<
  ExerciseLanguage,
  { starter: string; solution: string }
> = {
  javascript: {
    starter: 'function solution(a, b) {\n  // your code\n}\n',
    solution: 'function solution(a, b) {\n  return a + b;\n}\n',
  },
  typescript: {
    starter:
      'function solution(a: number, b: number): number {\n  // your code\n  return 0;\n}\n',
    solution:
      'function solution(a: number, b: number): number {\n  return a + b;\n}\n',
  },
  python: {
    starter: 'def solution(a, b):\n    # your code\n    pass\n',
    solution: 'def solution(a, b):\n    return a + b\n',
  },
};

const SAMPLE_VISIBLE: ExerciseTestCase[] = [
  { id: 'v1', name: 'adds two numbers', args: [1, 2], expected: 3 },
];
const SAMPLE_HIDDEN: ExerciseTestCase[] = [
  { id: 'h1', name: 'handles negatives', args: [-1, -2], expected: -3 },
];

interface ExerciseForm {
  language: ExerciseLanguage;
  entryFunction: string;
  starterCode: string;
  solutionCode: string;
  testHarness: string;
  visibleTests: string;
  hiddenTests: string;
  timeLimitMs: number;
  memoryLimitKb: number;
}

export type TestsProblem =
  | { kind: 'json'; detail: string }
  | { kind: 'notArray' }
  | { kind: 'idName' | 'args' | 'expected'; index: number };

/** Parse + shape-check a tests JSON array (`[{ id, name, args, expected }]`). */
export function parseTests(
  text: string,
):
  | { ok: true; tests: ExerciseTestCase[] }
  | { ok: false; problem: TestsProblem } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return {
      ok: false,
      problem: {
        kind: 'json',
        detail: e instanceof Error ? e.message : String(e),
      },
    };
  }
  if (!Array.isArray(parsed))
    return { ok: false, problem: { kind: 'notArray' } };
  for (const [i, t] of parsed.entries()) {
    const c = (t ?? {}) as Partial<ExerciseTestCase>;
    const index = i + 1;
    if (typeof c.id !== 'string' || !c.id || typeof c.name !== 'string')
      return { ok: false, problem: { kind: 'idName', index } };
    if (!Array.isArray(c.args))
      return { ok: false, problem: { kind: 'args', index } };
    if (!('expected' in c))
      return { ok: false, problem: { kind: 'expected', index } };
  }
  return { ok: true, tests: parsed as ExerciseTestCase[] };
}

/**
 * Exercise editor (docs/12): Monaco-backed code fields for starter, solution,
 * custom harness and the visible / hidden test JSON, language restricted to
 * what the runner executes, time / memory limits, and "verify reference
 * solution" with a per-test result table.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    RouterLink,
    Badge,
    BreadcrumbBar,
    Button,
    CodeEditor,
    FormField,
    Icon,
    Input,
    Select,
    TranslatePipe,
  ],
  template: `
    <div class="admin-page admin-page--wide">
      <cdf-breadcrumb-bar [crumbs]="crumbs()" />
      <header class="page-head">
        <div>
          <h1>{{ 'admin.exercise.title' | translate }}</h1>
          <p class="muted">
            {{ 'admin.exercise.subtitle' | translate }}
            <a [routerLink]="['/lessons', lessonId()]">{{
              'admin.exercise.backToLesson' | translate
            }}</a>
          </p>
        </div>
        <div class="page-head__actions">
          @if (exerciseId()) {
            <cdf-badge variant="success" [subtle]="true">{{
              'admin.exercise.attached' | translate
            }}</cdf-badge>
          }
          <cdf-button
            kind="secondary"
            [loading]="verifying()"
            (click)="verify()"
            data-testid="verify-exercise"
          >
            <cdf-icon name="check-circle" size="sm" />
            {{ 'admin.exercise.verify' | translate }}
          </cdf-button>
          <cdf-button
            kind="primary"
            [loading]="saving()"
            [disabled]="!dirty() && !!exerciseId()"
            (click)="save()"
            data-testid="save-exercise"
          >
            {{
              (exerciseId()
                ? 'admin.common.saveChanges'
                : 'admin.exercise.create'
              ) | translate
            }}
          </cdf-button>
        </div>
      </header>

      @if (formError(); as e) {
        <p class="form-error" role="alert">{{ e }}</p>
      }

      <section class="admin-card">
        <div class="form-grid">
          <cdf-form-field
            [label]="'admin.exercise.language' | translate"
            [help]="'admin.exercise.languageHelp' | translate"
            controlId="ex-language"
          >
            <cdf-select
              inputId="ex-language"
              [options]="languageOptions"
              [ngModel]="f.language"
              (ngModelChange)="onLanguage($event)"
            />
          </cdf-form-field>
          <cdf-form-field
            [label]="'admin.exercise.entryFunction' | translate"
            [help]="'admin.exercise.entryFunctionHelp' | translate"
            controlId="ex-entry"
            [error]="fieldErrors()['entryFunction'] ?? null"
          >
            <cdf-input
              inputId="ex-entry"
              [(ngModel)]="f.entryFunction"
              (ngModelChange)="touch()"
            />
          </cdf-form-field>
          <cdf-form-field
            [label]="'admin.exercise.timeLimit' | translate"
            [help]="'admin.exercise.timeLimitHelp' | translate"
            controlId="ex-time"
          >
            <cdf-input
              inputId="ex-time"
              type="number"
              [(ngModel)]="f.timeLimitMs"
              (ngModelChange)="touch()"
            />
          </cdf-form-field>
          <cdf-form-field
            [label]="'admin.exercise.memoryLimit' | translate"
            [help]="'admin.exercise.memoryLimitHelp' | translate"
            controlId="ex-memory"
          >
            <cdf-input
              inputId="ex-memory"
              type="number"
              [(ngModel)]="f.memoryLimitKb"
              (ngModelChange)="touch()"
            />
          </cdf-form-field>
        </div>
      </section>

      <div class="code-grid">
        <section class="admin-card">
          <h2 id="ex-starter-label">
            {{ 'admin.exercise.starter' | translate }}
          </h2>
          <cdf-code-editor
            [language]="f.language"
            [ariaLabel]="'admin.exercise.starter' | translate"
            [(ngModel)]="f.starterCode"
            (ngModelChange)="touch()"
          />
        </section>
        <section class="admin-card">
          <h2>{{ 'admin.exercise.solution' | translate }}</h2>
          <cdf-code-editor
            [language]="f.language"
            [ariaLabel]="'admin.exercise.solution' | translate"
            [(ngModel)]="f.solutionCode"
            (ngModelChange)="touch()"
          />
        </section>
        <section class="admin-card">
          <h2>{{ 'admin.exercise.visibleTests' | translate }}</h2>
          <cdf-code-editor
            language="json"
            [height]="200"
            [invalid]="!!fieldErrors()['visibleTests']"
            [ariaLabel]="'admin.exercise.visibleTests' | translate"
            [(ngModel)]="f.visibleTests"
            (ngModelChange)="touch()"
          />
          @if (fieldErrors()['visibleTests']; as e) {
            <p class="form-error" role="alert">{{ e }}</p>
          }
        </section>
        <section class="admin-card">
          <h2>{{ 'admin.exercise.hiddenTests' | translate }}</h2>
          <cdf-code-editor
            language="json"
            [height]="200"
            [invalid]="!!fieldErrors()['hiddenTests']"
            [ariaLabel]="'admin.exercise.hiddenTests' | translate"
            [(ngModel)]="f.hiddenTests"
            (ngModelChange)="touch()"
          />
          @if (fieldErrors()['hiddenTests']; as e) {
            <p class="form-error" role="alert">{{ e }}</p>
          }
        </section>
        <section class="admin-card span-all">
          <h2>{{ 'admin.exercise.harness' | translate }}</h2>
          <p class="muted small">
            {{ 'admin.exercise.harnessHelp' | translate }}
          </p>
          <cdf-code-editor
            [language]="f.language"
            [height]="160"
            [ariaLabel]="'admin.exercise.harness' | translate"
            [(ngModel)]="f.testHarness"
            (ngModelChange)="touch()"
          />
        </section>
      </div>

      @if (verifyResult(); as r) {
        <section
          class="admin-card"
          aria-live="polite"
          data-testid="verify-result"
        >
          <header class="section-head">
            <h2>{{ 'admin.exercise.verifyResult' | translate }}</h2>
            <cdf-badge [variant]="r.ok ? 'success' : 'danger'">
              {{
                (r.ok
                  ? 'admin.exercise.verifyPass'
                  : 'admin.exercise.verifyFail'
                ) | translate: { pct: r.scorePct, verdict: r.verdict }
              }}
            </cdf-badge>
          </header>
          @if (r.message) {
            <pre class="diag">{{ r.message }}</pre>
          }
          <div class="table-scroll">
            <table class="admin-table">
              <caption class="visually-hidden">
                {{
                  'admin.exercise.verifyResult' | translate
                }}
              </caption>
              <thead>
                <tr>
                  <th scope="col">
                    {{ 'admin.exercise.cols.test' | translate }}
                  </th>
                  <th scope="col">
                    {{ 'admin.exercise.cols.result' | translate }}
                  </th>
                  <th scope="col">
                    {{ 'admin.exercise.cols.expected' | translate }}
                  </th>
                  <th scope="col">
                    {{ 'admin.exercise.cols.actual' | translate }}
                  </th>
                  <th scope="col" class="num">
                    {{ 'admin.exercise.cols.time' | translate }}
                  </th>
                </tr>
              </thead>
              <tbody>
                @for (t of r.results; track t.id) {
                  <tr>
                    <td>
                      {{ t.name }}
                      @if (t.hidden) {
                        <cdf-badge variant="neutral" [subtle]="true">{{
                          'admin.exercise.hidden' | translate
                        }}</cdf-badge>
                      }
                    </td>
                    <td>
                      <cdf-badge
                        [variant]="t.passed ? 'success' : 'danger'"
                        [subtle]="true"
                      >
                        {{
                          (t.passed
                            ? 'admin.exercise.passed'
                            : 'admin.exercise.failed'
                          ) | translate
                        }}
                      </cdf-badge>
                      @if (t.error) {
                        <div class="small text-danger">{{ t.error }}</div>
                      }
                    </td>
                    <td>
                      <code>{{ show(t.expected) }}</code>
                    </td>
                    <td>
                      <code>{{ show(t.actual) }}</code>
                    </td>
                    <td class="num">{{ t.runtimeMs ?? '—' }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
          @if (r.stdout) {
            <h3 class="small">{{ 'admin.exercise.stdout' | translate }}</h3>
            <pre class="diag">{{ r.stdout }}</pre>
          }
        </section>
      }
    </div>
  `,
  styles: [
    `
      .code-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(420px, 1fr));
        gap: 0 var(--cdf-space-4);
      }
      @media (max-width: 900px) {
        .code-grid {
          grid-template-columns: minmax(0, 1fr);
        }
      }
      .diag {
        background: var(--cdf-color-bg);
        border: 1px solid var(--cdf-color-border);
        border-radius: var(--cdf-radius-sm);
        padding: 8px;
        max-height: 200px;
        overflow: auto;
        font-size: 12px;
        white-space: pre-wrap;
      }
    `,
  ],
})
export class ExerciseEditorPage implements HasUnsavedChanges {
  private readonly route = inject(ActivatedRoute);
  private readonly client = inject(ExercisesClient);
  private readonly lessons = inject(LessonsClient);
  private readonly toast = inject(ToastService);
  private readonly errorsSvc = inject(AdminErrors);
  private readonly i18n = inject(I18nService);

  protected readonly languageOptions: SelectOption<ExerciseLanguage>[] =
    LANGUAGES.map((l) => ({ value: l, label: LANGUAGE_LABEL[l] }));
  protected readonly lessonId = signal('');
  protected readonly lessonTitle = signal<string | null>(null);
  protected readonly exerciseId = signal<string | null>(null);
  protected readonly saving = signal(false);
  protected readonly verifying = signal(false);
  protected readonly dirty = signal(false);
  protected readonly formError = signal<string | null>(null);
  protected readonly fieldErrors = signal<Record<string, string | undefined>>(
    {},
  );
  protected readonly verifyResult = signal<
    (RunResult & { ok: boolean }) | null
  >(null);

  protected f: ExerciseForm = {
    language: 'javascript',
    entryFunction: 'solution',
    starterCode: STARTERS.javascript.starter,
    solutionCode: STARTERS.javascript.solution,
    testHarness: '',
    visibleTests: JSON.stringify(SAMPLE_VISIBLE, null, 2),
    hiddenTests: JSON.stringify(SAMPLE_HIDDEN, null, 2),
    timeLimitMs: 2000,
    memoryLimitKb: 65536,
  };

  protected readonly crumbs = computed<BreadcrumbCrumb[]>(() => {
    this.i18n.currentLocale();
    return [
      { label: this.i18n.t('admin.nav.courses'), routerLink: ['/courses'] },
      {
        label: this.lessonTitle() ?? this.i18n.t('admin.lesson.lesson'),
        routerLink: ['/lessons', this.lessonId()],
      },
      { label: this.i18n.t('admin.exercise.title') },
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
      const [lesson, ex] = await Promise.all([
        this.lessons.detail(lessonId),
        this.client.getAdminByLesson(lessonId),
      ]);
      this.lessonTitle.set(lesson.title);
      if (ex) {
        this.exerciseId.set(ex.id);
        this.f = {
          language: ex.language,
          entryFunction: ex.entryFunction,
          starterCode: ex.starterCode,
          solutionCode: ex.solutionCode,
          testHarness: ex.testHarness ?? '',
          visibleTests: JSON.stringify(ex.visibleTestsJson, null, 2),
          hiddenTests: JSON.stringify(ex.hiddenTestsJson, null, 2),
          timeLimitMs: ex.timeLimitMs,
          memoryLimitKb: ex.memoryLimitKb,
        };
      }
      this.dirty.set(false);
    } catch (err) {
      this.errorsSvc.toast(err, 'admin.errors.loadFailed');
    }
  }

  protected touch(): void {
    this.dirty.set(true);
  }

  /** Switching language swaps untouched sample code for that language's. */
  protected onLanguage(lang: ExerciseLanguage | null): void {
    if (!lang || lang === this.f.language) return;
    const prev = STARTERS[this.f.language];
    const next = STARTERS[lang];
    this.f = {
      ...this.f,
      language: lang,
      starterCode:
        this.f.starterCode === prev.starter ? next.starter : this.f.starterCode,
      solutionCode:
        this.f.solutionCode === prev.solution
          ? next.solution
          : this.f.solutionCode,
    };
    this.touch();
  }

  private buildBody(): CreateExerciseBody | null {
    const errs: Record<string, string> = {};
    const visible = parseTests(this.f.visibleTests);
    const hidden = parseTests(this.f.hiddenTests);
    if (!visible.ok)
      errs['visibleTests'] = this.describeProblem(visible.problem);
    if (!hidden.ok) errs['hiddenTests'] = this.describeProblem(hidden.problem);
    if (!/^[A-Za-z_$][\w$]*$/.test(this.f.entryFunction.trim()))
      errs['entryFunction'] = this.i18n.t('admin.exercise.invalidEntry');
    this.fieldErrors.set(errs);
    if (!visible.ok || !hidden.ok || Object.keys(errs).length) return null;
    return {
      language: this.f.language,
      entryFunction: this.f.entryFunction.trim(),
      starterCode: this.f.starterCode,
      solutionCode: this.f.solutionCode,
      visibleTests: visible.tests,
      hiddenTests: hidden.tests,
      timeLimitMs: Math.round(Number(this.f.timeLimitMs) || 2000),
      memoryLimitKb: Math.round(Number(this.f.memoryLimitKb) || 65536),
      testHarness: this.f.testHarness,
    };
  }

  protected async save(): Promise<boolean> {
    this.formError.set(null);
    const body = this.buildBody();
    if (!body) return false;
    this.saving.set(true);
    try {
      const id = this.exerciseId();
      const ex = id
        ? await this.client.update(id, body)
        : await this.client.create(this.lessonId(), body);
      this.exerciseId.set(ex.id);
      this.dirty.set(false);
      this.toast.success(this.i18n.t('admin.exercise.saved'));
      return true;
    } catch (err) {
      this.formError.set(
        this.errorsSvc.message(err, 'admin.errors.saveFailed'),
      );
      return false;
    } finally {
      this.saving.set(false);
    }
  }

  protected async verify(): Promise<void> {
    if (this.dirty() || !this.exerciseId()) {
      if (!(await this.save())) return;
    }
    const id = this.exerciseId();
    if (!id) return;
    this.verifying.set(true);
    this.verifyResult.set(null);
    try {
      this.verifyResult.set(await this.client.verify(id));
    } catch (err) {
      this.errorsSvc.toast(err, 'admin.exercise.verifyError');
    } finally {
      this.verifying.set(false);
    }
  }

  private describeProblem(p: TestsProblem): string {
    if (p.kind === 'json')
      return this.i18n.t('admin.common.invalidJson', { message: p.detail });
    if (p.kind === 'notArray')
      return this.i18n.t('admin.exercise.testsNotArray');
    return this.i18n.t(`admin.exercise.testProblem.${p.kind}`, { n: p.index });
  }

  protected show(v: unknown): string {
    if (v === undefined) return '—';
    try {
      return JSON.stringify(v);
    } catch {
      return String(v);
    }
  }
}

const LANGUAGE_LABEL: Record<ExerciseLanguage, string> = {
  javascript: 'JavaScript',
  typescript: 'TypeScript',
  python: 'Python',
};
