import { Component, effect, inject } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { RouterModule } from '@angular/router';
import { I18nService } from '@codify/i18n';

@Component({
  imports: [RouterModule],
  selector: 'app-root',
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  constructor() {
    const i18n = inject(I18nService);
    const title = inject(Title);
    // Translated document title, kept in sync with the UI language.
    effect(() => {
      i18n.currentLocale();
      title.setTitle(i18n.t('admin.shell.brand'));
    });
  }
}
