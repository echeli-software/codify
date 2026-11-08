import type { AccessService } from '../billing/access.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { ProgressService } from '../progress/progress.service.js';
import { ScenariosService } from './scenarios.service.js';

/** docs/16 §7 `scenario_complete`: Idempotency-Key + clientTimestamp. */
const graph = {
  startId: 'start',
  nodes: {
    start: {
      id: 'start',
      text: 'Hi',
      choices: [{ id: 'b', label: 'quit', ending: true, outcome: 'bailed' }],
    },
  },
};

function setup(seenRunId: string | null = null) {
  const records = new Map<string, string>();
  if (seenRunId) records.set('scenario_complete:u1:s1:key-12345', seenRunId);
  const prisma = {
    scenario: {
      findUnique: jest.fn(async () => ({
        id: 's1',
        graphJson: graph,
        lesson: { id: 'l1' },
      })),
    },
    scenarioRun: {
      findFirst: jest.fn(async () => null),
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) => ({
        id: where.id,
        userId: 'u1',
        scenarioId: 's1',
        completed: true,
        maxDepth: 1,
        outcome: 'bailed',
        pathJson: ['b'],
      })),
      create: jest.fn(async () => ({ id: 'run-new' })),
    },
    idempotencyRecord: {
      findUnique: jest.fn(async ({ where }: { where: { key: string } }) =>
        records.has(where.key)
          ? { responseHash: records.get(where.key) }
          : null,
      ),
      create: jest.fn(
        async ({ data }: { data: { key: string; responseHash: string } }) => {
          records.set(data.key, data.responseHash);
          return data;
        },
      ),
    },
    $transaction: jest.fn(
      async (fn: (tx: unknown) => unknown): Promise<unknown> => fn(prisma),
    ),
  };
  const access = {
    resolveLessonAccess: jest.fn(async () => ({ access: { granted: true } })),
  } as unknown as AccessService;
  const recordCompletion = jest.fn(async () => ({
    alreadyCompleted: false,
    reward: { xp: 28 },
  }));
  const service = new ScenariosService(
    prisma as unknown as PrismaService,
    access,
    { recordCompletion } as unknown as ProgressService,
  );
  return { service, prisma, recordCompletion };
}

describe('ScenariosService offline completion', () => {
  it('stores the Idempotency-Key with the run and forwards clientTimestamp', async () => {
    const { service, prisma, recordCompletion } = setup();
    const at = new Date(Date.now() - 60_000).toISOString();
    const res = await service.complete('u1', 's1', ['b'], {
      idempotencyKey: 'key-12345',
      clientTimestamp: at,
    });
    expect(res.runId).toBe('run-new');
    expect(prisma.idempotencyRecord.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        key: 'scenario_complete:u1:s1:key-12345',
        scope: 'scenario_complete',
        responseHash: 'run-new',
      }),
    });
    expect(recordCompletion).toHaveBeenCalledWith(
      expect.objectContaining({ clientTimestamp: at, lessonId: 'l1' }),
    );
  });

  it('a replayed key returns the original run without a new row', async () => {
    const { service, prisma } = setup('run-old');
    const res = await service.complete('u1', 's1', ['b'], {
      idempotencyKey: 'key-12345',
    });
    expect(res).toMatchObject({
      runId: 'run-old',
      replayed: true,
      completed: true,
    });
    expect(prisma.scenarioRun.create).not.toHaveBeenCalled();
    // The cooldown lookup is skipped for a replay.
    expect(prisma.scenarioRun.findFirst).not.toHaveBeenCalled();
  });

  it('rejects an unparseable clientTimestamp', async () => {
    const { service } = setup();
    await expect(
      service.complete('u1', 's1', ['b'], { clientTimestamp: 'nope' }),
    ).rejects.toMatchObject({ status: 400 });
  });
});
