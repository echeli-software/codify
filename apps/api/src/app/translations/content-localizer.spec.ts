import type { CallHandler, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { lastValueFrom, defer } from 'rxjs';
import {
  ContentLocalizer,
  changedFields,
} from './content-localizer.service.js';
import {
  noteTranslationFallback,
  runInTranslationContext,
  TranslationFallbackInterceptor,
} from './translation-context.js';
import {
  buildCompleteness,
  buildWorkRows,
  explicitRequestLocale,
  localizedKey,
  localizeValues,
  matchSupportedLocale,
  PUBLIC_FIELDS,
  TRANSLATABLE_ENTITIES,
  TRANSLATABLE_FIELDS,
} from './translations.logic.js';
import { TranslationsService } from './translations.service.js';

const req = (over: Partial<Request> = {}) =>
  ({ query: {}, headers: {}, ...over }) as unknown as Request;

describe('translatable field maps', () => {
  it('cover every TranslatableEntity, with public fields ⊆ translatable', () => {
    for (const t of TRANSLATABLE_ENTITIES) {
      expect(TRANSLATABLE_FIELDS[t].length).toBeGreaterThan(0);
      for (const f of PUBLIC_FIELDS[t])
        expect(TRANSLATABLE_FIELDS[t]).toContain(f);
    }
    expect(TRANSLATABLE_FIELDS).toMatchObject({
      PLAN: ['name', 'description', 'tagline'],
      BADGE: ['name', 'description'],
      ITEM: ['name', 'description'],
      ITEM_CATEGORY: ['name'],
      QUEST: ['title'],
    });
  });

  it('completeness counts the new types per locale', () => {
    const rows = buildWorkRows(
      [
        {
          entityType: 'BADGE',
          entityId: 'b1',
          sourceLocale: 'pt-BR',
          label: 'Primeira aula',
          sourceValues: { name: 'Primeira aula', description: null },
        },
        {
          entityType: 'ITEM_CATEGORY',
          entityId: 'hats',
          sourceLocale: 'pt-BR',
          label: 'Chapéus',
          sourceValues: { name: 'Chapéus' },
        },
      ],
      [
        {
          entityType: 'BADGE',
          entityId: 'b1',
          locale: 'en-US',
          field: 'name',
          value: 'First lesson',
          outdated: false,
          updatedAt: new Date(),
        },
      ],
      ['pt-BR', 'en-US'],
    );
    const report = buildCompleteness(rows, ['pt-BR', 'en-US']);
    expect(report.locales['en-US'].BADGE).toMatchObject({
      total: 1,
      translated: 1,
      pct: 100,
    });
    expect(report.locales['en-US'].ITEM_CATEGORY).toMatchObject({
      total: 1,
      translated: 0,
      pct: 0,
    });
    expect(report.locales['pt-BR'].ALL.total).toBe(0);
  });
});

describe('request locale', () => {
  it('maps tags onto supported locales', () => {
    expect(matchSupportedLocale('en')).toBe('en-US');
    expect(matchSupportedLocale('EN-gb')).toBe('en-US');
    expect(matchSupportedLocale('pt-PT;q=0.8')).toBe('pt-BR');
    expect(matchSupportedLocale('fr-FR')).toBeNull();
    expect(matchSupportedLocale('')).toBeNull();
  });

  it('?locale wins over Accept-Language; unsupported tags are skipped', () => {
    expect(explicitRequestLocale('en-US', 'pt-BR')).toBe('en-US');
    expect(explicitRequestLocale(undefined, 'fr-FR,en;q=0.8')).toBe('en-US');
    expect(explicitRequestLocale('xx', undefined)).toBeNull();
  });

  const user = jest.fn(async () => ({ locale: 'en-US' }));
  const localizer = new ContentLocalizer({
    user: { findUnique: user },
  } as never);

  it('falls back to the signed-in user’s locale, then pt-BR; memoized', async () => {
    const signedIn = req({ user: { userId: 'u1' } } as never);
    await runInTranslationContext(signedIn, async () => {
      expect(await localizer.requestLocale()).toBe('en-US');
      expect(await localizer.requestLocale()).toBe('en-US');
    });
    expect(user).toHaveBeenCalledTimes(1);
    await runInTranslationContext(req(), async () => {
      expect(await localizer.requestLocale()).toBe('pt-BR');
    });
    await runInTranslationContext(
      req({
        headers: { 'accept-language': 'pt-BR' },
        user: { userId: 'u1' },
      } as never),
      async () => expect(await localizer.requestLocale()).toBe('pt-BR'),
    );
    expect(user).toHaveBeenCalledTimes(1);
    // Outside a request (jobs): the default locale.
    expect(await localizer.requestLocale()).toBe('pt-BR');
  });
});

describe('localizeValues', () => {
  const groups = [
    {
      entityType: 'ITEM' as const,
      items: [
        { id: 'i1', values: { name: 'Chapéu', description: 'Um chapéu' } },
        { id: 'i2', values: { name: 'Óculos', description: null } },
      ],
    },
  ];

  it('uses the requested locale and reports the source fallback', () => {
    const { values, fallbackFrom } = localizeValues(
      groups,
      [
        {
          entityType: 'ITEM',
          entityId: 'i1',
          locale: 'en-US',
          field: 'name',
          value: 'Hat',
        },
        {
          entityType: 'ITEM',
          entityId: 'i1',
          locale: 'en-US',
          field: 'description',
          value: 'A hat',
        },
        {
          entityType: 'ITEM',
          entityId: 'i2',
          locale: 'en-US',
          field: 'name',
          value: '',
        },
      ],
      'en-US',
    );
    expect(values.get(localizedKey('ITEM', 'i1', 'name'))).toBe('Hat');
    expect(values.has(localizedKey('ITEM', 'i2', 'name'))).toBe(false);
    // i2.name had source text but an empty translation → fallback.
    expect(fallbackFrom).toBe('pt-BR');
  });

  it('no fallback when fully translated, or when asking for the source locale', () => {
    const rows = ['i1', 'i2'].flatMap((id) => [
      {
        entityType: 'ITEM',
        entityId: id,
        locale: 'en-US',
        field: 'name',
        value: `${id}-en`,
      },
      {
        entityType: 'ITEM',
        entityId: id,
        locale: 'en-US',
        field: 'description',
        value: `${id}-desc`,
      },
    ]);
    expect(localizeValues(groups, rows, 'en-US').fallbackFrom).toBeNull();
    expect(localizeValues(groups, [], 'pt-BR')).toEqual({
      values: new Map(),
      fallbackFrom: null,
    });
  });
});

describe('ContentLocalizer.localize', () => {
  const findMany = jest.fn(async () => [
    {
      entityType: 'ITEM',
      entityId: 'i1',
      locale: 'en-US',
      field: 'name',
      value: 'Hat',
    },
  ]);
  const localizer = new ContentLocalizer({
    contentTranslation: { findMany },
  } as never);
  const groups = [
    {
      entityType: 'ITEM' as const,
      items: [{ id: 'i1', values: { name: 'Chapéu', description: null } }],
    },
    {
      entityType: 'ITEM_CATEGORY' as const,
      items: [
        { id: 'hats', values: { name: 'Chapéus' } },
        { id: 'hats', values: { name: 'Chapéus' } },
      ],
    },
  ];

  beforeEach(() => findMany.mockClear());

  it('one query for every type, applies translations and notes the fallback', async () => {
    const ctx = await runInTranslationContext(
      req({ headers: { 'accept-language': 'en-US' } }),
      async (c) => {
        const tr = await localizer.localize(groups);
        const item = { name: 'Chapéu', description: null };
        tr.apply('ITEM', 'i1', item, ['name', 'description']);
        expect(item).toEqual({ name: 'Hat', description: null });
        expect(tr.text('ITEM_CATEGORY', 'hats', 'name', 'Chapéus')).toBe(
          'Chapéus',
        );
        expect(tr.fallbackFrom).toBe('pt-BR');
        return c;
      },
    );
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          locale: 'en-US',
          OR: [
            {
              entityType: 'ITEM',
              entityId: { in: ['i1'] },
              field: { in: ['name', 'description'] },
            },
            {
              entityType: 'ITEM_CATEGORY',
              entityId: { in: ['hats'] },
              field: { in: ['name'] },
            },
          ],
        },
      }),
    );
    expect(ctx.fallbackFrom).toBe('pt-BR');
  });

  it('skips the query when the requested locale is the source', async () => {
    const tr = await localizer.localize(groups, 'pt-BR');
    expect(findMany).not.toHaveBeenCalled();
    expect(tr.fallbackFrom).toBeNull();
    expect(tr.text('ITEM', 'i1', 'name', 'Chapéu')).toBe('Chapéu');
  });
});

describe('outdated marking', () => {
  it('changedFields keeps only patched, different values', () => {
    expect(
      changedFields(
        { name: 'A', description: null, tagline: 'x' },
        { name: 'A', description: 'new', tagline: undefined },
        ['name', 'description', 'tagline'],
      ),
    ).toEqual(['description']);
  });

  it('markSourceChanged flags translations of the changed fields only', async () => {
    const updateMany = jest.fn(async () => ({ count: 2 }));
    const localizer = new ContentLocalizer({
      contentTranslation: { updateMany },
    } as never);
    await localizer.markSourceChanged('PLAN', 'p1', ['name', 'isActive']);
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        entityType: 'PLAN',
        entityId: 'p1',
        field: { in: ['name'] },
        locale: { not: 'pt-BR' },
        outdated: false,
      },
      data: { outdated: true },
    });
    updateMany.mockClear();
    await localizer.markSourceChanged('PLAN', 'p1', []);
    expect(updateMany).not.toHaveBeenCalled();
  });
});

describe('TranslationFallbackInterceptor', () => {
  function run(note: string | null) {
    const res = {
      headersSent: false,
      setHeader: jest.fn(),
    };
    const context = {
      getType: () => 'http',
      switchToHttp: () => ({
        getRequest: () => req(),
        getResponse: () => res,
      }),
    } as unknown as ExecutionContext;
    // Like Nest: the handler runs (async) only when subscribed.
    const next: CallHandler = {
      handle: () =>
        defer(async () => {
          await Promise.resolve();
          if (note) noteTranslationFallback(note);
          return { ok: true };
        }),
    };
    return {
      res,
      out: new TranslationFallbackInterceptor().intercept(context, next),
    };
  }

  it('sets X-Translation-Fallback when the handler fell back', async () => {
    const { res, out } = run('pt-BR');
    await expect(lastValueFrom(out)).resolves.toEqual({ ok: true });
    expect(res.setHeader).toHaveBeenCalledWith(
      'X-Translation-Fallback',
      'pt-BR',
    );
  });

  it('leaves the header off otherwise', async () => {
    const { res, out } = run(null);
    await lastValueFrom(out);
    expect(res.setHeader).not.toHaveBeenCalled();
  });
});

describe('TranslationsService — new entity types', () => {
  const prisma = {
    plan: {
      findMany: jest.fn(async () => [
        {
          id: 'p1',
          slug: 'pro',
          name: 'Pro',
          description: 'Tudo',
          tagline: null,
        },
      ]),
    },
    itemCategory: {
      findMany: jest.fn(async () => [{ slug: 'hats', name: 'Chapéus' }]),
    },
    questTemplate: {
      findMany: jest.fn(async () => [
        { id: 'q1', slug: 'q1', title: 'Complete 2 aulas' },
      ]),
    },
    badge: { findMany: jest.fn(async () => []) },
    contentTranslation: {
      findMany: jest.fn(async () => [
        {
          entityType: 'PLAN',
          entityId: 'p1',
          locale: 'en-US',
          field: 'name',
          value: 'Pro',
          outdated: true,
          updatedAt: new Date('2026-11-01T00:00:00Z'),
        },
      ]),
      upsert: jest.fn(() => 'op'),
    },
    $transaction: jest.fn(async (ops: unknown[]) => ops),
  };
  const svc = new TranslationsService(prisma as never);

  it('lists plan fields with source text from the columns', async () => {
    const res = await svc.list({ entityType: 'PLAN', locale: 'en-US' });
    expect(
      res.items.map((r) => `${r.field}:${r.sourceValue}:${r.status}`),
    ).toEqual(['name:Pro:outdated', 'description:Tudo:missing']);
    expect(res.items[0].sourceLocale).toBe('pt-BR');
  });

  it('upserts item-category translations keyed by slug', async () => {
    const res = await svc.upsert([
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
        value: 'Complete 2 lessons',
      },
    ]);
    expect(res.updated).toBe(2);
    expect(prisma.itemCategory.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { slug: { in: ['hats'] } } }),
    );
  });

  it('public resolve hides inactive / hidden badges', async () => {
    await svc.resolve('BADGE', ['b1'], 'en-US');
    expect(prisma.badge.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { isActive: true, isHidden: false, id: { in: ['b1'] } },
      }),
    );
  });

  it('teachers never see platform entities', async () => {
    prisma.plan.findMany.mockClear();
    const res = await svc.list({ entityType: 'PLAN' }, { authorId: 't1' });
    expect(res.total).toBe(0);
    expect(prisma.plan.findMany).not.toHaveBeenCalled();
  });
});
