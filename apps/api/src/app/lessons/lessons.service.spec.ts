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
