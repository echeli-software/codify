import type { ApiUser } from '../auth/auth.types.js';
import type { AccessService } from '../billing/access.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { ProgressService } from '../progress/progress.service.js';
import { RateLimitedException } from '../exercises/rate-limit.js';
import { ScenariosService } from './scenarios.service.js';

const graph = {
  startId: 'start',
  nodes: {
    start: {
      id: 'start',
      text: 'Hi',
      choices: [
        { id: 'a', label: 'go', to: 'mid' },
        { id: 'b', label: 'quit', ending: true, outcome: 'bailed' },
      ],
    },
    mid: {
      id: 'mid',
      text: 'Then?',
      choices: [{ id: 'x', label: 'fix', ending: true, outcome: 'resolved' }],
    },
  },
};

function setup(lastRun: Date | null = null, alreadyCompleted = false) {
  const prisma = {
    scenario: {
      findUnique: jest.fn(async () => ({
        id: 's1',
        graphJson: graph,
        lesson: { id: 'l1' },
      })),
      create: jest.fn(),
      update: jest.fn(),
    },
    scenarioRun: {
      findFirst: jest.fn(async () => (lastRun ? { createdAt: lastRun } : null)),
      create: jest.fn(async () => ({ id: 'run1' })),
    },
    lesson: {
      findFirst: jest.fn(async () => ({
        id: 'l1',
        scenarioId: null,
        module: { course: { authorId: 'author' } },
      })),
    },
  };
  const access = {
    resolveLessonAccess: jest.fn(async () => ({ access: { granted: true } })),
  } as unknown as AccessService;
  const recordCompletion = jest.fn(async () => ({
    alreadyCompleted,
    reward: { xp: 28 },
  }));
  const service = new ScenariosService(
    prisma as unknown as PrismaService,
    access,
    { recordCompletion } as unknown as ProgressService,
  );
  return { service, prisma, recordCompletion };
}

describe('ScenariosService', () => {
  it('completes via recordCompletion with the scenario reward sources', async () => {
    const { service, recordCompletion } = setup();
    const res = await service.complete('u1', 's1', ['a', 'x']);
    expect(res).toMatchObject({
      completed: true,
      outcome: 'resolved',
      reward: { xp: 28 },
    });
    expect(recordCompletion).toHaveBeenCalledWith({
      userId: 'u1',
      lessonId: 'l1',
      xpSource: 'SCENARIO_COMPLETE',
      coinSource: 'SCENARIO_COMPLETE',
      refType: 'scenario',
      refId: 's1',
      questEvent: 'scenario_complete',
    });
  });

  it('replays are recorded but not rewarded again', async () => {
    const { service } = setup(null, true);
    const res = await service.complete('u1', 's1', ['b']);
    expect(res.completed).toBe(true);
    expect(res.reward).toBeUndefined();
  });

  it('partial paths record a run without completing the lesson', async () => {
    const { service, recordCompletion, prisma } = setup();
    await service.complete('u1', 's1', ['a']);
    expect(prisma.scenarioRun.create).toHaveBeenCalled();
    expect(recordCompletion).not.toHaveBeenCalled();
  });

  it('enforces a cooldown between recorded runs', async () => {
    const { service } = setup(new Date(Date.now() - 500));
    await expect(service.complete('u1', 's1', ['b'])).rejects.toBeInstanceOf(
      RateLimitedException,
    );
  });

  it('rejects invalid graphs at save time with the problem list', async () => {
    const { service } = setup();
    const author: ApiUser = {
      userId: 'author',
      clerkId: 'c',
      email: 'e',
      role: 'TEACHER',
      displayName: 'a',
    };
    const bad = {
      startId: 's',
      nodes: { s: { id: 's', text: 'x', choices: [] } },
    };
    await expect(
      service.createForLesson(author, 'l1', bad),
    ).rejects.toMatchObject({
      response: {
        code: 'INVALID_SCENARIO',
        errors: ['start node has no choices'],
      },
    });
    await expect(
      service.createForLesson({ ...author, userId: 'intruder' }, 'l1', graph),
    ).rejects.toMatchObject({ status: 403 });
  });
});
