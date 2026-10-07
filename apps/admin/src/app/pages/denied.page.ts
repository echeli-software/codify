import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { I18nService, TranslatePipe } from '@codify/i18n';
import { AuthService } from '@codify/auth';
import { Button, EmptyState } from '@codify/ui-bootstrap';
import { ADMIN_NAV, SECTION_ROLES, type AdminSection } from '../core/roles';

/**
 * Permission-denied state inside the shell (docs/04 §9): explains which
 * role the section needs. Reached via `sectionGuard` → `/denied?section=`.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Button, EmptyState, RouterLink, TranslatePipe],
  template: `
    <div class="admin-page admin-page--narrow">
      <cdf-empty-state
        icon="lock"
        [title]="'admin.denied.title' | translate"
        [description]="message()"
      >
        <cdf-button kind="primary" routerLink="/dashboard">
          {{ 'admin.denied.home' | translate }}
        </cdf-button>
      </cdf-empty-state>
    </div>
  `,
})
export class DeniedPage {
  /** Query param bound by `withComponentInputBinding()`. */
  readonly section = input<string | undefined>();
  private readonly i18n = inject(I18nService);
  private readonly auth = inject(AuthService);

  protected readonly message = computed(() => {
    this.i18n.currentLocale();
    const key = this.section() as AdminSection | undefined;
    const roles = key && SECTION_ROLES[key] ? SECTION_ROLES[key] : [];
    const entry = ADMIN_NAV.flatMap((g) => g.items).find(
      (i) => i.section === key,
    );
    const role = this.auth.role();
    return this.i18n.t('admin.denied.description', {
      section: entry ? this.i18n.t(entry.labelKey) : (key ?? ''),
      roles: roles.map((r) => this.i18n.t(`admin.roles.${r}`)).join(', '),
      role: role ? this.i18n.t(`admin.roles.${role}`) : '',
    });
  });
}
