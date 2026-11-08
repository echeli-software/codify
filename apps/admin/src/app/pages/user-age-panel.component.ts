import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { I18nService, TranslatePipe } from '@codify/i18n';
import {
  Badge,
  Button,
  ConfirmDialogService,
  FormField,
  Input,
  ToastService,
  type BadgeVariant,
} from '@codify/ui-bootstrap';
import {
  UsersClient,
  type AgeGroup,
  type BirthDateCorrectionResult,
} from '@codify/api-client';
import { ageOn, checkBirthDate, MINIMUM_AGE } from '@codify/domain';
import { AdminErrors } from '../core/errors';

/** Badge colour per age group (null = not given). */
export function ageGroupVariant(group: AgeGroup | null): BadgeVariant {
  return group === 'minor' ? 'warning' : group === 'adult' ? 'neutral' : 'info';
}

/**
 * Would this corrected date delete the account (under 12 today, UTC)?
 * Exported for tests; the API decides on the user's own day.
 */
export function deletesAccount(birthDate: string, now = new Date()): boolean {
  const today = now.toISOString().slice(0, 10);
  return (
    !checkBirthDate(birthDate, today) && ageOn(birthDate, today) < MINIMUM_AGE
  );
}

/**
 * Users → detail → Age (docs/04 Users, docs/14 "Minors"): the age group
 * (Under 18 / Adult / Not given — staff never see the date) and the
 * "correct date of birth" action for ADMIN and SUPPORT. Typed confirmation
 * (the user's email); audited server-side with the age groups only. A date
 * under 12 deletes the account at once — the dialog says so.
 *
 *   <cdf-user-age-panel [userId]="id" [email]="u.email" [ageGroup]="u.ageGroup" />
 */
@Component({
  selector: 'cdf-user-age-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, Badge, Button, FormField, Input, TranslatePipe],
  template: `
    <section
      class="admin-card"
      aria-labelledby="age-title"
      data-testid="user-age-panel"
    >
      <h2 id="age-title">{{ 'admin.users.age.title' | translate }}</h2>
      <dl class="kv">
        <dt>{{ 'admin.users.ageGroup' | translate }}</dt>
        <dd>
          <cdf-badge
            [variant]="variant(ageGroup())"
            data-testid="age-group-badge"
            >{{
              'admin.users.ageGroups.' + (ageGroup() ?? 'none') | translate
            }}</cdf-badge
          >
        </dd>
      </dl>
      <p class="muted small">{{ 'admin.users.age.help' | translate }}</p>
      <form
        class="age-form"
        (submit)="submit($event)"
        data-testid="birth-date-correction"
      >
        <cdf-form-field
          [label]="'admin.users.age.dateLabel' | translate"
          [help]="'admin.users.age.dateHelp' | translate"
          [error]="dateError()"
          controlId="age-birth-date"
        >
          <input
            id="age-birth-date"
            class="form-control"
            type="date"
            name="birthDate"
            data-testid="correct-birth-date"
            [(ngModel)]="birthDate"
          />
        </cdf-form-field>
        <cdf-form-field
          [label]="'admin.common.reason' | translate"
          [help]="'admin.users.age.reasonHelp' | translate"
        >
          <cdf-input name="ageReason" [(ngModel)]="reason" />
        </cdf-form-field>
        <cdf-button
          kind="secondary"
          type="submit"
          [loading]="busy()"
          data-testid="correct-birth-date-submit"
        >
          {{ 'admin.users.age.correct' | translate }}
        </cdf-button>
      </form>
    </section>
  `,
  styles: [
    `
      .age-form {
        display: flex;
        flex-wrap: wrap;
        align-items: flex-end;
        gap: var(--cdf-space-3);
      }
      .age-form cdf-form-field {
        flex: 1 1 220px;
      }
    `,
  ],
})
export class UserAgePanelComponent {
  readonly userId = input.required<string>();
  readonly email = input<string | null>(null);
  readonly ageGroup = input<AgeGroup | null>(null);
  readonly corrected = output<BirthDateCorrectionResult>();

  private readonly users = inject(UsersClient);
  private readonly confirm = inject(ConfirmDialogService);
  private readonly i18n = inject(I18nService);
  private readonly toast = inject(ToastService);
  private readonly errors = inject(AdminErrors);

  protected birthDate = '';
  protected reason = '';
  protected readonly busy = signal(false);
  protected readonly dateError = signal<string | null>(null);
  protected readonly variant = ageGroupVariant;

  protected async submit(ev: Event): Promise<void> {
    ev.preventDefault();
    const date = this.birthDate.trim();
    const today = new Date().toISOString().slice(0, 10);
    if (!date || checkBirthDate(date, today)) {
      this.dateError.set(this.i18n.t('admin.users.age.invalidDate'));
      return;
    }
    this.dateError.set(null);
    const deletes = deletesAccount(date);
    const email = this.email();
    const ok = await this.confirm.open({
      title: this.i18n.t('admin.users.age.confirmTitle'),
      message: this.i18n.t(
        deletes
          ? 'admin.users.age.confirmDelete'
          : 'admin.users.age.confirmMessage',
      ),
      confirmLabel: this.i18n.t(
        deletes
          ? 'admin.users.age.confirmDeleteLabel'
          : 'admin.users.age.correct',
      ),
      confirmKind: 'danger',
      ...(email ? { typeToConfirm: email } : {}),
    });
    if (!ok) return;
    this.busy.set(true);
    try {
      const res = await this.users.correctBirthDate(this.userId(), {
        birthDate: date,
        confirm: 'CORRECT',
        ...(this.reason.trim() ? { reason: this.reason.trim() } : {}),
      });
      this.birthDate = '';
      this.reason = '';
      this.toast.success(
        this.i18n.t(
          'deleted' in res.after
            ? 'admin.users.age.deleted'
            : 'admin.users.age.done',
        ),
      );
      this.corrected.emit(res);
    } catch (err) {
      this.errors.toast(err, 'admin.errors.actionFailed');
    } finally {
      this.busy.set(false);
    }
  }
}
