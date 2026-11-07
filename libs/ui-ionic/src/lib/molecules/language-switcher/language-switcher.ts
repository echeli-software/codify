import {
  Component,
  ChangeDetectionStrategy,
  computed,
  inject,
  input,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { I18nService, TranslatePipe, type Locale } from '@codify/i18n';
import {
  AppSelect,
  type AppSelectOption,
} from '../../atoms/app-select/app-select.js';

/**
 * Student language picker. Lists `I18nService.availableLocales` (native
 * names) and switches through `changeLocale()`, which updates
 * ngx-translate, `<html lang/dir>`, local storage and — when the app
 * provides `LOCALE_PERSISTENCE` — the user's profile (`PATCH /api/me`).
 *
 *   <cdf-language-switcher />
 */
@Component({
  selector: 'cdf-language-switcher',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, AppSelect, TranslatePipe],
  template: `
    <cdf-app-select
      [options]="options()"
      [ionLabel]="showLabel() ? ('common.language' | translate) : null"
      [ariaLabel]="'common.language' | translate"
      [interface]="interface()"
      [ngModel]="current()"
      (ngModelChange)="onChange($event)"
    />
  `,
})
export class LanguageSwitcher {
  private readonly i18n = inject(I18nService);

  readonly showLabel = input(true);
  readonly interface = input<'action-sheet' | 'alert' | 'popover'>('popover');

  protected readonly current = computed(() => this.i18n.currentLocale());
  protected readonly options = computed<AppSelectOption<Locale>[]>(() =>
    this.i18n.availableLocales.map((m) => ({
      value: m.code,
      label: m.nativeName,
    })),
  );

  protected onChange(value: Locale | null): void {
    if (value && value !== this.current()) void this.i18n.changeLocale(value);
  }
}
