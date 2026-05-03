import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { I18nService, TranslatePipe } from '@codify/i18n';
import {
  Avatar,
  Badge,
  Button,
  Checkbox,
  Divider,
  Icon,
  IconButton,
  Input,
  Kbd,
  ProgressBar,
  RadioGroup,
  type RadioOption,
  Select,
  type SelectOption,
  Skeleton,
  Spinner,
  Tag,
  Textarea,
  Toggle,
  Tooltip,
} from '@codify/ui-bootstrap';

type Theme = 'light' | 'dark' | 'system';
type Difficulty = '1' | '2' | '3' | '4' | '5';
type CategoryId = 'frontend' | 'mobile' | 'ai' | 'soft';

const THEME_STORAGE_KEY = 'codify.theme';

@Component({
  imports: [
    RouterModule,
    FormsModule,
    TranslatePipe,
    Avatar,
    Badge,
    Button,
    Checkbox,
    Divider,
    Icon,
    IconButton,
    Input,
    Kbd,
    ProgressBar,
    RadioGroup,
    Select,
    Skeleton,
    Spinner,
    Tag,
    Textarea,
    Toggle,
    Tooltip,
  ],
  selector: 'app-root',
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  private readonly i18n = inject(I18nService);
  protected readonly theme = signal<Theme>(this.readPersistedTheme());
  protected readonly locale = computed(() => this.i18n.currentLocale());
  protected readonly availableLocales = this.i18n.availableLocales;

  // Demo state for the atom playground.
  protected readonly nameValue = signal('Maria');
  protected readonly bioValue = signal('');
  protected readonly notifyOn = signal(true);
  protected readonly acceptTerms = signal(false);
  protected readonly tags = signal(['Frontend', 'AI', 'Soft skills']);

  protected readonly category = signal<CategoryId>('frontend');
  protected readonly categoryOptions: SelectOption<CategoryId>[] = [
    { value: 'frontend', label: 'Frontend' },
    { value: 'mobile', label: 'Mobile' },
    { value: 'ai', label: 'AI usage' },
    { value: 'soft', label: 'Soft skills' },
  ];

  protected readonly difficulty = signal<Difficulty>('3');
  protected readonly difficultyOptions: RadioOption<Difficulty>[] = [
    { value: '1', label: 'Iniciante' },
    { value: '2', label: 'Básico' },
    { value: '3', label: 'Intermediário' },
    { value: '4', label: 'Avançado' },
    { value: '5', label: 'Expert' },
  ];

  protected readonly progressValue = signal(72);

  constructor() {
    this.applyTheme(this.theme());
  }

  protected setTheme(value: Theme): void {
    this.theme.set(value);
    this.applyTheme(value);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, value);
    } catch {
      /* private browsing — ignore */
    }
  }

  protected setLocale(value: string): void {
    if (value === 'pt-BR' || value === 'en-US') {
      this.i18n.setLocale(value);
    }
  }

  protected removeTag(tag: string): void {
    this.tags.update((list) => list.filter((t) => t !== tag));
  }

  private applyTheme(theme: Theme): void {
    const root = document.documentElement;
    root.classList.remove('theme-light', 'theme-dark');
    if (theme === 'light') root.classList.add('theme-light');
    if (theme === 'dark') root.classList.add('theme-dark');
  }

  private readPersistedTheme(): Theme {
    try {
      const v = localStorage.getItem(THEME_STORAGE_KEY);
      if (v === 'light' || v === 'dark' || v === 'system') return v;
    } catch {
      /* ignore */
    }
    return 'system';
  }
}
