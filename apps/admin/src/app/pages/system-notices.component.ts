import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { I18nService, LocalePipe, TranslatePipe } from '@codify/i18n';
import {
  Button,
  ConfirmDialogService,
  FormField,
  Input,
  ToastService,
} from '@codify/ui-bootstrap';
import { StaffToolsClient, type TermsAnnouncement } from '@codify/api-client';
import { AdminErrors } from '../core/errors';

/** Version ids the API accepts (TermsUpdateDto). */
export const TERMS_VERSION_RE = /^[A-Za-z0-9._-]{1,40}$/;

/**
 * Settings → SYSTEM announcements (docs/10 §3, ADMIN): notify every active
 * account that the Terms of Use / Privacy Policy changed. One send per
 * version (re-sending resumes, nobody gets it twice); the version is typed
 * back to confirm. Progress is polled from the API.
 *
 *   <cdf-system-notices />
 */
@Component({
  selector: 'cdf-system-notices',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, Button, FormField, Input, LocalePipe, TranslatePipe],
  template: `
    <section
      class="admin-card"
      aria-labelledby="notices-title"
      data-testid="system-notices"
    >
      <h2 id="notices-title">
        {{ 'admin.staff.notices.title' | translate }}
      </h2>
      <p class="muted small">
        {{ 'admin.staff.notices.subtitle' | translate }}
      </p>
      <form class="notices" (submit)="announce($event)">
        <cdf-form-field
          [label]="'admin.staff.notices.version' | translate"
          [help]="'admin.staff.notices.versionHelp' | translate"
          [error]="versionError()"
          controlId="terms-version"
        >
          <cdf-input
            inputId="terms-version"
            name="version"
            [(ngModel)]="version"
          />
        </cdf-form-field>
        <cdf-form-field
          [label]="'admin.staff.notices.effectiveDate' | translate"
          controlId="terms-date"
        >
          <input
            id="terms-date"
            class="form-control"
            name="effectiveDate"
            type="date"
            [(ngModel)]="effectiveDate"
          />
        </cdf-form-field>
        <cdf-button
          kind="danger"
          type="submit"
          [loading]="busy()"
          data-testid="announce-terms"
          >{{ 'admin.staff.notices.send' | translate }}</cdf-button
        >
      </form>
      @if (status(); as st) {
        <p class="small" role="status" data-testid="notice-status">
          {{
            (st.running
              ? 'admin.staff.notices.running'
              : 'admin.staff.notices.done'
            )
              | translate
                : {
                    version: st.version,
                    notified: (st.notified | locale: 'integer'),
                    audience: (st.audience | locale: 'integer'),
                  }
          }}
        </p>
      }
    </section>
  `,
  styles: [
    `
      h2 {
        font-size: 1.125rem;
      }
      .notices {
        display: flex;
        flex-wrap: wrap;
        align-items: flex-end;
        gap: var(--cdf-space-3);
      }
      .notices cdf-form-field {
        flex: 1 1 220px;
      }
    `,
  ],
})
export class SystemNoticesComponent {
  private readonly staff = inject(StaffToolsClient);
  private readonly confirm = inject(ConfirmDialogService);
  private readonly i18n = inject(I18nService);
  private readonly toast = inject(ToastService);
  private readonly errors = inject(AdminErrors);

  protected version = new Date().toISOString().slice(0, 10);
  protected effectiveDate = '';
  protected readonly busy = signal(false);
  protected readonly versionError = signal<string | null>(null);
  protected readonly status = signal<TermsAnnouncement | null>(null);
  private polls = 0;

  protected async announce(ev: Event): Promise<void> {
    ev.preventDefault();
    const version = this.version.trim();
    if (!TERMS_VERSION_RE.test(version)) {
      this.versionError.set(this.i18n.t('admin.staff.notices.invalidVersion'));
      return;
    }
    this.versionError.set(null);
    const ok = await this.confirm.open({
      title: this.i18n.t('admin.staff.notices.confirmTitle'),
      message: this.i18n.t('admin.staff.notices.confirmMessage', { version }),
      confirmLabel: this.i18n.t('admin.staff.notices.send'),
      confirmKind: 'danger',
      typeToConfirm: version,
    });
    if (!ok) return;
    this.busy.set(true);
    try {
      const iso = /^\d{4}-\d{2}-\d{2}$/.test(this.effectiveDate)
        ? `${this.effectiveDate}T00:00:00.000Z`
        : null;
      this.status.set(
        await this.staff.announceTerms({
          version,
          ...(iso ? { effectiveDate: iso } : {}),
          confirm: 'NOTIFY ALL USERS',
        }),
      );
      this.toast.success(this.i18n.t('admin.staff.notices.started'));
      this.polls = 0;
      this.poll(version);
    } catch (err) {
      this.errors.toast(err, 'admin.errors.actionFailed');
    } finally {
      this.busy.set(false);
    }
  }

  /** Refresh the counts a few times while the background run goes on. */
  private poll(version: string): void {
    if (this.polls++ > 20) return;
    setTimeout(async () => {
      try {
        const st = await this.staff.termsStatus(version);
        this.status.set(st);
        if (st.running) this.poll(version);
      } catch {
        /* keep the last status */
      }
    }, 2000);
  }
}
