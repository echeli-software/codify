import { BadRequestException } from '@nestjs/common';
import {
  buildCompleteness,
  buildWorkRows,
  filterWorkRows,
  resolveField,
  translationIndex,
  type SourceEntity,
  type TranslationRowLike,
} from './translations.logic.js';
import { TranslationsService } from './translations.service.js';

const course: SourceEntity = {
  entityType: 'COURSE',
  entityId: 'c1',
  sourceLocale: 'pt-BR',
  label: 'Fundamentos',
  sourceValues: { title: 'Fundamentos', description: 'Descrição' },
};
const enCourse: SourceEntity = {
  entityType: 'COURSE',
  entityId: 'c2',
  sourceLocale: 'en-US',
  label: 'Basics',
  sourceValues: { title: 'Basics', description: null },
};
const tr = (over: Partial<TranslationRowLike>): TranslationRowLike => ({
  entityType: 'COURSE',
  entityId: 'c1',
  locale: 'en-US',
  field: 'title',
  value: 'Fundamentals',
  outdated: false,
  updatedAt: new Date('2026-10-01T00:00:00Z'),
  ...over,
});

describe('buildWorkRows', () => {
  it('one row per field × non-source locale, with status', () => {
    const rows = buildWorkRows(
      [course, enCourse],
      [tr({}), tr({ field: 'description', value: 'Desc', outdated: true })],
      ['pt-BR', 'en-US'],
    );
    // c1: title/description → en-US; c2: title → pt-BR (description has no source)
    expect(
      rows.map((r) => `${r.entityId}:${r.field}:${r.locale}:${r.status}`),
    ).toEqual([
      'c1:title:en-US:done',
      'c1:description:en-US:outdated',
      'c2:title:pt-BR:missing',
    ]);
  });

  it('filters by status and free text', () => {
    const rows = buildWorkRows(
      [course, enCourse],
      [tr({})],
      ['pt-BR', 'en-US'],
    );
    expect(filterWorkRows(rows, { status: 'missing' })).toHaveLength(2);
    expect(
      filterWorkRows(rows, { q: 'fundamentals' }).map((r) => r.field),
    ).toEqual(['title']);
  });
});

describe('buildCompleteness', () => {
  it('per locale × type totals and per-entity breakdown', () => {
    const rows = buildWorkRows(
      [course, enCourse],
      [tr({})],
      ['pt-BR', 'en-US'],
    );
    const rep = buildCompleteness(rows, ['pt-BR', 'en-US']);
    expect(rep.locales['en-US'].COURSE).toEqual({
      total: 2,
      translated: 1,
      outdated: 0,
      pct: 50,
    });
    expect(rep.locales['pt-BR'].COURSE).toEqual({
      total: 1,
      translated: 0,
      outdated: 0,
      pct: 0,
    });
    expect(rep.locales['en-US'].LESSON).toEqual({
      total: 0,
      translated: 0,
      outdated: 0,
      pct: 100,
    });
    expect(
      rep.entities.find((e) => e.entityId === 'c1' && e.locale === 'en-US')
        ?.pct,
    ).toBe(50);
  });
});

describe('resolveField', () => {
  const idx = translationIndex([tr({})]);
  it('requested → source → default', () => {
    expect(resolveField(course, 'title', 'en-US', idx)).toEqual({
      value: 'Fundamentals',
      locale: 'en-US',
      fallback: false,
    });
    expect(resolveField(course, 'description', 'en-US', idx)).toEqual({
      value: 'Descrição',
      locale: 'pt-BR',
      fallback: true,
    });
    expect(resolveField(course, 'title', 'pt-BR', idx)).toEqual({
      value: 'Fundamentos',
      locale: 'pt-BR',
      fallback: false,
    });
    expect(resolveField(enCourse, 'description', 'pt-BR', idx)).toEqual({
      value: null,
      locale: null,
      fallback: false,
    });
  });
});

describe('TranslationsService.upsert', () => {
  const prisma = {
    course: {
      findMany: jest.fn(async () => [
        { id: 'c1', slug: 'c1', sourceLocale: 'pt-BR' },
      ]),
    },
    contentTranslation: {
      findMany: jest.fn(async () => [] as unknown[]),
      upsert: jest.fn(() => 'op'),
    },
    $transaction: jest.fn(async (ops: unknown[]) => ops),
  };
  const svc = new TranslationsService(prisma as never);

  it('upserts and clears outdated', async () => {
    const res = await svc.upsert([
      {
        entityType: 'COURSE',
        entityId: 'c1',
        field: 'title',
        locale: 'en-US',
        value: 'Fundamentals',
      },
    ]);
    expect(res.updated).toBe(1);
    expect(prisma.contentTranslation.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: { value: 'Fundamentals', outdated: false },
      }),
    );
  });

  it('rejects the source locale, unknown fields, unknown entities — all or nothing', async () => {
    prisma.contentTranslation.upsert.mockClear();
    await expect(
      svc.upsert([
        {
          entityType: 'COURSE',
          entityId: 'c1',
          field: 'title',
          locale: 'en-US',
          value: 'ok',
        },
        {
          entityType: 'COURSE',
          entityId: 'c1',
          field: 'title',
          locale: 'pt-BR',
          value: 'src',
        },
        {
          entityType: 'COURSE',
          entityId: 'c1',
          field: 'slug',
          locale: 'en-US',
          value: 'x',
        },
        {
          entityType: 'COURSE',
          entityId: 'zz',
          field: 'title',
          locale: 'en-US',
          value: 'x',
        },
      ]),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.contentTranslation.upsert).not.toHaveBeenCalled();
  });

  it('teacher scope filters entities by author', async () => {
    prisma.course.findMany.mockClear();
    await svc.upsert(
      [
        {
          entityType: 'COURSE',
          entityId: 'c1',
          field: 'title',
          locale: 'en-US',
          value: 'x',
        },
      ],
      { authorId: 't1' },
    );
    expect(prisma.course.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ authorId: 't1' }),
      }),
    );
  });
});
