import { BadRequestException } from '@nestjs/common';
import { kitchenSinkLessonDoc, type LessonDoc } from '@codify/lesson-schema';
import {
  parseCsv,
  parseImportFile,
  toCsv,
  toJsonExport,
} from './translations-io.js';
import type { TranslationWorkRow } from './translations.logic.js';
import { TranslationsService } from './translations.service.js';

const row = (over: Partial<TranslationWorkRow> = {}): TranslationWorkRow => ({
  entityType: 'COURSE',
  entityId: 'c1',
  label: 'Fundamentos',
  field: 'title',
  sourceLocale: 'pt-BR',
  sourceValue: 'Fundamentos, "básico"',
  locale: 'en-US',
  value: null,
  outdated: false,
  status: 'missing',
  updatedAt: null,
  ...over,
});

describe('translation files', () => {
  it('CSV round-trips quotes, commas, newlines and guards formulas', () => {
    const csv = toCsv([
      row(),
      row({ entityId: 'c2', sourceValue: 'line 1\nline 2', value: '=SUM(A1)' }),
    ]);
    expect(csv.split('\r\n')[0]).toBe(
      'entityId,locale,field,sourceValue,translatedValue',
    );
    expect(csv).toContain(`"'=SUM(A1)"`);
    const table = parseCsv(csv);
    expect(table[1]).toEqual([
      'c1',
      'en-US',
      'title',
      'Fundamentos, "básico"',
      '',
    ]);
    const { rows, errors } = parseImportFile('csv', csv);
    expect(errors).toEqual([]);
    expect(rows[1]).toMatchObject({
      row: 3,
      entityId: 'c2',
      sourceValue: 'line 1\nline 2',
      translatedValue: '=SUM(A1)',
    });
  });

  it('reports structural CSV problems per row', () => {
    expect(
      parseImportFile('csv', 'entityId,field\nx,y').errors[0].message,
    ).toMatch(/Missing columns: locale, translatedValue/);
    const bad = parseImportFile(
      'csv',
      'entityId,locale,field,sourceValue,translatedValue\r\nc1,en-US,title\r\n',
    );
    expect(bad.errors).toEqual([
      { row: 2, message: 'Expected 5 columns, found 3' },
    ]);
    expect(parseImportFile('csv', '"open').errors[0].message).toMatch(
      /Unterminated/,
    );
  });

  it('JSON export / import', () => {
    const json = toJsonExport('COURSE', 'en-US', [row({ value: 'Basics' })]);
    const parsed = parseImportFile('json', json);
    expect(parsed.errors).toEqual([]);
    expect(parsed.rows[0]).toMatchObject({
      row: 1,
      entityId: 'c1',
      locale: 'en-US',
      field: 'title',
      translatedValue: 'Basics',
    });
    expect(
      parseImportFile('json', '{"rows":[{"field":1}]}').errors,
    ).toHaveLength(1);
    expect(parseImportFile('json', 'nope').errors[0].message).toBe(
      'Not valid JSON',
    );
  });
});

/** In-memory prisma for one LESSON + one COURSE. */
function fakePrisma(source: LessonDoc) {
  const translations: {
    entityType: string;
    entityId: string;
    locale: string;
    field: string;
    value: string;
    outdated: boolean;
    updatedAt: Date;
  }[] = [
    {
      entityType: 'LESSON',
      entityId: 'l1',
      locale: 'pt-BR',
      field: 'title',
      value: 'Sinais',
      outdated: false,
      updatedAt: new Date(),
    },
    {
      entityType: 'COURSE',
      entityId: 'c1',
      locale: 'pt-BR',
      field: 'title',
      value: 'Fundamentos',
      outdated: false,
      updatedAt: new Date(),
    },
  ];
  type Where = {
    entityType?: string;
    entityId?: string | { in: string[] };
    field?: string | { in: string[] };
    locale?: string;
    OR?: Where[];
  };
  const match = (t: (typeof translations)[number], w: Where): boolean => {
    if (w.OR) return w.OR.some((o) => match(t, o));
    const eq = (v: unknown, x: string) =>
      v === undefined ||
      (typeof v === 'object' && v && 'in' in v
        ? (v as { in: string[] }).in.includes(x)
        : v === x);
    return (
      eq(w.entityType, t.entityType) &&
      eq(w.entityId, t.entityId) &&
      eq(w.field, t.field) &&
      eq(w.locale, t.locale)
    );
  };
  const key = (w: {
    entityType: string;
    entityId: string;
    locale: string;
    field: string;
  }) =>
    translations.find(
      (t) =>
        t.entityType === w.entityType &&
        t.entityId === w.entityId &&
        t.locale === w.locale &&
        t.field === w.field,
    );
  const prisma = {
    translations,
    lesson: {
      findMany: jest.fn(async () => [
        {
          id: 'l1',
          order: 0,
          contentJson: source,
          module: { course: { sourceLocale: 'pt-BR', slug: 'demo' } },
        },
      ]),
    },
    course: {
      findMany: jest.fn(async () => [
        { id: 'c1', slug: 'c1', sourceLocale: 'pt-BR' },
      ]),
    },
    contentTranslation: {
      findMany: jest.fn(async ({ where }: { where: Where }) =>
        translations.filter((t) => match(t, where)),
      ),
      upsert: jest.fn(
        (args: {
          where: {
            entityType_entityId_locale_field: Parameters<typeof key>[0];
          };
          create: Omit<
            (typeof translations)[number],
            'outdated' | 'updatedAt'
          > &
            Partial<
              Pick<(typeof translations)[number], 'outdated' | 'updatedAt'>
            >;
          update: Partial<(typeof translations)[number]>;
        }) => {
          const hit = key(args.where.entityType_entityId_locale_field);
          if (hit) Object.assign(hit, args.update);
          else
            translations.push({
              ...args.create,
              outdated: args.create.outdated ?? false,
              updatedAt: args.create.updatedAt ?? new Date(),
            });
          return 'op';
        },
      ),
      update: jest.fn(
        (args: {
          where: {
            entityType_entityId_locale_field: Parameters<typeof key>[0];
          };
          data: { outdated: boolean };
        }) => {
          Object.assign(
            key(args.where.entityType_entityId_locale_field) ?? {},
            args.data,
          );
          return 'op';
        },
      ),
    },
    $transaction: jest.fn(async (ops: unknown[]) => ops),
  };
  return prisma;
}

function translated(source: LessonDoc): LessonDoc {
  const d = JSON.parse(JSON.stringify(source)) as LessonDoc;
  const i = d.content.findIndex((b) => b.type === 'paragraph');
  d.content[i] = {
    type: 'paragraph',
    content: [{ type: 'text', text: 'Hello' }],
  };
  return d;
}

async function rejection(p: Promise<unknown>): Promise<BadRequestException> {
  try {
    await p;
  } catch (e) {
    return e as BadRequestException;
  }
  throw new Error('expected rejection');
}

describe('TranslationsService — lesson bodies (FIX-6)', () => {
  const source = kitchenSinkLessonDoc();

  it('stores a valid, structure-preserving body (whitelisted)', async () => {
    const prisma = fakePrisma(source);
    const svc = new TranslationsService(prisma as never);
    const doc = { ...translated(source), junk: true };
    await svc.upsert([
      {
        entityType: 'LESSON',
        entityId: 'l1',
        field: 'contentJson',
        locale: 'en-US',
        value: JSON.stringify(doc),
      },
    ]);
    const stored = prisma.translations.find((t) => t.field === 'contentJson');
    expect(stored?.value).toContain('Hello');
    expect(stored?.value).not.toContain('junk');
  });

  it('rejects schema-invalid and restructured bodies with a problem list', async () => {
    const prisma = fakePrisma(source);
    const svc = new TranslationsService(prisma as never);
    const restructured = translated(source);
    restructured.content = restructured.content.filter(
      (b) => b.type !== 'quiz',
    );
    restructured.content[0] = { type: 'horizontalRule' };
    const err = await rejection(
      svc.upsert([
        {
          entityType: 'LESSON',
          entityId: 'l1',
          field: 'contentJson',
          locale: 'en-US',
          value: JSON.stringify(restructured),
        },
        {
          entityType: 'LESSON',
          entityId: 'l1',
          field: 'contentJson',
          locale: 'en-US',
          value: JSON.stringify({
            type: 'doc',
            version: 1,
            content: [{ type: 'x' }],
          }),
        },
      ]),
    );
    expect(err).toBeInstanceOf(BadRequestException);
    const problems = (err.getResponse() as { errors: string[] }).errors;
    expect(problems).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^items\[0\]\.value content: Expected \d+ block/),
        expect.stringMatching(/^items\[0\]\.value content\.0\.type:/),
        expect.stringMatching(/^items\[1\]\.value content\.0\.type:/),
      ]),
    );
    expect(prisma.contentTranslation.upsert).not.toHaveBeenCalled();
  });
});

describe('TranslationsService — mark complete', () => {
  it('clears outdated without touching the text; refuses missing rows', async () => {
    const prisma = fakePrisma(kitchenSinkLessonDoc());
    prisma.translations.push({
      entityType: 'COURSE',
      entityId: 'c1',
      locale: 'en-US',
      field: 'title',
      value: 'Basics',
      outdated: true,
      updatedAt: new Date(),
    });
    const svc = new TranslationsService(prisma as never);
    const ref = {
      entityType: 'COURSE' as const,
      entityId: 'c1',
      locale: 'en-US',
      field: 'title',
    };
    expect(await svc.markComplete([ref])).toEqual({
      completed: 1,
      keys: ['COURSE:c1:en-US:title'],
    });
    const t = prisma.translations.find((x) => x.locale === 'en-US');
    expect(t).toMatchObject({ value: 'Basics', outdated: false });
    await expect(
      svc.markComplete([{ ...ref, field: 'description' }]),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('TranslationsService — export / import', () => {
  it('exports CSV for one type × locale and imports it back', async () => {
    const source = kitchenSinkLessonDoc();
    const prisma = fakePrisma(source);
    const svc = new TranslationsService(prisma as never);
    const file = await svc.exportFile('LESSON', 'en-US', 'csv');
    expect(file.filename).toBe('translations-lesson-en-US.csv');
    const table = parseCsv(file.body);
    expect(table.map((r) => r[2])).toEqual(['field', 'title', 'contentJson']);
    // Translator fills both rows.
    table[1][4] = 'Signals';
    table[2][4] = JSON.stringify(translated(source));
    const csv = table
      .map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(','))
      .join('\n');

    const dry = await svc.importFile({
      entityType: 'LESSON',
      locale: 'en-US',
      format: 'csv',
      content: csv,
      dryRun: true,
    });
    expect(dry.report).toMatchObject({
      dryRun: true,
      valid: 2,
      imported: 0,
      errors: [],
    });
    expect(prisma.contentTranslation.upsert).not.toHaveBeenCalled();

    const res = await svc.importFile({
      entityType: 'LESSON',
      locale: 'en-US',
      format: 'csv',
      content: csv,
    });
    expect(res.report).toMatchObject({
      imported: 2,
      errors: [],
      sourceChanged: [],
    });
    expect(
      prisma.translations.find(
        (t) => t.locale === 'en-US' && t.field === 'title',
      )?.value,
    ).toBe('Signals');
    // The pt-BR source was never written.
    expect(
      prisma.translations.find(
        (t) => t.locale === 'pt-BR' && t.entityType === 'LESSON',
      )?.value,
    ).toBe('Sinais');

    // Re-importing the same file changes nothing.
    const again = await svc.importFile({
      entityType: 'LESSON',
      locale: 'en-US',
      format: 'csv',
      content: csv,
    });
    expect(again.report).toMatchObject({ imported: 0, skipped: 2 });
  });

  it('validates rows: unknown entity, wrong locale, source locale, bad body, duplicates', async () => {
    const prisma = fakePrisma(kitchenSinkLessonDoc());
    const svc = new TranslationsService(prisma as never);
    const content = JSON.stringify({
      rows: [
        { entityId: 'nope', field: 'title', translatedValue: 'x' },
        {
          entityId: 'l1',
          field: 'title',
          locale: 'pt-BR',
          translatedValue: 'x',
        },
        {
          entityId: 'l1',
          field: 'contentJson',
          translatedValue: '{"type":"doc","version":1,"content":[]}',
        },
        { entityId: 'l1', field: 'title', translatedValue: 'A' },
        { entityId: 'l1', field: 'title', translatedValue: 'B' },
        { entityId: 'l1', field: 'slug', translatedValue: 'B' },
        { entityId: 'l1', field: 'title', translatedValue: '' },
      ],
    });
    const { report } = await svc.importFile({
      entityType: 'LESSON',
      locale: 'en-US',
      format: 'json',
      content,
    });
    expect(report.imported).toBe(0);
    expect(report.skipped).toBe(1);
    expect(report.errors.map((e) => e.row)).toEqual([1, 2, 3, 5, 6]);
    expect(report.errors.find((e) => e.row === 3)?.message).toMatch(
      /Expected \d+ block/,
    );
    expect(prisma.contentTranslation.upsert).not.toHaveBeenCalled();
  });

  it('keeps a row outdated when its sourceValue no longer matches', async () => {
    const prisma = fakePrisma(kitchenSinkLessonDoc());
    const svc = new TranslationsService(prisma as never);
    const content = [
      'entityId,locale,field,sourceValue,translatedValue',
      'l1,en-US,title,Old title,Signals',
    ].join('\n');
    const { report } = await svc.importFile({
      entityType: 'LESSON',
      locale: 'en-US',
      format: 'csv',
      content,
    });
    expect(report.sourceChanged).toEqual([
      { row: 2, entityId: 'l1', field: 'title' },
    ]);
    expect(
      prisma.translations.find(
        (t) => t.locale === 'en-US' && t.field === 'title',
      ),
    ).toMatchObject({ value: 'Signals', outdated: true });
  });
});
