import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { TranslatePipe } from '@codify/i18n';
import {
  Avatar,
  Badge,
  BreadcrumbBar,
  type BreadcrumbCrumb,
  Button,
  Checkbox,
  ConfirmDialogService,
  Divider,
  EmptyState,
  FormField,
  Icon,
  IconButton,
  Input,
  Kbd,
  KeyValueList,
  type KeyValueRow,
  LanguageSwitcher,
  Pagination,
  PriceTag,
  ProgressBar,
  RadioGroup,
  type RadioOption,
  SearchBar,
  Select,
  type SelectOption,
  Skeleton,
  Spinner,
  Tag,
  Textarea,
  ThemeToggle,
  ToastHost,
  ToastService,
  Toggle,
  Tooltip,
} from '@codify/ui-bootstrap';

type Difficulty = '1' | '2' | '3' | '4' | '5';
type CategoryId = 'frontend' | 'mobile' | 'ai' | 'soft';
type ToastVariant = 'success' | 'error' | 'info' | 'warn';

@Component({
  imports: [
    RouterModule,
    FormsModule,
    TranslatePipe,
    // atoms
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
    // molecules
    BreadcrumbBar,
    EmptyState,
    FormField,
    KeyValueList,
    LanguageSwitcher,
    Pagination,
    PriceTag,
    SearchBar,
    ThemeToggle,
    ToastHost,
  ],
  selector: 'app-root',
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  private readonly toasts = inject(ToastService);
  private readonly confirmService = inject(ConfirmDialogService);

  // Form state
  protected readonly nameValue = signal('Maria');
  protected readonly bioValue = signal('');
  protected readonly emailValue = signal('');
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
  protected readonly currentPage = signal(3);
  protected readonly totalPages = signal(12);

  // Form-field demo
  protected readonly emailError = signal<string | null>(null);

  // Search demo
  protected readonly searchQuery = signal('');

  // Detail panel demo
  protected readonly courseRows: KeyValueRow[] = [
    { key: 'Author', value: 'Maria Souza' },
    { key: 'Source locale', value: 'pt-BR' },
    { key: 'Difficulty', value: 'Intermediário' },
    { key: 'Lessons', value: 12 },
    { key: 'Duration', value: '~3h', hint: 'estimated' },
    { key: 'Status', value: 'Published' },
  ];

  protected readonly crumbs: BreadcrumbCrumb[] = [
    { label: 'Catalog', routerLink: ['/'] },
    { label: 'Courses', routerLink: ['/'] },
    { label: 'React Fundamentals' },
  ];

  protected removeTag(tag: string): void {
    this.tags.update((list) => list.filter((t) => t !== tag));
  }

  protected validateEmail(): void {
    const v = this.emailValue();
    this.emailError.set(
      v.length === 0 ? 'Email is required' : !v.includes('@') ? 'Looks invalid' : null,
    );
  }

  protected onSearch(query: string): void {
    this.searchQuery.set(query);
  }

  protected showToast(variant: ToastVariant): void {
    const messages: Record<ToastVariant, string> = {
      success: 'Course saved.',
      error: 'Could not connect to the server.',
      info: 'Translation completeness updated.',
      warn: 'You have unsynced changes.',
    };
    this.toasts[variant](messages[variant], {
      title: variant.charAt(0).toUpperCase() + variant.slice(1),
      actionLabel: variant === 'error' ? 'Retry' : undefined,
      onAction: () => this.toasts.info('Retried'),
    });
  }

  protected async confirmDelete(): Promise<void> {
    const ok = await this.confirmService.open({
      title: 'Delete this course?',
      message: 'This action cannot be undone. All lessons and progress will be lost.',
      confirmLabel: 'Delete',
      cancelLabel: 'Keep',
      confirmKind: 'danger',
      icon: 'warning',
      typeToConfirm: 'react-fundamentals',
    });
    if (ok) this.toasts.success('Course deleted (demo).');
  }
}
