import {
  BadRequestException,
  HttpException,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import {
  checkQuizAnswerHash,
  kitchenSinkLessonDoc,
  LESSON_DOC_VERSION,
} from '@codify/lesson-schema';
import { LessonsService } from './lessons.service.js';
import { runInTranslationContext } from '../translations/translation-context.js';
import type { ApiUser } from '../auth/auth.types.js';

const user = (
  role: ApiUser['role'],
  userId = `${role.toLowerCase()}-1`,
): ApiUser => ({
  userId,
  clerkId: `c-${userId}`,
  email: `${userId}@x.dev`,
  role,
  displayName: userId,
});

const STUDENT = user('STUDENT');
const ADMIN = user('ADMIN');

const EXERCISE_ID = '0192f3a4-0000-7000-8000-000000000001';
const PROMPT_ID = '0192f3a4-0000-7000-8000-000000000002';
const SCENARIO_ID = '0192f3a4-0000-7000-8000-000000000003';

interface Fixture {
  status?: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
  isFree?: boolean;
  contentJson?: unknown;
  authorId?: string;
}

function lessonRow(f: Fixture = {}) {
  return {
    id: 'lesson-1',
    moduleId: 'module-1',
    order: 0,
    type: 'QUIZ',
    isFree: f.isFree ?? false,
    estimatedMinutes: 5,
    baseXp: 10,
    baseCoins: 5,
    contentJson: f.contentJson ?? kitchenSinkLessonDoc(),
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-02-01T00:00:00Z'),
    deletedAt: null,
    module: {
      id: 'module-1',
      courseId: 'course-1',
      course: {
        id: 'course-1',
        status: f.status ?? 'PUBLISHED',
        sourceLocale: 'en',
        deletedAt: null,
        authorId: f.authorId ?? 'teacher-1',
      },
    },
  };
}

function setup(f: Fixture = {}, granted = true) {
  const row = lessonRow(f);
  const updates: unknown[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prisma: any = {
    lesson: {
      findFirst: jest.fn(async () => row),
      findMany: jest.fn(async () => [
        { id: 'l1', updatedAt: new Date('2026-03-01T00:00:00Z') },
        { id: 'l2', updatedAt: new Date('2026-03-02T00:00:00Z') },
      ]),
      update: jest.fn(async (args: unknown) => (updates.push(args), row)),
      findUnique: jest.fn(async () => null),
    },
    module: { findUnique: jest.fn(async () => ({ ...row.module })) },
    course: { findFirst: jest.fn(async () => row.module.course) },
    contentTranslation: {
      findUnique: jest.fn(async () => ({ value: 'Signals 101' })),
      upsert: jest.fn(),
      updateMany: jest.fn(),
    },
    exercise: { findMany: jest.fn(async () => [{ id: EXERCISE_ID }]) },
    aiPrompt: { findMany: jest.fn(async () => [{ id: PROMPT_ID }]) },
    scenario: { findMany: jest.fn(async () => [{ id: SCENARIO_ID }]) },
    asset: {
      findMany: jest.fn(async () => [
        {
          id: '0192f3a4-sample',
          kind: 'IMAGE',
          confirmed: true,
          mimeType: 'image/png',
        },
      ]),
    },
    multiplier: { findMany: jest.fn(async () => []) },
    $transaction: jest.fn(
      async (fn: (tx: unknown) => unknown): Promise<unknown> => fn(prisma),
    ),
  };
  const access = {
    resolveLessonAccess: jest.fn(async () => ({
      courseId: 'course-1',
      access: granted
        ? { granted: true, reason: 'subscription' }
        : {
            granted: false,
            reason: 'paywall',
            requiredPlans: [
              { id: 'plan-all', slug: 'all', name: 'All access' },
            ],
          },
    })),
  };
  const svc = new LessonsService(prisma as never, access as never);
  return { svc, prisma, access, updates };
}

async function caught(p: Promise<unknown>): Promise<HttpException> {
  try {
    await p;
  } catch (e) {
    return e as HttpException;
  }
  throw new Error('expected rejection');
}

describe('LessonsService.getById — student gating', () => {
  it('returns content with quiz answers stripped when access is granted', async () => {
    const { svc, access } = setup();
    const res = await svc.getById(STUDENT, 'lesson-1');
    expect(access.resolveLessonAccess).toHaveBeenCalledWith(
      STUDENT.userId,
      'lesson-1',
    );
    expect(res.title).toBe('Signals 101');
    const json = JSON.stringify(res.contentJson);
    expect(json).toContain('"type":"quiz"');
    expect(json).not.toContain('correctOptionIds');
    expect(json).not.toContain('computed() is read-only');
  });

  it('serves free lessons without consulting billing', async () => {
    const { svc, access } = setup({ isFree: true }, false);
    const res = await svc.getById(STUDENT, 'lesson-1');
    expect(res.contentJson).toBeTruthy();
    expect(access.resolveLessonAccess).not.toHaveBeenCalled();
  });

  it('402s with reason + requiredPlans and no content without access', async () => {
    const { svc } = setup({}, false);
    const err = await caught(svc.getById(STUDENT, 'lesson-1'));
    expect(err.getStatus()).toBe(402);
    const body = err.getResponse() as Record<string, unknown>;
    expect(body['reason']).toBe('paywall');
    expect(body['requiredPlans']).toEqual([
      { id: 'plan-all', slug: 'all', name: 'All access' },
    ]);
    expect(body['contentJson']).toBeUndefined();
  });

  it('404s draft courses for students (even free lessons)', async () => {
    const { svc } = setup({ status: 'DRAFT', isFree: true });
    await expect(svc.getById(STUDENT, 'lesson-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('gives staff the authored doc including answer keys', async () => {
    const { svc, access } = setup({ status: 'DRAFT' }, false);
    const res = await svc.getById(ADMIN, 'lesson-1');
    expect(JSON.stringify(res.contentJson)).toContain('correctOptionIds');
    expect(access.resolveLessonAccess).not.toHaveBeenCalled();
  });
});

describe('LessonsService.getById — content locale (docs/11 §3)', () => {
  const localizer = (locale: string) => ({
    requestLocale: jest.fn(async () => locale),
  });
  /** A valid translation: same structure, translated first paragraph. */
  const ptDoc = (() => {
    const d = kitchenSinkLessonDoc();
    const i = d.content.findIndex((b) => b.type === 'paragraph');
    d.content[i] = {
      type: 'paragraph',
      content: [{ type: 'text', text: 'Olá, sinais' }],
    };
    return d;
  })();

  function withTranslations(rows: unknown[]) {
    const { prisma, access } = setup({ isFree: true });
    prisma.contentTranslation.findMany = jest.fn(async () => rows);
    return { prisma, access };
  }

  it('serves the requested locale’s title and body', async () => {
    const { prisma, access } = withTranslations([
      { field: 'title', value: 'Sinais 101', outdated: false },
      { field: 'contentJson', value: JSON.stringify(ptDoc), outdated: false },
    ]);
    const svc = new LessonsService(
      prisma as never,
      access as never,
      localizer('pt-BR') as never,
    );
    const ctx = await runInTranslationContext({} as never, async (c) => {
      const res = await svc.getById(STUDENT, 'lesson-1');
      expect(res.title).toBe('Sinais 101');
      expect(JSON.stringify(res.contentJson)).toContain('Olá, sinais');
      expect(res._translation).toEqual({
        locale: 'pt-BR',
        source: 'pt-BR',
        fallback: false,
      });
      return c;
    });
    expect(ctx.fallbackFrom).toBeNull();
    expect(prisma.contentTranslation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          entityId: 'lesson-1',
          locale: 'pt-BR',
        }),
      }),
    );
  });

  it('falls back to the source (and notes it) for an outdated body', async () => {
    const { prisma, access } = withTranslations([
      { field: 'title', value: 'Sinais 101', outdated: false },
      { field: 'contentJson', value: JSON.stringify(ptDoc), outdated: true },
    ]);
    const svc = new LessonsService(
      prisma as never,
      access as never,
      localizer('pt-BR') as never,
    );
    const ctx = await runInTranslationContext({} as never, async (c) => {
      const res = await svc.getById(STUDENT, 'lesson-1');
      expect(JSON.stringify(res.contentJson)).not.toContain('Olá, sinais');
      expect(res._translation).toEqual({
        locale: 'pt-BR',
        source: 'en',
        fallback: true,
      });
      return c;
    });
    // The course's source locale in the fixture is 'en'.
    expect(ctx.fallbackFrom).toBe('en');
  });

  it.each([
    ['invalid JSON', '{not json'],
    [
      'a schema-invalid doc',
      JSON.stringify({ type: 'doc', version: 1, content: [{ type: 'nope' }] }),
    ],
    [
      'a different block structure',
      JSON.stringify({
        ...ptDoc,
        content: ptDoc.content.filter((b) => b.type !== 'quiz'),
      }),
    ],
  ])('never serves %s as the translated body (FIX-6)', async (_l, value) => {
    const { prisma, access } = withTranslations([
      { field: 'title', value: 'Sinais 101', outdated: false },
      { field: 'contentJson', value, outdated: false },
    ]);
    const svc = new LessonsService(
      prisma as never,
      access as never,
      localizer('pt-BR') as never,
    );
    const ctx = await runInTranslationContext({} as never, async (c) => {
      const res = await svc.getById(STUDENT, 'lesson-1');
      expect(res.title).toBe('Sinais 101');
      expect(res._translation?.fallback).toBe(true);
      expect(JSON.stringify(res.contentJson)).toContain('"type":"quiz"');
      return c;
    });
    expect(ctx.fallbackFrom).toBe('en');
  });

  it('404s TRANSLATION_NOT_AVAILABLE with ?fallback=false', async () => {
    const { prisma, access } = withTranslations([]);
    const svc = new LessonsService(
      prisma as never,
      access as never,
      localizer('pt-BR') as never,
    );
    const err = await runInTranslationContext(
      { query: { fallback: 'false' } } as never,
      () => caught(svc.getById(STUDENT, 'lesson-1')),
    );
    expect(err).toBeInstanceOf(NotFoundException);
    expect(err.getResponse()).toMatchObject({
      code: 'TRANSLATION_NOT_AVAILABLE',
    });
  });

  it('source-locale callers skip the translations query', async () => {
    const { prisma, access } = withTranslations([]);
    const svc = new LessonsService(
      prisma as never,
      access as never,
      localizer('en') as never,
    );
    const res = await svc.getById(STUDENT, 'lesson-1');
    expect(res.title).toBe('Signals 101');
    expect(prisma.contentTranslation.findMany).not.toHaveBeenCalled();
  });
});

describe('LessonsService.update — content validation', () => {
  it('persists the validated doc', async () => {
    const { svc, updates } = setup();
    await svc.update(ADMIN, 'lesson-1', {
      contentJson: kitchenSinkLessonDoc(),
    });
    const data = (updates[0] as { data: { contentJson: { version: number } } })
      .data;
    expect(data.contentJson.version).toBe(LESSON_DOC_VERSION);
  });

  it('400s with zod issues for an invalid doc and writes nothing', async () => {
    const { svc, updates } = setup();
    const bad = {
      type: 'doc',
      version: 1,
      content: [
        { type: 'listItem', content: [] },
        { type: 'image', attrs: { src: 'javascript:alert(1)', alt: '' } },
      ],
    };
    const err = await caught(
      svc.update(ADMIN, 'lesson-1', { contentJson: bad }),
    );
    expect(err).toBeInstanceOf(BadRequestException);
    const body = err.getResponse() as {
      message: string;
      issues: { path: string }[];
    };
    expect(body.message).toBe('Invalid lesson content');
    expect(body.issues.map((i) => i.path)).toEqual(
      expect.arrayContaining(['content.0.type']),
    );
    expect(updates).toHaveLength(0);
  });

  it('400s when the doc version is from the future', async () => {
    const { svc } = setup();
    const err = await caught(
      svc.update(ADMIN, 'lesson-1', {
        contentJson: {
          ...kitchenSinkLessonDoc(),
          version: LESSON_DOC_VERSION + 1,
        },
      }),
    );
    expect(err.getStatus()).toBe(400);
  });

  it('400s when a ref block points at a missing exercise', async () => {
    const { svc, prisma } = setup();
    prisma.exercise.findMany.mockResolvedValueOnce([]);
    const err = await caught(
      svc.update(ADMIN, 'lesson-1', { contentJson: kitchenSinkLessonDoc() }),
    );
    expect(err.getStatus()).toBe(400);
    expect(JSON.stringify(err.getResponse())).toContain('Unknown exerciseId');
  });

  it('400s when an image assetId is unknown, not an image or unconfirmed', async () => {
    for (const rows of [
      [],
      [
        {
          id: '0192f3a4-sample',
          kind: 'VIDEO',
          confirmed: true,
          mimeType: 'video/mp4',
        },
      ],
      [
        {
          id: '0192f3a4-sample',
          kind: 'IMAGE',
          confirmed: false,
          mimeType: 'image/png',
        },
      ],
    ]) {
      const { svc, prisma, updates } = setup();
      prisma.asset.findMany.mockResolvedValueOnce(rows);
      const err = await caught(
        svc.update(ADMIN, 'lesson-1', { contentJson: kitchenSinkLessonDoc() }),
      );
      expect(err.getStatus()).toBe(400);
      const issues = (err.getResponse() as { issues: { path: string }[] })
        .issues;
      expect(issues[0].path).toMatch(/^content\.\d+\.attrs\.assetId$/);
      expect(updates).toHaveLength(0);
    }
  });

  it('fills embed metadata on save through the metadata service', async () => {
    const { prisma, access, updates } = setup();
    const embeds = {
      enrich: jest.fn(
        async (doc: {
          content: { type: string; attrs?: Record<string, unknown> }[];
        }) => {
          for (const b of doc.content)
            if (b.type === 'embed' && b.attrs)
              b.attrs['meta'] = { title: 'From oEmbed' };
          return doc;
        },
      ),
    };
    const svc = new LessonsService(
      prisma as never,
      access as never,
      undefined,
      embeds as never,
    );
    await svc.update(ADMIN, 'lesson-1', {
      contentJson: kitchenSinkLessonDoc(),
    });
    expect(embeds.enrich).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(updates[0])).toContain('From oEmbed');
  });

  it('413s oversize docs', async () => {
    const { svc } = setup();
    const huge = {
      type: 'doc',
      version: 1,
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'x'.repeat(600_000) }],
        },
      ],
    };
    await expect(
      svc.update(ADMIN, 'lesson-1', { contentJson: huge }),
    ).rejects.toBeInstanceOf(PayloadTooLargeException);
  });

  it('bumps updatedAt on title-only edits', async () => {
    const { svc, updates } = setup();
    await svc.update(ADMIN, 'lesson-1', { title: 'New title' });
    const data = (updates[0] as { data: { updatedAt: Date } }).data;
    expect(data.updatedAt).toBeInstanceOf(Date);
  });
});

describe('LessonsService.offlineBundle', () => {
  it('ships the stripped doc plus answer hashes that verify the right answers', async () => {
    const { svc } = setup();
    const bundle = await svc.offlineBundle(STUDENT, 'lesson-1');
    expect(JSON.stringify(bundle.doc)).not.toContain('correctOptionIds');
    expect(bundle.lesson.title).toBe('Signals 101');
    expect(bundle.updatedAt).toBe('2026-02-01T00:00:00.000Z');
    expect(bundle.imageSrcs).toEqual([
      'https://cdn.codify.app/img/0192f3a4-sample',
    ]);
    const { salt, hashes } = bundle.quizAnswerHashes;
    expect(await checkQuizAnswerHash(hashes['quiz'], salt, 'quiz', ['a'])).toBe(
      true,
    );
    expect(await checkQuizAnswerHash(hashes['quiz'], salt, 'quiz', ['b'])).toBe(
      false,
    );
  });

  it('applies the same paywall as the lesson detail', async () => {
    const { svc } = setup({}, false);
    expect(
      (await caught(svc.offlineBundle(STUDENT, 'lesson-1'))).getStatus(),
    ).toBe(402);
  });
});

describe('LessonsService.lessonVersions', () => {
  it('lists lessonId + updatedAt', async () => {
    const { svc } = setup();
    expect(await svc.lessonVersions(STUDENT, 'course-1')).toEqual([
      { lessonId: 'l1', updatedAt: '2026-03-01T00:00:00.000Z' },
      { lessonId: 'l2', updatedAt: '2026-03-02T00:00:00.000Z' },
    ]);
  });

  it('404s an unpublished course for students but not for staff', async () => {
    const { svc } = setup({ status: 'DRAFT' });
    await expect(
      svc.lessonVersions(STUDENT, 'course-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.lessonVersions(ADMIN, 'course-1')).resolves.toHaveLength(
      2,
    );
  });
});

describe('LessonsService.multipliers', () => {
  it('lists lesson + course-wide rules with scope and activeNow', async () => {
    const { svc, prisma } = setup();
    prisma.multiplier.findMany.mockResolvedValueOnce([
      {
        id: 'm1',
        kind: 'LESSON_PROMO',
        target: 'XP',
        value: { toString: () => '2.00', valueOf: () => 2 },
        startsAt: null,
        endsAt: null,
        courseId: null,
        lessonId: 'lesson-1',
        description: 'Launch',
        isActive: true,
      },
      {
        id: 'm2',
        kind: 'COURSE_PROMO',
        target: 'BOTH',
        value: 1.5,
        startsAt: new Date('2000-01-01T00:00:00Z'),
        endsAt: new Date('2000-02-01T00:00:00Z'),
        courseId: 'course-1',
        lessonId: null,
        description: null,
        isActive: true,
      },
    ]);
    const out = await svc.multipliers(ADMIN, 'lesson-1');
    expect(out.map((m) => [m.id, m.scope, m.activeNow, m.value])).toEqual([
      ['m1', 'lesson', true, 2],
      ['m2', 'course', false, 1.5],
    ]);
    expect(prisma.multiplier.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: null,
          OR: [
            { lessonId: 'lesson-1' },
            { courseId: 'course-1', lessonId: null },
          ],
        },
      }),
    );
  });

  it('refuses students and other teachers', async () => {
    const { svc } = setup();
    await expect(svc.multipliers(STUDENT, 'lesson-1')).rejects.toThrow();
    await expect(
      svc.multipliers(user('TEACHER', 'teacher-2'), 'lesson-1'),
    ).rejects.toThrow();
  });
});
