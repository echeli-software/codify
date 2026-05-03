import { Component, computed, inject, signal } from '@angular/core';
import {
  Badge,
  BreadcrumbBar,
  type BreadcrumbCrumb,
  Button,
  ConfirmDialogService,
  DataTable,
  DataTableCell,
  type DataTableColumn,
  EmptyState,
  Icon,
  IconButton,
  Pagination,
  SearchBar,
  ToastService,
} from '@codify/ui-bootstrap';

interface CourseRow {
  id: string;
  title: string;
  author: string;
  category: string;
  status: 'draft' | 'published' | 'archived';
  lessons: number;
  updatedAt: string;
}

const SAMPLE_ROWS: CourseRow[] = [
  { id: 'c1', title: 'React Fundamentals',          author: 'Maria S.', category: 'Frontend',     status: 'published', lessons: 12, updatedAt: '2026-04-28' },
  { id: 'c2', title: 'Capybara Capybara',            author: 'João P.',  category: 'Soft skills',  status: 'draft',     lessons: 3,  updatedAt: '2026-04-30' },
  { id: 'c3', title: 'Prompt engineering with AI',   author: 'Ana T.',   category: 'AI usage',     status: 'published', lessons: 8,  updatedAt: '2026-05-01' },
  { id: 'c4', title: 'Capacitor for Angular devs',   author: 'Lucas K.', category: 'Mobile',       status: 'published', lessons: 10, updatedAt: '2026-04-22' },
  { id: 'c5', title: 'Reading code reviews',         author: 'Priya M.', category: 'Soft skills',  status: 'archived',  lessons: 5,  updatedAt: '2026-03-15' },
];

@Component({
  imports: [
    Badge,
    BreadcrumbBar,
    Button,
    DataTable,
    DataTableCell,
    EmptyState,
    Icon,
    IconButton,
    Pagination,
    SearchBar,
  ],
  templateUrl: './courses.page.html',
  styleUrl: './courses.page.scss',
})
export class CoursesPage {
  private readonly toasts = inject(ToastService);
  private readonly confirm = inject(ConfirmDialogService);

  protected readonly query = signal('');
  protected readonly page = signal(1);
  protected readonly pageSize = 4;
  protected readonly selected = signal<(string | number)[]>([]);

  protected readonly crumbs: BreadcrumbCrumb[] = [
    { label: 'Catalog', routerLink: ['/'] },
    { label: 'Courses' },
  ];

  protected readonly columns: DataTableColumn<CourseRow>[] = [
    { key: 'title',    label: 'Title',    value: (r) => r.title, sortable: true },
    { key: 'author',   label: 'Author',   value: (r) => r.author, sortable: true },
    { key: 'category', label: 'Category', value: (r) => r.category, sortable: true },
    { key: 'status',   label: 'Status',   value: (r) => r.status, sortable: true, width: '120px' },
    { key: 'lessons',  label: 'Lessons',  value: (r) => r.lessons, sortable: true, width: '90px', align: 'end' },
    { key: 'updatedAt', label: 'Updated', value: (r) => r.updatedAt, sortable: true, width: '120px' },
  ];

  protected readonly filtered = computed(() => {
    const q = this.query().toLowerCase();
    if (!q) return SAMPLE_ROWS;
    return SAMPLE_ROWS.filter(
      (r) =>
        r.title.toLowerCase().includes(q) ||
        r.author.toLowerCase().includes(q) ||
        r.category.toLowerCase().includes(q),
    );
  });

  protected readonly totalPages = computed(() =>
    Math.max(1, Math.ceil(this.filtered().length / this.pageSize)),
  );

  protected readonly visible = computed(() => {
    const start = (this.page() - 1) * this.pageSize;
    return this.filtered().slice(start, start + this.pageSize);
  });

  protected statusVariant(status: CourseRow['status']): 'success' | 'warning' | 'neutral' {
    if (status === 'published') return 'success';
    if (status === 'draft') return 'warning';
    return 'neutral';
  }

  protected onSearch(q: string): void {
    this.query.set(q);
    this.page.set(1);
  }

  protected async deleteRow(row: CourseRow): Promise<void> {
    const ok = await this.confirm.open({
      title: `Delete "${row.title}"?`,
      message: 'This action cannot be undone.',
      confirmKind: 'danger',
      confirmLabel: 'Delete',
      icon: 'warning',
      typeToConfirm: row.title,
    });
    if (ok) this.toasts.success(`Deleted ${row.title} (demo).`);
  }

  protected onSelectionChange(ids: (string | number)[]): void {
    this.selected.set(ids);
  }
}
