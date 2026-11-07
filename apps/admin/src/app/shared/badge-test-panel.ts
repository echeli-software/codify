import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslatePipe } from '@codify/i18n';
import {
  Badge,
  Button,
  Combobox,
  type ComboboxOption,
  type ComboboxSource,
  FormField,
  Icon,
} from '@codify/ui-bootstrap';
import {
  AdminOpsClient,
  UsersClient,
  type BadgeTestResult,
} from '@codify/api-client';
import { AdminErrors } from '../core/errors';

/** Predicate `{ gte: 10 }` → `≥ 10` (symbols only, no words). */
export function predicateText(p: Record<string, number>): string {
  const sym: Record<string, string> = {
    gte: '≥',
    lte: '≤',
    gt: '>',
    lt: '<',
    eq: '=',
  };
  return Object.entries(p)
    .map(([k, v]) => `${sym[k] ?? k} ${v}`)
    .join(', ');
}

/**
 * Gamification → Badges "Test" (docs/04): pick a user, run the badge rule
 * against their current metrics, see whether it would unlock and which
 * clauses pass. Nothing is awarded.
 */
@Component({
  selector: 'cdf-badge-test-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    Badge,
    Button,
    Combobox,
    FormField,
    Icon,
    TranslatePipe,
  ],
  template: `
    <p class="muted small">
      {{ 'admin.gamification.badges.testHelp' | translate }}
    </p>
    <cdf-form-field
      [label]="'admin.gamification.badges.testUser' | translate"
      controlId="badge-test-user"
    >
      <cdf-combobox
        inputId="badge-test-user"
        [source]="searchUsers"
        [minChars]="2"
        [placeholder]="
          'admin.gamification.badges.testUserPlaceholder' | translate
        "
        [ngModel]="userId()"
        (ngModelChange)="userId.set($event)"
      />
    </cdf-form-field>
    <div class="form-actions">
      <cdf-button
        kind="primary"
        [disabled]="!userId()"
        [loading]="running()"
        (click)="run()"
        data-testid="run-badge-test"
      >
        {{ 'admin.gamification.badges.testRun' | translate }}
      </cdf-button>
    </div>
    @if (error(); as e) {
      <p class="form-error" role="alert">{{ e }}</p>
    }
    @if (result(); as r) {
      <section
        class="result"
        aria-live="polite"
        data-testid="badge-test-result"
      >
        <p class="verdict">
          @if (r.alreadyEarned) {
            <cdf-badge variant="info">{{
              'admin.gamification.badges.testEarned' | translate
            }}</cdf-badge>
          }
          <cdf-badge [variant]="r.wouldUnlock ? 'success' : 'neutral'">
            <cdf-icon
              [name]="r.wouldUnlock ? 'check-circle' : 'x-circle'"
              size="sm"
            />
            {{
              (r.wouldUnlock
                ? 'admin.gamification.badges.testWould'
                : 'admin.gamification.badges.testWouldNot'
              ) | translate
            }}
          </cdf-badge>
          @if (!r.badgeActive) {
            <cdf-badge variant="warning" [subtle]="true">{{
              'admin.gamification.badges.testInactive' | translate
            }}</cdf-badge>
          }
        </p>
        @if (r.clauses.length === 0) {
          <p class="muted small">
            {{ 'admin.gamification.badges.testManual' | translate }}
          </p>
        } @else {
          <p class="small muted">
            {{ 'admin.gamification.badges.testMode.' + r.mode | translate }}
          </p>
          <table class="admin-table">
            <thead>
              <tr>
                <th scope="col">
                  {{ 'admin.gamification.badges.testClause' | translate }}
                </th>
                <th scope="col" class="num">
                  {{ 'admin.gamification.badges.testValue' | translate }}
                </th>
                <th scope="col">
                  {{ 'admin.gamification.badges.testNeeds' | translate }}
                </th>
                <th scope="col">
                  <span class="visually-hidden">{{
                    'admin.common.status' | translate
                  }}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              @for (c of r.clauses; track $index) {
                <tr>
                  <td class="mono">{{ c.key }}</td>
                  <td class="num">{{ c.value }}</td>
                  <td class="mono">{{ predicate(c.predicate) }}</td>
                  <td>
                    <cdf-badge
                      [variant]="c.passed ? 'success' : 'danger'"
                      [subtle]="true"
                      >{{
                        (c.passed
                          ? 'admin.gamification.badges.testPass'
                          : 'admin.gamification.badges.testFail'
                        ) | translate
                      }}</cdf-badge
                    >
                  </td>
                </tr>
              }
            </tbody>
          </table>
        }
      </section>
    }
  `,
  styles: [
    `
      .result {
        margin-top: var(--cdf-space-3);
      }
      .verdict {
        display: flex;
        flex-wrap: wrap;
        gap: var(--cdf-space-2);
      }
    `,
  ],
})
export class BadgeTestPanel {
  private readonly ops = inject(AdminOpsClient);
  private readonly users = inject(UsersClient);
  private readonly errors = inject(AdminErrors);

  readonly badgeId = input.required<string>();

  protected readonly userId = signal<string | null>(null);
  protected readonly running = signal(false);
  protected readonly result = signal<BadgeTestResult | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly predicate = predicateText;

  constructor() {
    // A different badge → clear the previous verdict (keep the user).
    effect(() => {
      this.badgeId();
      this.result.set(null);
      this.error.set(null);
    });
  }

  protected readonly searchUsers: ComboboxSource<string> = async (q) => {
    const res = await this.users.list({ q, take: 8 });
    return res.items.map(
      (u): ComboboxOption<string> => ({
        value: u.id,
        label: u.displayName,
        description: u.email,
      }),
    );
  };

  protected async run(): Promise<void> {
    const userId = this.userId();
    if (!userId) return;
    this.running.set(true);
    this.error.set(null);
    try {
      this.result.set(await this.ops.testBadge(this.badgeId(), userId));
    } catch (err) {
      this.result.set(null);
      this.error.set(this.errors.message(err, 'admin.errors.actionFailed'));
    } finally {
      this.running.set(false);
    }
  }
}
