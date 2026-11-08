import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import {
  MeClient,
  ProblemDetailsError,
  type MeResponse,
} from '@codify/api-client';
import { I18nService, TranslatePipe } from '@codify/i18n';
import { AppButton } from '@codify/ui-ionic';
import { AppSessionService } from '../../platform/app-session.service.js';
import {
  AgeGateService,
  birthDateFromParts,
  datePartOrder,
  monthNames,
  type BirthDateFormProblem,
  type DatePart,
} from './birth-date.js';

/** Where an under-12 date of birth lands (outside the shell, signed out). */
export const TOO_YOUNG_ROUTE = '/account/too-young';

let nextId = 0;

/** The device's IANA zone (the API re-checks on the account's zone). */
function deviceZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}

/**
 * Date-of-birth form (docs/05 Onboarding step 0, docs/14 "Minors"): day,
 * month and year as three labelled fields in the locale's order (pt-BR
 * dd/mm/aaaa, en-US mm/dd/yyyy) inside one fieldset — no date picker, so
 * keyboards and screen readers get plain controls. Sends PUT
 * /me/birth-date once; under 12 the API deletes the account and the app
 * signs out to TOO_YOUNG_ROUTE.
 */
@Component({
  selector: 'cdf-birth-date-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AppButton, TranslatePipe],
  template: `
    <form
      class="dob"
      novalidate
      (submit)="submit($event)"
      data-testid="birth-date-form"
    >
      <h2 class="dob__title" [id]="ids.title">
        {{ 'student.age.title' | translate }}
      </h2>
      <p class="dob__muted" [id]="ids.body">
        {{ 'student.age.body' | translate }}
      </p>
      <fieldset
        class="dob__fields"
        [attr.aria-describedby]="problem() ? ids.error : ids.body"
        [attr.aria-invalid]="problem() ? true : null"
      >
        <legend>{{ 'student.age.legend' | translate }}</legend>
        @for (part of order(); track part) {
          @switch (part) {
            @case ('day') {
              <label class="dob__field dob__field--day" [for]="ids.day">
                <span>{{ 'student.age.day' | translate }}</span>
                <input
                  [id]="ids.day"
                  type="text"
                  inputmode="numeric"
                  autocomplete="bday-day"
                  maxlength="2"
                  data-testid="dob-day"
                  [value]="day()"
                  (input)="day.set($any($event.target).value)"
                />
              </label>
            }
            @case ('month') {
              <label class="dob__field dob__field--month" [for]="ids.month">
                <span>{{ 'student.age.month' | translate }}</span>
                <select
                  [id]="ids.month"
                  autocomplete="bday-month"
                  data-testid="dob-month"
                  (change)="month.set($any($event.target).value)"
                >
                  <option value="" [selected]="month() === ''">
                    {{ 'student.age.chooseMonth' | translate }}
                  </option>
                  @for (name of months(); track $index) {
                    <option
                      [value]="$index + 1"
                      [selected]="month() === '' + ($index + 1)"
                    >
                      {{ name }}
                    </option>
                  }
                </select>
              </label>
            }
            @case ('year') {
              <label class="dob__field dob__field--year" [for]="ids.year">
                <span>{{ 'student.age.year' | translate }}</span>
                <input
                  [id]="ids.year"
                  type="text"
                  inputmode="numeric"
                  autocomplete="bday-year"
                  maxlength="4"
                  data-testid="dob-year"
                  [value]="year()"
                  (input)="year.set($any($event.target).value)"
                />
              </label>
            }
          }
        }
      </fieldset>
      @if (problem(); as p) {
        <p
          class="dob__error"
          role="alert"
          [id]="ids.error"
          data-testid="dob-error"
        >
          {{ 'student.age.errors.' + p | translate }}
        </p>
      }
      <div class="dob__actions">
        <cdf-app-button
          kind="primary"
          type="submit"
          [loading]="saving()"
          data-testid="dob-submit"
          >{{ 'student.age.submit' | translate }}</cdf-app-button
        >
      </div>
    </form>
  `,
  styles: [
    `
      .dob__title {
        font-size: var(--cdf-font-size-xl);
        margin: 0 0 var(--cdf-space-2);
      }
      .dob__muted {
        color: var(--cdf-color-text-muted);
        font-size: var(--cdf-font-size-sm);
        margin: 0 0 var(--cdf-space-3);
        line-height: 1.5;
      }
      .dob__fields {
        border: 0;
        margin: 0;
        padding: 0;
        display: flex;
        flex-wrap: wrap;
        gap: var(--cdf-space-2);
      }
      .dob__fields legend {
        font-weight: 600;
        margin-bottom: var(--cdf-space-2);
        padding: 0;
      }
      .dob__field {
        display: flex;
        flex-direction: column;
        gap: 4px;
        font-size: var(--cdf-font-size-sm);
        font-weight: 600;
      }
      .dob__field--day {
        width: 76px;
      }
      .dob__field--year {
        width: 104px;
      }
      .dob__field--month {
        flex: 1 1 160px;
        min-width: 0;
      }
      .dob__field input,
      .dob__field select {
        font: inherit;
        font-size: var(--cdf-font-size-md);
        font-weight: 400;
        min-height: 48px;
        padding: 6px 10px;
        border-radius: 12px;
        border: 2px solid var(--cdf-color-border);
        background: var(--cdf-color-surface);
        color: var(--cdf-color-text);
        width: 100%;
        box-sizing: border-box;
      }
      .dob__fields[aria-invalid='true'] input,
      .dob__fields[aria-invalid='true'] select {
        border-color: var(--cdf-color-danger, #b91c1c);
      }
      .dob__field input:focus-visible,
      .dob__field select:focus-visible {
        outline: 2px solid var(--cdf-color-primary);
        outline-offset: 2px;
      }
      .dob__error {
        color: var(--cdf-color-danger, #b91c1c);
        font-size: var(--cdf-font-size-sm);
        font-weight: 600;
        margin: var(--cdf-space-2) 0 0;
      }
      .dob__actions {
        display: flex;
        justify-content: flex-end;
        margin-top: var(--cdf-space-3);
      }
    `,
  ],
})
export class BirthDateFormComponent {
  /** Emitted with GET /me's shape once the date is stored. */
  readonly saved = output<MeResponse>();
  /** Optional id prefix (tests / two forms on a page). */
  readonly idPrefix = input<string>('');

  private readonly meClient = inject(MeClient);
  private readonly i18n = inject(I18nService);
  private readonly gate = inject(AgeGateService);
  private readonly session = inject(AppSessionService);

  private readonly uid = `dob-${++nextId}`;
  protected get ids() {
    const p = this.idPrefix() || this.uid;
    return {
      title: `${p}-title`,
      body: `${p}-body`,
      error: `${p}-error`,
      day: `${p}-day`,
      month: `${p}-month`,
      year: `${p}-year`,
    };
  }

  protected readonly day = signal('');
  protected readonly month = signal('');
  protected readonly year = signal('');
  protected readonly saving = signal(false);
  protected readonly problem = signal<BirthDateFormProblem | 'failed' | null>(
    null,
  );
  protected readonly order = computed<DatePart[]>(() =>
    datePartOrder(this.i18n.currentLocale()),
  );
  protected readonly months = computed(() =>
    monthNames(this.i18n.currentLocale()),
  );

  protected async submit(ev?: Event): Promise<void> {
    ev?.preventDefault();
    if (this.saving()) return;
    const parsed = birthDateFromParts(
      { day: this.day(), month: this.month(), year: this.year() },
      new Date(),
      deviceZone(),
    );
    if ('problem' in parsed) {
      this.problem.set(parsed.problem);
      return;
    }
    this.problem.set(null);
    this.saving.set(true);
    try {
      const me = await this.meClient.setBirthDate(parsed.value);
      this.gate.accept(me);
      this.saved.emit(me);
    } catch (err) {
      await this.onError(err);
    } finally {
      this.saving.set(false);
    }
  }

  private async onError(err: unknown): Promise<void> {
    if (!(err instanceof ProblemDetailsError)) {
      this.problem.set('failed');
      return;
    }
    if (err.code === 'AGE_BELOW_MINIMUM') {
      // The account is already deleted: sign out and explain.
      this.gate.reset();
      await this.session.endDeletedAccount(TOO_YOUNG_ROUTE);
      return;
    }
    if (err.code === 'BIRTH_DATE_ALREADY_SET') {
      // Set meanwhile (another device): take the server's state.
      try {
        const me = await this.meClient.me();
        this.gate.accept(me);
        this.saved.emit(me);
        return;
      } catch {
        // fall through
      }
    }
    if (err.code === 'BIRTH_DATE_INVALID') {
      const reason = (err.data as { reason?: unknown } | undefined)?.reason;
      if (reason === 'future' || reason === 'too_old' || reason === 'invalid') {
        this.problem.set(reason);
        return;
      }
    }
    this.problem.set('failed');
  }
}
