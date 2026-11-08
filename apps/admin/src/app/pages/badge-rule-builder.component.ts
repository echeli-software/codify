import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  model,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { I18nService, TranslatePipe } from '@codify/i18n';
import {
  Button,
  Icon,
  IconButton,
  Select,
  type SelectOption,
} from '@codify/ui-bootstrap';
import { AdminCatalogClient } from '@codify/api-client';
import { AdminErrors } from '../core/errors';
import {
  DEFAULT_BADGE_EVENTS,
  DEFAULT_BADGE_METRICS,
  RULE_OPS,
  buildRule,
  parseRule,
  parseRuleText,
  type RuleBuilderState,
  type RuleClauseRow,
  type RuleOp,
} from '../core/badge-rule';

/**
 * Badge rule helper builder (docs/04 Badges): edit the common rule shapes
 * as rows — all / any of "event happened N times" and "metric ≥ N" — while
 * the raw JSON (`rule`, two-way) stays the source of truth and the
 * advanced view. "Check" runs the API's DSL validator.
 */
@Component({
  selector: 'cdf-badge-rule-builder',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, Button, Icon, IconButton, Select, TranslatePipe],
  template: `
    <div class="rb-head">
      <span class="form-label">{{
        'admin.gamification.badges.rule' | translate
      }}</span>
      <div
        class="view-toggle"
        role="radiogroup"
        [attr.aria-label]="'admin.badgeRule.view' | translate"
      >
        <button
          type="button"
          role="radio"
          [attr.aria-checked]="mode() === 'builder'"
          [class.active]="mode() === 'builder'"
          (click)="setMode('builder')"
          data-testid="rule-mode-builder"
        >
          {{ 'admin.badgeRule.builder' | translate }}
        </button>
        <button
          type="button"
          role="radio"
          [attr.aria-checked]="mode() === 'json'"
          [class.active]="mode() === 'json'"
          (click)="setMode('json')"
          data-testid="rule-mode-json"
        >
          {{ 'admin.badgeRule.json' | translate }}
        </button>
      </div>
    </div>

    @if (mode() === 'builder') {
      @if (state(); as st) {
        <div class="rb" data-testid="rule-builder">
          <label class="small" for="rb-comb">{{
            'admin.badgeRule.unlockWhen' | translate
          }}</label>
          <cdf-select
            inputId="rb-comb"
            size="sm"
            [options]="combinatorOptions()"
            [ngModel]="st.combinator"
            (ngModelChange)="update({ combinator: $event })"
          />
          <ul class="plain-list">
            @for (c of st.clauses; track $index; let i = $index) {
              <li class="clause">
                <cdf-select
                  size="sm"
                  [options]="typeOptions()"
                  [ngModel]="c.type"
                  (ngModelChange)="
                    setClause(i, { type: $event, name: firstName($event) })
                  "
                  [ariaLabel]="'admin.badgeRule.type' | translate"
                />
                <cdf-select
                  size="sm"
                  [options]="
                    c.type === 'event' ? eventOptions() : metricOptions()
                  "
                  [ngModel]="c.name"
                  (ngModelChange)="setClause(i, { name: $event })"
                  [ariaLabel]="
                    (c.type === 'event'
                      ? 'admin.badgeRule.event'
                      : 'admin.badgeRule.metric'
                    ) | translate
                  "
                />
                <cdf-select
                  size="sm"
                  [options]="opOptions()"
                  [ngModel]="c.op"
                  (ngModelChange)="setClause(i, { op: $event })"
                  [ariaLabel]="'admin.badgeRule.op' | translate"
                />
                <input
                  class="form-control form-control-sm value"
                  type="number"
                  min="0"
                  [attr.aria-label]="'admin.badgeRule.value' | translate"
                  [ngModel]="c.value"
                  (ngModelChange)="setClause(i, { value: +$event })"
                />
                <cdf-icon-button
                  icon="trash"
                  size="sm"
                  kind="ghost"
                  [ariaLabel]="'admin.badgeRule.remove' | translate"
                  (click)="removeClause(i)"
                />
              </li>
            } @empty {
              <li class="muted small">
                {{ 'admin.badgeRule.noClauses' | translate }}
              </li>
            }
          </ul>
          <cdf-button
            kind="ghost"
            size="sm"
            (click)="addClause()"
            data-testid="rule-add-clause"
          >
            <cdf-icon name="plus" size="sm" />
            {{ 'admin.badgeRule.add' | translate }}
          </cdf-button>
        </div>
      } @else {
        <p class="muted small" role="status">
          {{ 'admin.badgeRule.advancedOnly' | translate }}
        </p>
      }
    } @else {
      <textarea
        id="b-rule"
        class="form-control mono"
        rows="8"
        spellcheck="false"
        [ngModel]="rule()"
        (ngModelChange)="rule.set($event)"
        [attr.aria-label]="'admin.gamification.badges.rule' | translate"
        aria-describedby="b-rule-help"
      ></textarea>
    }
    <p class="muted small" id="b-rule-help">
      {{ 'admin.gamification.badges.ruleHelp' | translate }}
    </p>

    <div class="rb-check">
      <cdf-button
        kind="secondary"
        size="sm"
        [loading]="checking()"
        (click)="check()"
        data-testid="rule-check"
      >
        {{ 'admin.badgeRule.check' | translate }}
      </cdf-button>
      @if (checkResult(); as r) {
        @if (r.valid) {
          <span class="ok small" role="status">{{
            'admin.badgeRule.valid' | translate
          }}</span>
        } @else {
          <ul class="issue-list" role="alert">
            @for (p of r.problems; track $index) {
              <li>{{ p }}</li>
            }
          </ul>
        }
      }
    </div>
  `,
  styles: [
    `
      .rb-head,
      .rb-check {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: var(--cdf-space-2);
        margin-bottom: var(--cdf-space-2);
      }
      .rb-check {
        justify-content: flex-start;
      }
      .rb {
        display: flex;
        flex-direction: column;
        gap: var(--cdf-space-2);
        padding: var(--cdf-space-3);
        border: 1px solid var(--cdf-color-border);
        border-radius: var(--cdf-radius-sm);
      }
      .clause {
        display: grid;
        grid-template-columns: 110px minmax(0, 1fr) 70px 80px auto;
        gap: var(--cdf-space-2);
        align-items: center;
        padding: 4px 0;
      }
      @media (max-width: 599.98px) {
        .clause {
          grid-template-columns: 1fr 1fr;
        }
      }
      .ok {
        color: var(--cdf-color-success-text);
        font-weight: 600;
      }
      .view-toggle {
        display: inline-flex;
        border: 1px solid var(--cdf-color-border);
        border-radius: var(--cdf-radius-md);
        overflow: hidden;
        button {
          border: 0;
          background: var(--cdf-color-surface);
          color: var(--cdf-color-text);
          padding: 2px 10px;
          font-size: var(--cdf-font-size-sm);
        }
        button.active {
          background: var(--cdf-color-primary);
          color: var(--cdf-color-primary-on);
        }
      }
    `,
  ],
})
export class BadgeRuleBuilder implements OnInit {
  private readonly client = inject(AdminCatalogClient);
  private readonly errors = inject(AdminErrors);
  private readonly i18n = inject(I18nService);

  /** The rule as JSON text (the badge form's `rule` field). */
  readonly rule = model.required<string>();

  protected readonly mode = signal<'builder' | 'json'>('builder');
  protected readonly events = signal<string[]>(DEFAULT_BADGE_EVENTS);
  protected readonly metrics = signal<string[]>(DEFAULT_BADGE_METRICS);
  protected readonly checking = signal(false);
  protected readonly checkResult = signal<{
    valid: boolean;
    problems: string[];
  } | null>(null);

  /** Builder rows for the current JSON, or null when it needs the JSON view. */
  protected readonly state = computed<RuleBuilderState | null>(() =>
    parseRule(parseRuleText(this.rule())),
  );

  protected readonly combinatorOptions = computed<
    SelectOption<'all' | 'any'>[]
  >(() => {
    this.i18n.currentLocale();
    return [
      { value: 'all', label: this.i18n.t('admin.badgeRule.all') },
      { value: 'any', label: this.i18n.t('admin.badgeRule.any') },
    ];
  });
  protected readonly typeOptions = computed<SelectOption<'event' | 'metric'>[]>(
    () => {
      this.i18n.currentLocale();
      return [
        { value: 'event', label: this.i18n.t('admin.badgeRule.typeEvent') },
        { value: 'metric', label: this.i18n.t('admin.badgeRule.typeMetric') },
      ];
    },
  );
  protected readonly opOptions = computed<SelectOption<RuleOp>[]>(() =>
    RULE_OPS.map((op) => ({
      value: op,
      label: { gte: '≥', gt: '>', eq: '=', lte: '≤', lt: '<' }[op],
    })),
  );
  protected readonly eventOptions = computed<SelectOption<string>[]>(() =>
    this.events().map((e) => ({ value: e, label: e })),
  );
  protected readonly metricOptions = computed<SelectOption<string>[]>(() =>
    this.metrics().map((m) => ({ value: m, label: m })),
  );

  ngOnInit(): void {
    if (!this.state()) this.mode.set('json');
    // The validator also returns the event + metric names it accepts.
    void this.client
      .validateBadgeRule({ all: [] })
      .then((r) => {
        if (r.events?.length) this.events.set(r.events);
        if (r.metrics?.length) this.metrics.set(r.metrics);
      })
      .catch(() => undefined);
  }

  protected setMode(m: 'builder' | 'json'): void {
    this.mode.set(m);
  }

  protected firstName(type: 'event' | 'metric'): string {
    return (type === 'event' ? this.events() : this.metrics())[0] ?? '';
  }

  protected update(patch: Partial<RuleBuilderState>): void {
    const st = this.state();
    if (!st) return;
    this.write({ ...st, ...patch });
  }

  protected setClause(i: number, patch: Partial<RuleClauseRow>): void {
    const st = this.state();
    if (!st) return;
    this.write({
      ...st,
      clauses: st.clauses.map((c, j) => (j === i ? { ...c, ...patch } : c)),
    });
  }

  protected addClause(): void {
    const st = this.state() ?? { combinator: 'all' as const, clauses: [] };
    this.write({
      ...st,
      clauses: [
        ...st.clauses,
        { type: 'event', name: this.firstName('event'), op: 'gte', value: 1 },
      ],
    });
  }

  protected removeClause(i: number): void {
    const st = this.state();
    if (!st) return;
    this.write({ ...st, clauses: st.clauses.filter((_, j) => j !== i) });
  }

  private write(st: RuleBuilderState): void {
    this.checkResult.set(null);
    this.rule.set(JSON.stringify(buildRule(st), null, 2));
  }

  protected async check(): Promise<void> {
    const parsed = parseRuleText(this.rule());
    if (parsed === null) {
      this.checkResult.set({
        valid: false,
        problems: [this.i18n.t('admin.badgeRule.notJson')],
      });
      return;
    }
    this.checking.set(true);
    try {
      const r = await this.client.validateBadgeRule(parsed);
      this.checkResult.set({ valid: r.valid, problems: r.problems });
    } catch (err) {
      this.checkResult.set({
        valid: false,
        problems: [this.errors.message(err, 'admin.errors.generic')],
      });
    } finally {
      this.checking.set(false);
    }
  }
}
