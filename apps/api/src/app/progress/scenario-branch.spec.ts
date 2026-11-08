import type { ScenarioGraph } from '@codify/domain';
import { scenarioEndingInfo } from './scenario-branch.js';

const graph: ScenarioGraph = {
  startId: 's',
  nodes: {
    s: {
      id: 's',
      text: 'hi',
      choices: [
        { id: 'a', label: 'A', ending: true, outcome: 'good' },
        { id: 'b', label: 'B', ending: true, outcome: 'bad' },
      ],
    },
  },
};

describe('scenarioEndingInfo', () => {
  const prisma = (paths: string[][]) => ({
    scenarioRun: {
      findMany: jest.fn(async () => paths.map((p) => ({ pathJson: p }))),
    },
  });

  it('a never-reached ending is new; a reached one is not', async () => {
    const p = prisma([['a']]);
    const input = { userId: 'u', scenarioId: 'sc', graph, runId: 'r2' };
    expect(
      await scenarioEndingInfo(p as never, { ...input, choiceIds: ['b'] }),
    ).toMatchObject({ isNewEnding: true, scenarioId: 'sc' });
    expect(
      await scenarioEndingInfo(p as never, { ...input, choiceIds: ['a'] }),
    ).toMatchObject({ isNewEnding: false });
    expect(p.scenarioRun.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: { not: 'r2' }, completed: true }),
      }),
    );
  });

  it('is undefined for an unfinished walk or a failed lookup', async () => {
    const input = { userId: 'u', scenarioId: 'sc', graph, runId: 'r' };
    expect(
      await scenarioEndingInfo(prisma([]) as never, {
        ...input,
        choiceIds: [],
      }),
    ).toBeUndefined();
    expect(
      await scenarioEndingInfo({ scenarioRun: {} } as never, {
        ...input,
        choiceIds: ['a'],
      }),
    ).toBeUndefined();
  });
});
