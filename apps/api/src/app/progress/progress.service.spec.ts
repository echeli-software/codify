import type { LessonType } from '@prisma/client';
import type { ApiUser } from '../auth/auth.types.js';
import type { AccessService } from '../billing/access.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { GamificationService } from '../gamification/gamification.service.js';
import type { QuestsService } from '../gamification/quests.service.js';
import type { BadgesService } from '../gamification/badges.service.js';
import {
  containsQuizBlock,
  ProgressService,
  validateClientTimestamp,
} from './progress.service.js';

const student: ApiUser = {
  userId: 'u1',
  clerkId: 'c',
  email: 's@x',
  role: 'STUDENT',
  displayName: 'S',
};

function setup(
  type: LessonType,
  contentJson: unknown = { type: 'doc', content: [] },
) {
  const prisma = {
    lesson: {
      findFirst: jest.fn(async () => ({ id: 'l1', type, contentJson })),
    },
  };
  const access = {
    resolveLessonAccess: jest.fn(async () => ({ access: { granted: true } })),
  } as unknown as AccessService;
  const service = new ProgressService(
    prisma as unknown as PrismaService,
    access,
    {} as GamificationService,
    {} as QuestsService,
    {} as BadgesService,
  );
  const recordCompletion = jest
    .spyOn(service, 'recordCompletion')
    .mockResolvedValue({
      alreadyCompleted: false,
      progress: {
        lessonId: 'l1',
        completedAt: new Date().toISOString(),
        xpAwarded: 10,
        coinsAwarded: 5,
      },
      totals: { totalXp: 10, coins: 5 },
    });
  return { service, recordCompletion };
}

describe('ProgressService.complete — lesson type guard', () => {
  it.each(['EXERCISE', 'AI_PROMPT', 'SCENARIO', 'CAPSTONE'] as LessonType[])(
    'rejects %s lessons with 409 LESSON_COMPLETES_VIA_OWN_FLOW',
    async (type) => {
      const { service, recordCompletion } = setup(type);
      const err = (await service
        .complete(student, 'l1')
        .catch((e: unknown) => e)) as {
        getStatus(): number;
        getResponse(): unknown;
      };
      expect(err.getStatus()).toBe(409);
      expect(err.getResponse()).toMatchObject({
        code: 'LESSON_COMPLETES_VIA_OWN_FLOW',
        lessonType: type,
      });
      expect(recordCompletion).not.toHaveBeenCalled();
    },
  );

  it('rejects QUIZ lessons that contain quiz blocks (graded elsewhere)', async () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'paragraph' },
        { type: 'callout', content: [{ type: 'quiz', attrs: { id: 'q1' } }] },
      ],
    };
    const { service } = setup('QUIZ', doc);
    await expect(service.complete(student, 'l1')).rejects.toMatchObject({
      response: { code: 'QUIZ_REQUIRES_GRADING' },
    });
  });

  it('lets a QUIZ lesson without quiz blocks and READING lessons complete directly', async () => {
    for (const type of ['QUIZ', 'READING'] as LessonType[]) {
      const { service, recordCompletion } = setup(type);
      await expect(service.complete(student, 'l1')).resolves.toMatchObject({
        progress: { lessonId: 'l1' },
      });
      expect(recordCompletion).toHaveBeenCalledWith(
        expect.objectContaining({
          xpSource: 'LESSON_COMPLETE',
          refType: 'lesson',
          clientTimestamp: null,
        }),
      );
    }
  });

  it('passes a valid clientTimestamp through to recordCompletion', async () => {
    const { service, recordCompletion } = setup('READING');
    const ts = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    await service.complete(student, 'l1', { clientTimestamp: ts });
    expect(recordCompletion).toHaveBeenCalledWith(
      expect.objectContaining({ clientTimestamp: ts }),
    );
  });

  it('409 with code LESSON_ALREADY_COMPLETED on replay', async () => {
    const { service, recordCompletion } = setup('READING');
    recordCompletion.mockResolvedValueOnce({
      alreadyCompleted: true,
      progress: {
        lessonId: 'l1',
        completedAt: new Date().toISOString(),
        xpAwarded: 10,
        coinsAwarded: 5,
      },
      totals: { totalXp: 10, coins: 5 },
    });
    await expect(service.complete(student, 'l1')).rejects.toMatchObject({
      response: { code: 'LESSON_ALREADY_COMPLETED' },
    });
  });
});

describe('validateClientTimestamp', () => {
  const now = Date.parse('2026-10-07T12:00:00Z');
  it('accepts recent and slightly-future times', () => {
    expect(validateClientTimestamp('2026-10-07T11:00:00Z', now)).toBe(
      '2026-10-07T11:00:00.000Z',
    );
    expect(validateClientTimestamp('2026-10-07T12:04:00Z', now)).toBe(
      '2026-10-07T12:04:00.000Z',
    );
    expect(validateClientTimestamp('2026-10-04T12:30:00Z', now)).toBe(
      '2026-10-04T12:30:00.000Z',
    );
    expect(validateClientTimestamp(undefined, now)).toBeNull();
  });
  it('rejects > 5 min in the future', () => {
    expect(() => validateClientTimestamp('2026-10-07T12:06:00Z', now)).toThrow(
      expect.objectContaining({
        response: expect.objectContaining({
          code: 'CLIENT_TIMESTAMP_IN_FUTURE',
        }),
      }),
    );
  });
  it('rejects older than 72 h', () => {
    expect(() => validateClientTimestamp('2026-10-04T11:59:00Z', now)).toThrow(
      expect.objectContaining({
        response: expect.objectContaining({ code: 'CLIENT_TIMESTAMP_TOO_OLD' }),
      }),
    );
  });
  it('rejects garbage', () => {
    expect(() => validateClientTimestamp('yesterday', now)).toThrow(
      expect.objectContaining({
        response: expect.objectContaining({ code: 'INVALID_CLIENT_TIMESTAMP' }),
      }),
    );
  });
});

describe('containsQuizBlock', () => {
  it('finds nested quiz nodes only', () => {
    expect(
      containsQuizBlock({ type: 'doc', content: [{ type: 'quizOption' }] }),
    ).toBe(false);
    expect(
      containsQuizBlock({
        type: 'doc',
        content: [{ type: 'x', content: [{ type: 'quiz' }] }],
      }),
    ).toBe(true);
    expect(containsQuizBlock(null)).toBe(false);
  });
});
