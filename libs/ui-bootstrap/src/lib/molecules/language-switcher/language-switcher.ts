import {
  Component,
  ChangeDetectionStrategy,
  computed,
  inject,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { I18nService, TranslatePipe, type Locale } from '@codify/i18n';
import { Select, type SelectOption } from '../../atoms/select/select.js';

/**
 * Drop-in language switcher used in app shells. Pulls the supported locales
 * from I18nService so adding a new locale anywhere automatically lights it
 * up here. Switching goes through `I18nService.changeLocale()`, which also
 * persists the choice server-side when the app provides `LOCALE_PERSISTENCE`.
 */
@Component({
  selector: 'cdf-language-switcher',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, Select, TranslatePipe],
  template: `
    <cdf-select
      class="cdf-language-switcher"
      size="sm"
      [ariaLabel]="'common.language' | translate"
      [options]="options()"
      [ngModel]="current()"
      (ngModelChange)="onChange($event)"
    />
  `,
  styleUrl: './language-switcher.scss',
})
export class LanguageSwitcher {
  private readonly i18n = inject(I18nService);

  protected readonly current = computed(() => this.i18n.currentLocale());
  protected readonly options = computed<SelectOption<Locale>[]>(() =>
    this.i18n.availableLocales.map((m) => ({
      value: m.code,
      label: m.nativeName,
    })),
  );

  protected onChange(value: Locale | null): void {
    if (value && value !== this.current()) void this.i18n.changeLocale(value);
  }
}
