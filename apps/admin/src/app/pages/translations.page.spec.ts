import { TestBed } from '@angular/core/testing';
import {
  ActivatedRoute,
  convertToParamMap,
  provideRouter,
} from '@angular/router';
import { ContentTranslationService, provideI18n } from '@codify/i18n';
import { ToastService } from '@codify/ui-bootstrap';
import {
  TranslationsClient,
  type TranslationCompleteness,
  type TranslationRow,
} from '@codify/api-client';
import {
  TranslationsPage,
  buildUpserts,
  fileFormat,
  problemsOf,
  rowKey,
} from './translations.page';
import { ProblemDetailsError } from '@codify/api-client';

const row = (over: Partial<TranslationRow> = {}): TranslationRow => ({
  entityType: 'PLAN',
  entityId: 'p1',
  label: 'Plano Completo',
  field: 'name',
  sourceLocale: 'pt-BR',
  sourceValue: 'Plano Completo',
  locale: 'en-US',
  value: 'Complete Plan',
  outdated: true,
  status: 'outdated',
  updatedAt: '2026-11-01T00:00:00.000Z',
  ...over,
});

const counts = (translated: number, total: number) => ({
  total,
  translated,
  outdated: 0,
  pct: total ? Math.round((translated / total) * 1000) / 10 : 100,
});

function completeness(): TranslationCompleteness {
  const perType = {
    COURSE: counts(1, 2),
    MODULE: counts(0, 0),
    LESSON: counts(0, 0),
    CATEGORY: counts(0, 0),
    PLAN: counts(1, 3),
    BADGE: counts(2, 2),
    ITEM: counts(0, 4),
    ITEM_CATEGORY: counts(1, 1),
    QUEST: counts(0, 1),
    ALL: counts(5, 13),
  };
  return { locales: { 'en-US': perType }, entities: [] };
}

describe('TranslationsPage — platform entities', () => {
  async function setup() {
    const rows = [
      row(),
      row({
        entityType: 'ITEM_CATEGORY',
        entityId: 'hats',
        label: 'Chapéus',
        sourceValue: 'Chapéus',
        value: null,
        outdated: false,
        status: 'missing',
        updatedAt: null,
      }),
      row({
        entityType: 'QUEST',
        entityId: 'q1',
        label: 'Complete duas aulas',
        field: 'title',
        sourceValue: 'Complete duas aulas',
        value: null,
        outdated: false,
        status: 'missing',
        updatedAt: null,
      }),
    ];
    const client = {
      list: jest.fn().mockResolvedValue({ items: rows, total: rows.length }),
      completeness: jest.fn().mockResolvedValue(completeness()),
      upsert: jest.fn().mockResolvedValue({ updated: 2 }),
      markComplete: jest.fn().mockResolvedValue({ completed: 1 }),
      exportFile: jest.fn(),
      importFile: jest.fn().mockResolvedValue({
        dryRun: true,
        imported: 0,
        valid: 1,
        skipped: 0,
        errors: [],
        sourceChanged: [],
      }),
    };
    await TestBed.configureTestingModule({
      imports: [TranslationsPage],
      providers: [
        provideRouter([]),
        provideI18n(),
        { provide: TranslationsClient, useValue: client },
        {
          provide: ContentTranslationService,
          useValue: { invalidate: jest.fn() },
        },
        {
          provide: ToastService,
          useValue: { success: jest.fn(), error: jest.fn() },
        },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(TranslationsPage);
    fixture.detectChanges();
    await new Promise((r) => setTimeout(r, 0));
    fixture.detectChanges();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const page = fixture.componentInstance as any;
    return { fixture, page, client, rows };
  }

  it('offers every content type in the filter and the completeness table', async () => {
    const { fixture, page } = await setup();
    const values = page.typeOptions().map((o: { value: string }) => o.value);
    expect(values).toEqual([
      '',
      'COURSE',
      'MODULE',
      'LESSON',
      'CATEGORY',
      'PLAN',
      'BADGE',
      'ITEM',
      'ITEM_CATEGORY',
      'QUEST',
    ]);
    const el: HTMLElement = fixture.nativeElement;
    const heads = Array.from(el.querySelectorAll('thead th')).map((th) =>
      th.textContent?.trim(),
    );
    expect(heads).toEqual([
      'Locale',
      'Courses',
      'Modules',
      'Lessons',
      'Categories',
      'Plans',
      'Badges',
      'Shop items',
      'Item categories',
      'Quests',
      'All',
    ]);
    expect(el.textContent).toContain('1/3 done');
  });

  it('filters by a new type', async () => {
    const { page, client } = await setup();
    page.setFilter('type', 'ITEM_CATEGORY');
    await new Promise((r) => setTimeout(r, 0));
    expect(client.list).toHaveBeenLastCalledWith(
      expect.objectContaining({ entityType: 'ITEM_CATEGORY' }),
    );
  });

  it('shows the source next to the translation with the outdated badge', async () => {
    const { fixture, rows } = await setup();
    const el: HTMLElement = fixture.nativeElement;
    const plan = el.querySelector(`[data-row="${rowKey(rows[0])}"]`);
    expect(plan?.textContent).toContain('Plans');
    expect(plan?.textContent).toContain('Source changed');
    expect(plan?.querySelector('.source')?.textContent).toBe('Plano Completo');
    expect((plan?.querySelector('textarea') as HTMLTextAreaElement).value).toBe(
      'Complete Plan',
    );
    const quest = el.querySelector(`[data-row="${rowKey(rows[2])}"]`);
    expect(quest?.textContent).toContain('Quests');
    expect(quest?.textContent).toContain('Title');
  });

  it('bulk-saves edits across the new types', async () => {
    const { page, client, rows } = await setup();
    page.edit(rows[1], 'Hats');
    page.edit(rows[2], 'Complete two lessons');
    expect(page.pendingCount()).toBe(2);
    await page.saveAll();
    expect(client.upsert).toHaveBeenCalledWith([
      {
        entityType: 'ITEM_CATEGORY',
        entityId: 'hats',
        field: 'name',
        locale: 'en-US',
        value: 'Hats',
      },
      {
        entityType: 'QUEST',
        entityId: 'q1',
        field: 'title',
        locale: 'en-US',
        value: 'Complete two lessons',
      },
    ]);
  });

  it('buildUpserts skips unchanged and blank values', () => {
    const r = row();
    expect(buildUpserts([r], new Map([[rowKey(r), 'Complete Plan']]))).toEqual(
      [],
    );
    expect(buildUpserts([r], new Map([[rowKey(r), '  ']]))).toEqual([]);
  });
});

describe('TranslationsPage — import / export / mark complete (AUT-8)', () => {
  it('detects file formats and reads problem lists', () => {
    expect(fileFormat({ name: 'x.CSV', type: '' })).toBe('csv');
    expect(fileFormat({ name: 'x', type: 'application/json' })).toBe('json');
    expect(fileFormat({ name: 'x.xlsx', type: '' })).toBeNull();
    const err = new ProblemDetailsError({
      status: 400,
      data: { problems: ['items[0].value content: Expected 3 block(s)'] },
    } as never);
    expect(problemsOf(err)).toEqual([
      'items[0].value content: Expected 3 block(s)',
    ]);
    expect(problemsOf(new Error('x'))).toEqual([]);
  });

  async function mount() {
    const client = {
      list: jest.fn().mockResolvedValue({
        items: [
          {
            entityType: 'COURSE',
            entityId: 'c1',
            label: 'Fundamentos',
            field: 'title',
            sourceLocale: 'pt-BR',
            sourceValue: 'Fundamentos',
            locale: 'en-US',
            value: 'Basics',
            outdated: true,
            status: 'outdated',
            updatedAt: null,
          },
        ],
        total: 1,
      }),
      completeness: jest.fn().mockResolvedValue({
        locales: {},
        entities: [
          {
            entityType: 'COURSE',
            entityId: 'c1',
            label: 'Fundamentos',
            locale: 'en-US',
            total: 2,
            translated: 1,
            outdated: 1,
            pct: 50,
          },
        ],
      }),
      upsert: jest.fn(),
      markComplete: jest.fn().mockResolvedValue({ completed: 1 }),
      exportFile: jest.fn(),
      importFile: jest.fn().mockResolvedValue({
        dryRun: true,
        imported: 0,
        valid: 1,
        skipped: 0,
        errors: [],
        sourceChanged: [],
      }),
    };
    await TestBed.configureTestingModule({
      imports: [TranslationsPage],
      providers: [
        provideRouter([]),
        provideI18n(),
        { provide: TranslationsClient, useValue: client },
        {
          provide: ContentTranslationService,
          useValue: { invalidate: jest.fn() },
        },
        {
          provide: ToastService,
          useValue: { success: jest.fn(), error: jest.fn() },
        },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(TranslationsPage);
    fixture.detectChanges();
    await new Promise((r) => setTimeout(r, 0));
    fixture.detectChanges();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { fixture, client, page: fixture.componentInstance as any };
  }

  afterEach(() => TestBed.resetTestingModule());

  it('shows per-entity completeness and marks an outdated row complete', async () => {
    const { fixture, client } = await mount();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.textContent).toContain('Entity 50% translated');
    el.querySelector<HTMLElement>(
      '[data-testid="mark-complete"] button, [data-testid="mark-complete"]',
    )!.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(client.markComplete).toHaveBeenCalledWith([
      { entityType: 'COURSE', entityId: 'c1', field: 'title', locale: 'en-US' },
    ]);
  });

  it('needs an entity type, then dry-runs a picked file and imports it', async () => {
    const { fixture, client, page } = await mount();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[data-testid="import-file"]')).toBeNull();
    page.setFilter('type', 'COURSE');
    await new Promise((r) => setTimeout(r, 0));
    fixture.detectChanges();
    const file = {
      name: 'tr.csv',
      type: 'text/csv',
      text: async () => 'entityId,locale,field,sourceValue,translatedValue',
    };
    await page.pickFile({ target: { files: [file] } });
    fixture.detectChanges();
    expect(client.importFile).toHaveBeenLastCalledWith(
      expect.objectContaining({
        entityType: 'COURSE',
        format: 'csv',
        dryRun: true,
      }),
    );
    expect(
      el.querySelector('[data-testid="import-report"]')?.textContent,
    ).toContain('1 row ready to import');
    client.importFile.mockResolvedValueOnce({
      dryRun: false,
      imported: 1,
      valid: 1,
      skipped: 0,
      errors: [],
      sourceChanged: [],
    });
    await page.runImport();
    expect(client.importFile).toHaveBeenLastCalledWith(
      expect.objectContaining({ dryRun: false }),
    );
  });
});

describe('TranslationsPage — deep link filters', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('initialises entity type + search from the query string', async () => {
    const client = {
      list: jest.fn().mockResolvedValue({ items: [], total: 0 }),
      completeness: jest.fn().mockResolvedValue({ locales: {}, entities: [] }),
    };
    await TestBed.configureTestingModule({
      imports: [TranslationsPage],
      providers: [
        provideRouter([]),
        provideI18n(),
        { provide: TranslationsClient, useValue: client },
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              queryParamMap: convertToParamMap({
                entityType: 'LESSON',
                q: 'signals',
                status: 'missing',
              }),
            },
          },
        },
        {
          provide: ContentTranslationService,
          useValue: { invalidate: jest.fn() },
        },
        {
          provide: ToastService,
          useValue: { success: jest.fn(), error: jest.fn() },
        },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(TranslationsPage);
    fixture.detectChanges();
    await new Promise((r) => setTimeout(r, 300));
    expect(client.list).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'LESSON',
        q: 'signals',
        status: 'missing',
      }),
    );
    // The search bar echoing the deep-linked query doesn't refetch.
    expect(client.list).toHaveBeenCalledTimes(1);
    expect(
      (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>(
        'input[type="search"]',
      )?.value,
    ).toBe('signals');
  });
});
