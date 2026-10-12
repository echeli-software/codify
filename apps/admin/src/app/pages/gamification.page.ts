import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { I18nService, LocalePipe, TranslatePipe } from '@codify/i18n';
import {
  Badge,
  Button,
  ConfirmDialogService,
  Drawer,
  FormField,
  Icon,
  IconButton,
  Input,
  Select,
  type SelectOption,
  Skeleton,
  ToastService,
  Toggle,
} from '@codify/ui-bootstrap';
import {
  GamificationClient,
  ItemsClient,
  LeaguesClient,
  OpsClient,
  ReferralsClient,
  toProblemDetails,
  type BadgeDef,
  type GamificationConfigEntry,
  type GamificationConfigKey,
  type GamificationConfigPatch,
  type LedgerDriftReport,
  type QuestKind,
  type QuestTemplate,
  type RolloverSummary,
} from '@codify/api-client';
import { AdminErrors } from '../core/errors';
import { SLUG_PATTERN } from '../core/catalog';

type Tab = 'defaults' | 'badges' | 'quests' | 'operations';
const TABS: readonly Tab[] = ['defaults', 'badges', 'quests', 'operations'];
const QUEST_KINDS: readonly QuestKind[] = [
  'LESSON_COUNT',
  'CATEGORY_LESSON_COUNT',
  'XP_AMOUNT',
  'STREAK_MAINTAIN',
  'EXERCISE_PASS',
];

type QuestTemplateRow = QuestTemplate;

/** How a config value is edited: one number, a flat object of numbers, or JSON. */
export type ConfigShape =
  | { kind: 'number' }
  | { kind: 'fields'; fields: string[] }
  | { kind: 'json' };

export function configShape(value: unknown): ConfigShape {
  if (typeof value === 'number') return { kind: 'number' };
  if (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.values(value).every((v) => typeof v === 'number')
  )
    return { kind: 'fields', fields: Object.keys(value) };
  return { kind: 'json' };
}

interface ConfigRow {
  entry: GamificationConfigEntry;
  shape: ConfigShape;
  num: number | null;
  fields: Record<string, number>;
  json: string;
  error: string | null;
}

interface BadgeForm {
  id: string | null;
  slug: string;
  name: string;
  description: string;
  iconName: string;
  rule: string;
  xpReward: number;
  coinReward: number;
  isHidden: boolean;
  isActive: boolean;
}

interface QuestForm {
  id: string | null;
  slug: string;
  title: string;
  kind: QuestKind;
  difficulty: number;
  weight: number;
  target: number;
  categorySlug: string;
  xpReward: number;
  coinReward: number;
  isActive: boolean;
}

const DEFAULT_RULE = JSON.stringify(
  { all: [{ event: 'lesson_complete', count: { gte: 1 } }] },
  null,
  2,
);

/**
 * Gamification (ADMIN, docs/07): defaults panel over GET/PUT
 * /admin/gamification/config with per-key reset, badge and quest template
 * editors (rule JSON validation, picker weight), and operations — league
 * rollover, referral rewards, limited-drop announcements and the coin
 * ledger drift check. Multipliers live on the Promotions page.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    Badge,
    Button,
    Drawer,
    FormField,
    Icon,
    IconButton,
    Input,
    Select,
    Skeleton,
    Toggle,
    TranslatePipe,
    LocalePipe,
  ],
  template: `
    <div class="admin-page">
      <header class="page-head">
        <div>
          <h1>{{ 'admin.gamification.title' | translate }}</h1>
          <p class="muted">{{ 'admin.gamification.subtitle' | translate }}</p>
        </div>
      </header>

      <div class="tabs" role="tablist">
        @for (t of tabs; track t) {
          <button
            type="button"
            role="tab"
            [id]="'gtab-' + t"
            [attr.aria-selected]="tab() === t"
            [attr.aria-controls]="'gpanel-' + t"
            (click)="tab.set(t)"
          >
            {{ 'admin.gamification.tabs.' + t | translate }}
          </button>
        }
      </div>

      @switch (tab()) {
        @case ('defaults') {
          <section
            id="gpanel-defaults"
            role="tabpanel"
            aria-labelledby="gtab-defaults"
            class="admin-card"
          >
            <header class="section-head">
              <h2>{{ 'admin.gamification.defaults.title' | translate }}</h2>
              <cdf-button
                kind="primary"
                size="sm"
                [loading]="busy() === 'config'"
                (click)="saveConfig()"
              >
                {{ 'admin.common.saveChanges' | translate }}
              </cdf-button>
            </header>
            @if (config() === null) {
              <cdf-skeleton shape="rect" height="200px" />
            } @else {
              <ul class="plain-list config-list">
                @for (row of config(); track row.entry.key) {
                  <li class="config-row">
                    <div class="config-row__head">
                      <strong>{{
                        'admin.gamification.config.' + row.entry.key | translate
                      }}</strong>
                      <code class="muted">{{ row.entry.key }}</code>
                      @if (row.entry.isDefault) {
                        <cdf-badge variant="neutral" [subtle]="true">{{
                          'admin.gamification.defaults.default' | translate
                        }}</cdf-badge>
                      } @else {
                        <cdf-badge variant="info" [subtle]="true">{{
                          'admin.gamification.defaults.overridden' | translate
                        }}</cdf-badge>
                        <cdf-button
                          kind="link"
                          size="sm"
                          (click)="resetKey(row.entry.key)"
                        >
                          {{ 'admin.gamification.defaults.reset' | translate }}
                        </cdf-button>
                      }
                    </div>
                    @switch (row.shape.kind) {
                      @case ('number') {
                        <cdf-input
                          type="number"
                          [ariaLabel]="
                            'admin.gamification.config.' + row.entry.key
                              | translate
                          "
                          [(ngModel)]="row.num"
                        />
                      }
                      @case ('fields') {
                        <div class="form-grid">
                          @for (f of fieldNames(row); track f) {
                            <cdf-form-field
                              [label]="
                                'admin.gamification.rewardFields.' + f
                                  | translate
                              "
                              [controlId]="row.entry.key + '-' + f"
                            >
                              <cdf-input
                                [inputId]="row.entry.key + '-' + f"
                                type="number"
                                [(ngModel)]="row.fields[f]"
                              />
                            </cdf-form-field>
                          }
                        </div>
                      }
                      @default {
                        <textarea
                          class="form-control mono"
                          rows="5"
                          [attr.aria-label]="
                            'admin.gamification.config.' + row.entry.key
                              | translate
                          "
                          [(ngModel)]="row.json"
                        ></textarea>
                      }
                    }
                    <p class="muted small">
                      {{
                        'admin.gamification.defaults.defaultValue'
                          | translate: { value: show(row.entry.defaultValue) }
                      }}
                    </p>
                    @if (row.error) {
                      <p class="form-error" role="alert">{{ row.error }}</p>
                    }
                  </li>
                }
              </ul>
            }
          </section>
        }
        @case ('badges') {
          <section
            id="gpanel-badges"
            role="tabpanel"
            aria-labelledby="gtab-badges"
            class="admin-card"
          >
            <header class="section-head">
              <h2>{{ 'admin.gamification.badges.title' | translate }}</h2>
              <cdf-button kind="primary" size="sm" (click)="editBadge(null)">
                <cdf-icon name="plus" size="sm" />
                {{ 'admin.gamification.badges.new' | translate }}
              </cdf-button>
            </header>
            <div class="table-scroll">
              <table class="admin-table">
                <thead>
                  <tr>
                    <th scope="col">{{ 'admin.common.name' | translate }}</th>
                    <th scope="col">
                      {{ 'admin.gamification.badges.rule' | translate }}
                    </th>
                    <th scope="col" class="num">
                      {{ 'admin.gamification.rewards' | translate }}
                    </th>
                    <th scope="col">
                      <span class="visually-hidden">{{
                        'admin.common.actions' | translate
                      }}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  @for (b of badges(); track b.id) {
                    <tr>
                      <td>
                        <strong>{{ b.name }}</strong>
                        <div class="mono muted">{{ b.slug }}</div>
                        <span class="chip-row">
                          @if (b.isHidden) {
                            <cdf-badge variant="neutral" [subtle]="true">{{
                              'admin.gamification.badges.hidden' | translate
                            }}</cdf-badge>
                          }
                          @if (!b.isActive) {
                            <cdf-badge variant="warning" [subtle]="true">{{
                              'admin.common.inactive' | translate
                            }}</cdf-badge>
                          }
                        </span>
                      </td>
                      <td>
                        <code class="rule">{{ show(b.rule) }}</code>
                      </td>
                      <td class="num">
                        {{
                          'admin.gamification.rewardShort'
                            | translate: { xp: b.xpReward, coins: b.coinReward }
                        }}
                      </td>
                      <td>
                        <div class="row-actions">
                          <cdf-button
                            kind="ghost"
                            size="sm"
                            (click)="editBadge(b)"
                            >{{ 'admin.common.edit' | translate }}</cdf-button
                          >
                          <cdf-icon-button
                            icon="trash"
                            size="sm"
                            kind="danger"
                            [ariaLabel]="
                              'admin.gamification.deleteAria'
                                | translate: { name: b.name }
                            "
                            (click)="deleteBadge(b)"
                          />
                        </div>
                      </td>
                    </tr>
                  } @empty {
                    <tr>
                      <td colspan="4" class="muted small">
                        {{ 'admin.gamification.badges.empty' | translate }}
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </section>
        }
        @case ('quests') {
          <section
            id="gpanel-quests"
            role="tabpanel"
            aria-labelledby="gtab-quests"
            class="admin-card"
          >
            <header class="section-head">
              <h2>{{ 'admin.gamification.quests.title' | translate }}</h2>
              <cdf-button kind="primary" size="sm" (click)="editQuest(null)">
                <cdf-icon name="plus" size="sm" />
                {{ 'admin.gamification.quests.new' | translate }}
              </cdf-button>
            </header>
            <p class="muted small">
              {{ 'admin.gamification.quests.help' | translate }}
            </p>
            <div class="table-scroll">
              <table class="admin-table">
                <thead>
                  <tr>
                    <th scope="col">
                      {{ 'admin.gamification.quests.quest' | translate }}
                    </th>
                    <th scope="col">
                      {{ 'admin.gamification.quests.kind' | translate }}
                    </th>
                    <th scope="col" class="num">
                      {{ 'admin.gamification.quests.target' | translate }}
                    </th>
                    <th scope="col" class="num">
                      {{ 'admin.gamification.quests.difficulty' | translate }}
                    </th>
                    <th scope="col" class="num">
                      {{ 'admin.gamification.quests.weight' | translate }}
                    </th>
                    <th scope="col" class="num">
                      {{ 'admin.gamification.rewards' | translate }}
                    </th>
                    <th scope="col">
                      <span class="visually-hidden">{{
                        'admin.common.actions' | translate
                      }}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  @for (q of quests(); track q.id) {
                    <tr>
                      <td>
                        <strong>{{ q.title }}</strong>
                        <div class="mono muted">{{ q.slug }}</div>
                        @if (!q.isActive) {
                          <cdf-badge variant="warning" [subtle]="true">{{
                            'admin.common.inactive' | translate
                          }}</cdf-badge>
                        }
                      </td>
                      <td>
                        {{
                          'admin.gamification.questKinds.' + q.kind | translate
                        }}
                      </td>
                      <td class="num">{{ q.target }}</td>
                      <td class="num">
                        {{
                          'admin.gamification.difficulties.' + q.difficulty
                            | translate
                        }}
                      </td>
                      <td class="num">{{ q.weight ?? 1 }}</td>
                      <td class="num">
                        {{
                          'admin.gamification.rewardShort'
                            | translate: { xp: q.xpReward, coins: q.coinReward }
                        }}
                      </td>
                      <td>
                        <div class="row-actions">
                          <cdf-button
                            kind="ghost"
                            size="sm"
                            (click)="editQuest(q)"
                            >{{ 'admin.common.edit' | translate }}</cdf-button
                          >
                          <cdf-icon-button
                            icon="trash"
                            size="sm"
                            kind="danger"
                            [ariaLabel]="
                              'admin.gamification.deleteAria'
                                | translate: { name: q.title }
                            "
                            (click)="deleteQuest(q)"
                          />
                        </div>
                      </td>
                    </tr>
                  } @empty {
                    <tr>
                      <td colspan="7" class="muted small">
                        {{ 'admin.gamification.quests.empty' | translate }}
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </section>
        }
        @case ('operations') {
          <section
            id="gpanel-operations"
            role="tabpanel"
            aria-labelledby="gtab-operations"
          >
            <div class="ops-grid">
              <div class="admin-card">
                <h2>{{ 'admin.gamification.ops.rollover' | translate }}</h2>
                <p class="muted small">
                  {{ 'admin.gamification.ops.rolloverHelp' | translate }}
                </p>
                <cdf-button
                  kind="secondary"
                  [loading]="busy() === 'rollover'"
                  (click)="rollover()"
                >
                  {{ 'admin.gamification.ops.runNow' | translate }}
                </cdf-button>
                @if (rolloverResult(); as r) {
                  <p class="small result" role="status">
                    {{ 'admin.gamification.ops.rolloverResult' | translate: r }}
                  </p>
                }
              </div>
              <div class="admin-card">
                <h2>{{ 'admin.gamification.ops.referrals' | translate }}</h2>
                <p class="muted small">
                  {{ 'admin.gamification.ops.referralsHelp' | translate }}
                </p>
                <cdf-button
                  kind="secondary"
                  [loading]="busy() === 'referrals'"
                  (click)="runReferrals()"
                >
                  {{ 'admin.gamification.ops.runNow' | translate }}
                </cdf-button>
                @if (referralResult(); as r) {
                  <p class="small result" role="status">
                    {{
                      'admin.gamification.ops.referralsResult' | translate: r
                    }}
                  </p>
                }
              </div>
              <div class="admin-card">
                <h2>{{ 'admin.gamification.ops.drops' | translate }}</h2>
                <p class="muted small">
                  {{ 'admin.gamification.ops.dropsHelp' | translate }}
                </p>
                <cdf-button
                  kind="secondary"
                  [loading]="busy() === 'drops'"
                  (click)="announceDrops()"
                >
                  {{ 'admin.gamification.ops.announce' | translate }}
                </cdf-button>
                @if (dropsResult(); as r) {
                  <p class="small result" role="status">
                    {{ 'admin.gamification.ops.dropsResult' | translate: r }}
                  </p>
                }
              </div>
              <div class="admin-card drift">
                <h2>{{ 'admin.gamification.ops.drift' | translate }}</h2>
                <p class="muted small">
                  {{ 'admin.gamification.ops.driftHelp' | translate }}
                </p>
                <cdf-button
                  kind="secondary"
                  [loading]="busy() === 'drift'"
                  (click)="runDrift()"
                  data-testid="run-drift"
                >
                  {{ 'admin.gamification.ops.runCheck' | translate }}
                </cdf-button>
                @if (drift(); as d) {
                  <div class="result" role="status" data-testid="drift-report">
                    <p class="chip-row">
                      <cdf-badge
                        [variant]="d.mismatchCount === 0 ? 'success' : 'danger'"
                        >{{
                          'admin.gamification.ops.mismatches'
                            | translate: { count: d.mismatchCount }
                        }}</cdf-badge
                      >
                      <span class="small muted">{{
                        'admin.gamification.ops.driftMeta'
                          | translate
                            : {
                                users: d.usersChecked,
                                ms: d.durationMs,
                                trigger:
                                  ('admin.gamification.ops.triggers.' +
                                    d.trigger | translate),
                              }
                      }}</span>
                    </p>
                    <p class="small muted">
                      {{ d.finishedAt | locale: 'datetime' }}
                    </p>
                    @if (d.mismatches.length > 0) {
                      <table class="admin-table">
                        <thead>
                          <tr>
                            <th scope="col">
                              {{ 'admin.gamification.ops.user' | translate }}
                            </th>
                            <th scope="col" class="num">
                              {{ 'admin.gamification.ops.cached' | translate }}
                            </th>
                            <th scope="col" class="num">
                              {{
                                'admin.gamification.ops.ledgerSum' | translate
                              }}
                            </th>
                            <th scope="col" class="num">
                              {{ 'admin.gamification.ops.latest' | translate }}
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          @for (
                            m of d.mismatches.slice(0, 50);
                            track m.userId
                          ) {
                            <tr>
                              <td class="mono">{{ m.userId }}</td>
                              <td class="num">{{ m.coins }}</td>
                              <td class="num">{{ m.sumDelta }}</td>
                              <td class="num">
                                {{ m.latestBalanceAfter ?? '—' }}
                              </td>
                            </tr>
                          }
                        </tbody>
                      </table>
                    }
                  </div>
                } @else if (driftLoaded()) {
                  <p class="small muted">
                    {{ 'admin.gamification.ops.noDrift' | translate }}
                  </p>
                }
              </div>
            </div>
          </section>
        }
      }
    </div>

    <cdf-drawer
      [(open)]="badgeOpen"
      size="lg"
      [title]="
        (badgeForm.id
          ? 'admin.gamification.badges.edit'
          : 'admin.gamification.badges.new'
        ) | translate
      "
    >
      <div class="form-grid">
        <cdf-form-field
          [label]="'admin.common.slug' | translate"
          controlId="b-slug"
          [error]="badgeErrors()['slug'] ?? null"
        >
          <cdf-input inputId="b-slug" [(ngModel)]="badgeForm.slug" />
        </cdf-form-field>
        <cdf-form-field
          [label]="'admin.common.name' | translate"
          controlId="b-name"
          [error]="badgeErrors()['name'] ?? null"
        >
          <cdf-input inputId="b-name" [(ngModel)]="badgeForm.name" />
        </cdf-form-field>
        <cdf-form-field
          class="span-all"
          [label]="'admin.common.description' | translate"
          controlId="b-desc"
        >
          <cdf-input inputId="b-desc" [(ngModel)]="badgeForm.description" />
        </cdf-form-field>
        <cdf-form-field
          [label]="'admin.gamification.badges.icon' | translate"
          controlId="b-icon"
        >
          <cdf-input inputId="b-icon" [(ngModel)]="badgeForm.iconName" />
        </cdf-form-field>
        <cdf-form-field
          [label]="'admin.gamification.rewardFields.xp' | translate"
          controlId="b-xp"
        >
          <cdf-input
            inputId="b-xp"
            type="number"
            [(ngModel)]="badgeForm.xpReward"
          />
        </cdf-form-field>
        <cdf-form-field
          [label]="'admin.gamification.rewardFields.coins' | translate"
          controlId="b-coins"
        >
          <cdf-input
            inputId="b-coins"
            type="number"
            [(ngModel)]="badgeForm.coinReward"
          />
        </cdf-form-field>
        <cdf-toggle
          [(ngModel)]="badgeForm.isHidden"
          [label]="'admin.gamification.badges.hiddenToggle' | translate"
        />
        <cdf-toggle
          [(ngModel)]="badgeForm.isActive"
          [label]="'admin.common.active' | translate"
        />
        <div class="span-all">
          <label class="form-label" for="b-rule">{{
            'admin.gamification.badges.rule' | translate
          }}</label>
          <textarea
            id="b-rule"
            class="form-control mono"
            rows="8"
            spellcheck="false"
            [(ngModel)]="badgeForm.rule"
            aria-describedby="b-rule-help"
            [attr.aria-invalid]="ruleErrors().length > 0 || null"
          ></textarea>
          <p class="muted small" id="b-rule-help">
            {{ 'admin.gamification.badges.ruleHelp' | translate }}
          </p>
          @if (ruleErrors().length > 0) {
            <ul class="issue-list" role="alert">
              @for (e of ruleErrors(); track $index) {
                <li>{{ e }}</li>
              }
            </ul>
          }
        </div>
      </div>
      @if (badgeError(); as e) {
        <p class="form-error" role="alert">{{ e }}</p>
      }
      <div drawerFooter class="form-actions">
        <cdf-button
          kind="primary"
          [loading]="busy() === 'badge'"
          (click)="saveBadge()"
        >
          {{ 'admin.common.save' | translate }}
        </cdf-button>
        <cdf-button kind="ghost" (click)="badgeOpen.set(false)">{{
          'admin.common.cancel' | translate
        }}</cdf-button>
      </div>
    </cdf-drawer>

    <cdf-drawer
      [(open)]="questOpen"
      [title]="
        (questForm.id
          ? 'admin.gamification.quests.edit'
          : 'admin.gamification.quests.new'
        ) | translate
      "
    >
      <div class="form-grid">
        <cdf-form-field
          [label]="'admin.common.slug' | translate"
          controlId="q-slug"
          [error]="questErrors()['slug'] ?? null"
        >
          <cdf-input
            inputId="q-slug"
            [(ngModel)]="questForm.slug"
            [disabled]="!!questForm.id"
          />
        </cdf-form-field>
        <cdf-form-field
          [label]="'admin.gamification.quests.titleField' | translate"
          controlId="q-title"
          [error]="questErrors()['title'] ?? null"
        >
          <cdf-input inputId="q-title" [(ngModel)]="questForm.title" />
        </cdf-form-field>
        <cdf-form-field
          [label]="'admin.gamification.quests.kind' | translate"
          controlId="q-kind"
        >
          <cdf-select
            inputId="q-kind"
            [options]="questKindOptions()"
            [(ngModel)]="questForm.kind"
          />
        </cdf-form-field>
        @if (questForm.kind === 'CATEGORY_LESSON_COUNT') {
          <cdf-form-field
            [label]="'admin.gamification.quests.categorySlug' | translate"
            controlId="q-cat"
            [error]="questErrors()['categorySlug'] ?? null"
          >
            <cdf-input inputId="q-cat" [(ngModel)]="questForm.categorySlug" />
          </cdf-form-field>
        }
        <cdf-form-field
          [label]="'admin.gamification.quests.target' | translate"
          controlId="q-target"
        >
          <cdf-input
            inputId="q-target"
            type="number"
            [(ngModel)]="questForm.target"
          />
        </cdf-form-field>
        <cdf-form-field
          [label]="'admin.gamification.quests.difficulty' | translate"
          controlId="q-diff"
        >
          <cdf-select
            inputId="q-diff"
            [options]="difficultyOptions()"
            [(ngModel)]="questForm.difficulty"
          />
        </cdf-form-field>
        <cdf-form-field
          [label]="'admin.gamification.quests.weight' | translate"
          [help]="'admin.gamification.quests.weightHelp' | translate"
          controlId="q-weight"
        >
          <cdf-input
            inputId="q-weight"
            type="number"
            [(ngModel)]="questForm.weight"
          />
        </cdf-form-field>
        <cdf-form-field
          [label]="'admin.gamification.rewardFields.xp' | translate"
          controlId="q-xp"
        >
          <cdf-input
            inputId="q-xp"
            type="number"
            [(ngModel)]="questForm.xpReward"
          />
        </cdf-form-field>
        <cdf-form-field
          [label]="'admin.gamification.rewardFields.coins' | translate"
          controlId="q-coins"
        >
          <cdf-input
            inputId="q-coins"
            type="number"
            [(ngModel)]="questForm.coinReward"
          />
        </cdf-form-field>
        <cdf-toggle
          [(ngModel)]="questForm.isActive"
          [label]="'admin.common.active' | translate"
        />
      </div>
      @if (questError(); as e) {
        <p class="form-error" role="alert">{{ e }}</p>
      }
      <div drawerFooter class="form-actions">
        <cdf-button
          kind="primary"
          [loading]="busy() === 'quest'"
          (click)="saveQuest()"
        >
          {{ 'admin.common.save' | translate }}
        </cdf-button>
        <cdf-button kind="ghost" (click)="questOpen.set(false)">{{
          'admin.common.cancel' | translate
        }}</cdf-button>
      </div>
    </cdf-drawer>
  `,
  styles: [
    `
      .config-list {
        display: flex;
        flex-direction: column;
        gap: var(--cdf-space-3);
      }
      .config-row {
        border-bottom: 1px solid var(--cdf-color-border);
        padding-bottom: var(--cdf-space-3);
        p {
          margin: 4px 0 0;
        }
      }
      .config-row__head {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--cdf-space-2);
        margin-bottom: var(--cdf-space-2);
      }
      .rule {
        font-size: 11px;
        word-break: break-all;
      }
      .ops-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
        gap: var(--cdf-space-3);
      }
      .drift {
        grid-column: 1 / -1;
      }
      .result {
        margin-top: var(--cdf-space-2);
      }
    `,
  ],
})
export class GamificationPage {
  private readonly client = inject(GamificationClient);
  private readonly leagues = inject(LeaguesClient);
  private readonly referrals = inject(ReferralsClient);
  private readonly items = inject(ItemsClient);
  private readonly ops = inject(OpsClient);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmDialogService);
  private readonly errorsSvc = inject(AdminErrors);
  private readonly i18n = inject(I18nService);

  protected readonly tabs = TABS;
  protected readonly tab = signal<Tab>('defaults');
  protected readonly busy = signal<string | null>(null);
  protected readonly config = signal<ConfigRow[] | null>(null);
  protected readonly badges = signal<BadgeDef[]>([]);
  protected readonly quests = signal<QuestTemplateRow[]>([]);
  protected readonly rolloverResult = signal<RolloverSummary | null>(null);
  protected readonly referralResult = signal<{
    candidates: number;
    rewarded: number;
  } | null>(null);
  protected readonly dropsResult = signal<{
    drops: number;
    pushed: number;
  } | null>(null);
  protected readonly drift = signal<LedgerDriftReport | null>(null);
  protected readonly driftLoaded = signal(false);

  protected readonly badgeOpen = signal(false);
  protected badgeForm: BadgeForm = emptyBadge();
  protected readonly badgeErrors = signal<Record<string, string | undefined>>(
    {},
  );
  protected readonly ruleErrors = signal<string[]>([]);
  protected readonly badgeError = signal<string | null>(null);

  protected readonly questOpen = signal(false);
  protected questForm: QuestForm = emptyQuest();
  protected readonly questErrors = signal<Record<string, string | undefined>>(
    {},
  );
  protected readonly questError = signal<string | null>(null);

  protected readonly questKindOptions = computed<SelectOption<QuestKind>[]>(
    () => {
      this.i18n.currentLocale();
      return QUEST_KINDS.map((k) => ({
        value: k,
        label: this.i18n.t(`admin.gamification.questKinds.${k}`),
      }));
    },
  );
  protected readonly difficultyOptions = computed<SelectOption<number>[]>(
    () => {
      this.i18n.currentLocale();
      return [1, 2, 3].map((d) => ({
        value: d,
        label: this.i18n.t(`admin.gamification.difficulties.${d}`),
      }));
    },
  );

  constructor() {
    void this.loadConfig();
    void this.loadLists();
    void this.loadDrift();
  }

  // ─── Defaults ─────────────────────────────────────────────────────────

  private toRows(entries: GamificationConfigEntry[]): ConfigRow[] {
    return entries.map((entry) => {
      const shape = configShape(entry.value);
      return {
        entry,
        shape,
        num: shape.kind === 'number' ? (entry.value as number) : null,
        fields:
          shape.kind === 'fields'
            ? { ...(entry.value as unknown as Record<string, number>) }
            : {},
        json: shape.kind === 'json' ? JSON.stringify(entry.value, null, 2) : '',
        error: null,
      };
    });
  }

  protected fieldNames(row: ConfigRow): string[] {
    return row.shape.kind === 'fields' ? row.shape.fields : [];
  }

  private async loadConfig(): Promise<void> {
    try {
      this.config.set(this.toRows(await this.client.getConfig()));
    } catch (err) {
      this.config.set([]);
      this.errorsSvc.toast(err, 'admin.errors.loadFailed');
    }
  }

  /** Collect changed keys; returns null (and flags rows) when a value is invalid. */
  private configPatch(): GamificationConfigPatch | null {
    const rows = this.config() ?? [];
    const patch: Record<string, unknown> = {};
    let ok = true;
    for (const row of rows) {
      row.error = null;
      let value: unknown;
      if (row.shape.kind === 'number') {
        value = Number(row.num);
        if (row.num === null || !Number.isFinite(value)) {
          row.error = this.i18n.t('admin.common.invalidNumber');
          ok = false;
          continue;
        }
      } else if (row.shape.kind === 'fields') {
        value = Object.fromEntries(
          Object.entries(row.fields).map(([k, v]) => [k, Number(v)]),
        );
      } else {
        try {
          value = JSON.parse(row.json);
        } catch (e) {
          row.error = this.i18n.t('admin.common.invalidJson', {
            message: e instanceof Error ? e.message : String(e),
          });
          ok = false;
          continue;
        }
      }
      if (JSON.stringify(value) !== JSON.stringify(row.entry.value))
        patch[row.entry.key] = value;
    }
    this.config.set([...rows]);
    return ok ? (patch as GamificationConfigPatch) : null;
  }

  protected async saveConfig(): Promise<void> {
    const patch = this.configPatch();
    if (!patch) return;
    if (Object.keys(patch).length === 0) {
      this.toast.info(this.i18n.t('admin.gamification.defaults.noChanges'));
      return;
    }
    await this.putConfig(patch);
  }

  protected async resetKey(key: GamificationConfigKey): Promise<void> {
    await this.putConfig({ [key]: null } as GamificationConfigPatch);
  }

  private async putConfig(patch: GamificationConfigPatch): Promise<void> {
    this.busy.set('config');
    try {
      this.config.set(this.toRows(await this.client.updateConfig(patch)));
      this.toast.success(this.i18n.t('admin.gamification.defaults.saved'));
    } catch (err) {
      this.errorsSvc.toast(err, 'admin.errors.saveFailed');
    } finally {
      this.busy.set(null);
    }
  }

  // ─── Badges / quests ──────────────────────────────────────────────────

  private async loadLists(): Promise<void> {
    try {
      const [b, q] = await Promise.all([
        this.client.listBadges(true),
        this.client.listQuestTemplates(true),
      ]);
      this.badges.set(b);
      this.quests.set(q);
    } catch (err) {
      this.errorsSvc.toast(err, 'admin.errors.loadFailed');
    }
  }

  protected editBadge(b: BadgeDef | null): void {
    this.badgeForm = b
      ? {
          id: b.id,
          slug: b.slug,
          name: b.name,
          description: b.description ?? '',
          iconName: b.iconName ?? '',
          rule: JSON.stringify(b.rule, null, 2),
          xpReward: b.xpReward,
          coinReward: b.coinReward,
          isHidden: b.isHidden,
          isActive: b.isActive,
        }
      : emptyBadge();
    this.badgeErrors.set({});
    this.ruleErrors.set([]);
    this.badgeError.set(null);
    this.badgeOpen.set(true);
  }

  protected async saveBadge(): Promise<void> {
    const f = this.badgeForm;
    const errs: Record<string, string> = {};
    if (!SLUG_PATTERN.test(f.slug.trim()))
      errs['slug'] = this.i18n.t('admin.common.invalidSlug');
    if (!f.name.trim()) errs['name'] = this.i18n.t('admin.common.required');
    this.badgeErrors.set(errs);
    let rule: Record<string, unknown>;
    try {
      rule = JSON.parse(f.rule) as Record<string, unknown>;
      this.ruleErrors.set([]);
    } catch (e) {
      this.ruleErrors.set([
        this.i18n.t('admin.common.invalidJson', {
          message: e instanceof Error ? e.message : String(e),
        }),
      ]);
      return;
    }
    if (Object.keys(errs).length) return;
    const body = {
      slug: f.slug.trim(),
      name: f.name.trim(),
      description: f.description.trim() || undefined,
      iconName: f.iconName.trim() || undefined,
      rule,
      xpReward: Math.max(0, Math.round(Number(f.xpReward) || 0)),
      coinReward: Math.max(0, Math.round(Number(f.coinReward) || 0)),
      isHidden: f.isHidden,
      isActive: f.isActive,
    };
    this.busy.set('badge');
    this.badgeError.set(null);
    try {
      const saved = f.id
        ? await this.client.updateBadge(f.id, body)
        : await this.client.createBadge(body);
      this.badges.update((bs) =>
        f.id ? bs.map((b) => (b.id === saved.id ? saved : b)) : [saved, ...bs],
      );
      this.toast.success(
        this.i18n.t('admin.gamification.badges.saved', { name: saved.name }),
      );
      this.badgeOpen.set(false);
    } catch (err) {
      const p = toProblemDetails(err);
      // Rule DSL problems come back as a 400 whose detail lists each issue.
      if (p.status === 400 && p.code !== 'validation.failed' && p.message) {
        this.ruleErrors.set(p.message.split('; ').filter(Boolean));
      } else {
        this.badgeError.set(
          this.errorsSvc.message(err, 'admin.errors.saveFailed'),
        );
      }
    } finally {
      this.busy.set(null);
    }
  }

  protected async deleteBadge(b: BadgeDef): Promise<void> {
    if (!(await this.confirmDelete(b.name))) return;
    try {
      await this.client.deleteBadge(b.id);
      this.badges.update((bs) => bs.filter((x) => x.id !== b.id));
    } catch (err) {
      this.errorsSvc.toast(err, 'admin.errors.deleteFailed');
    }
  }

  protected editQuest(q: QuestTemplateRow | null): void {
    this.questForm = q
      ? {
          id: q.id,
          slug: q.slug,
          title: q.title,
          kind: q.kind,
          difficulty: q.difficulty,
          weight: q.weight ?? 1,
          target: q.target,
          categorySlug: String(q.paramsJson?.['categorySlug'] ?? ''),
          xpReward: q.xpReward,
          coinReward: q.coinReward,
          isActive: q.isActive,
        }
      : emptyQuest();
    this.questErrors.set({});
    this.questError.set(null);
    this.questOpen.set(true);
  }

  protected async saveQuest(): Promise<void> {
    const f = this.questForm;
    const errs: Record<string, string> = {};
    if (!SLUG_PATTERN.test(f.slug.trim()))
      errs['slug'] = this.i18n.t('admin.common.invalidSlug');
    if (!f.title.trim()) errs['title'] = this.i18n.t('admin.common.required');
    if (f.kind === 'CATEGORY_LESSON_COUNT' && !f.categorySlug.trim())
      errs['categorySlug'] = this.i18n.t('admin.common.required');
    this.questErrors.set(errs);
    if (Object.keys(errs).length) return;
    const body = {
      kind: f.kind,
      title: f.title.trim(),
      difficulty: Number(f.difficulty),
      weight: Math.min(100, Math.max(1, Math.round(Number(f.weight) || 1))),
      target: Math.max(1, Math.round(Number(f.target) || 1)),
      paramsJson:
        f.kind === 'CATEGORY_LESSON_COUNT'
          ? { categorySlug: f.categorySlug.trim() }
          : {},
      xpReward: Math.max(0, Math.round(Number(f.xpReward) || 0)),
      coinReward: Math.max(0, Math.round(Number(f.coinReward) || 0)),
      isActive: f.isActive,
    };
    this.busy.set('quest');
    this.questError.set(null);
    try {
      const saved = (
        f.id
          ? await this.client.updateQuestTemplate(f.id, body)
          : await this.client.createQuestTemplate({
              ...body,
              slug: f.slug.trim(),
            })
      ) as QuestTemplateRow;
      this.quests.update((qs) =>
        f.id ? qs.map((q) => (q.id === saved.id ? saved : q)) : [saved, ...qs],
      );
      this.toast.success(
        this.i18n.t('admin.gamification.quests.saved', { name: saved.title }),
      );
      this.questOpen.set(false);
    } catch (err) {
      this.questError.set(
        this.errorsSvc.message(err, 'admin.errors.saveFailed'),
      );
    } finally {
      this.busy.set(null);
    }
  }

  protected async deleteQuest(q: QuestTemplateRow): Promise<void> {
    if (!(await this.confirmDelete(q.title))) return;
    try {
      await this.client.deleteQuestTemplate(q.id);
      this.quests.update((qs) => qs.filter((x) => x.id !== q.id));
    } catch (err) {
      this.errorsSvc.toast(err, 'admin.errors.deleteFailed');
    }
  }

  private confirmDelete(name: string): Promise<boolean> {
    return this.confirm
      .open({
        title: this.i18n.t('admin.common.deleteConfirmTitle', { name }),
        message: this.i18n.t('admin.gamification.deleteMessage'),
        confirmLabel: this.i18n.t('admin.common.delete'),
        confirmKind: 'danger',
        icon: 'trash',
      })
      .then((ok) => ok === true);
  }

  // ─── Operations ───────────────────────────────────────────────────────

  private async runOp<T>(
    key: string,
    fn: () => Promise<T>,
    done: (r: T) => void,
  ): Promise<void> {
    this.busy.set(key);
    try {
      done(await fn());
    } catch (err) {
      this.errorsSvc.toast(err, 'admin.errors.actionFailed');
    } finally {
      this.busy.set(null);
    }
  }

  protected rollover(): Promise<void> {
    return this.runOp(
      'rollover',
      () => this.leagues.rollover(),
      (r) => this.rolloverResult.set(r),
    );
  }
  protected runReferrals(): Promise<void> {
    return this.runOp(
      'referrals',
      () => this.referrals.runRewards(),
      (r) => this.referralResult.set(r),
    );
  }
  protected announceDrops(): Promise<void> {
    return this.runOp(
      'drops',
      () => this.items.announceDrops(),
      (r) => this.dropsResult.set(r),
    );
  }
  protected runDrift(): Promise<void> {
    return this.runOp(
      'drift',
      () => this.ops.runDrift(),
      (r) => this.drift.set(r.report),
    );
  }

  private async loadDrift(): Promise<void> {
    try {
      this.drift.set((await this.ops.lastDrift()).report);
    } catch (err) {
      this.errorsSvc.toast(err, 'admin.errors.loadFailed');
    } finally {
      this.driftLoaded.set(true);
    }
  }

  protected show(v: unknown): string {
    return JSON.stringify(v);
  }
}

function emptyBadge(): BadgeForm {
  return {
    id: null,
    slug: '',
    name: '',
    description: '',
    iconName: 'trophy',
    rule: DEFAULT_RULE,
    xpReward: 10,
    coinReward: 10,
    isHidden: false,
    isActive: true,
  };
}

function emptyQuest(): QuestForm {
  return {
    id: null,
    slug: '',
    title: '',
    kind: 'LESSON_COUNT',
    difficulty: 1,
    weight: 1,
    target: 1,
    categorySlug: '',
    xpReward: 10,
    coinReward: 5,
    isActive: true,
  };
}
