import type { QuestsService } from '../gamification/quests.service.js';
import { WELCOME_BACK_COINS, WelcomeBackQuest } from './welcome-back-quest.js';

function setup(existing: { id: string; coinReward: number } | null = null) {
  const prisma = {
    questTemplate: {
      findUnique: jest.fn(async () => existing),
      upsert: jest.fn(
        async (args: { create: { slug: string; coinReward: number } }) => ({
          id: `tpl-${args.create.slug}`,
          coinReward: args.create.coinReward,
        }),
      ),
    },
    questAssignment: {
      createMany: jest.fn(async () => ({ count: 1 })),
    },
  };
  const quests = { ensureAssigned: jest.fn(async () => 3) };
  return {
    svc: new WelcomeBackQuest(
      prisma as never,
      quests as unknown as QuestsService,
    ),
    prisma,
    quests,
  };
}

describe('WelcomeBackQuest', () => {
  it('creates an inactive LESSON_COUNT(1) template per locale on first use', async () => {
    const { svc, prisma } = setup();
    expect(await svc.template('en')).toEqual({
      id: 'tpl-welcome-back-en-us',
      coinReward: WELCOME_BACK_COINS,
    });
    expect(prisma.questTemplate.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          slug: 'welcome-back-en-us',
          kind: 'LESSON_COUNT',
          target: 1,
          isActive: false,
          title: 'Welcome back: finish 1 lesson',
        }),
      }),
    );
  });

  it("assigns it for the user's local today, after the regular daily quests", async () => {
    const { svc, prisma, quests } = setup({ id: 'tpl', coinReward: 300 });
    // 02:00Z on the 8th = 23:00 on the 7th in São Paulo.
    const now = new Date('2026-10-08T02:00:00Z');
    expect(await svc.assign('u1', 'America/Sao_Paulo', 'pt-BR', now)).toBe(
      true,
    );
    const day = new Date('2026-10-07T00:00:00Z');
    expect(quests.ensureAssigned).toHaveBeenCalledWith('u1', day);
    expect(prisma.questAssignment.createMany).toHaveBeenCalledWith({
      data: [{ userId: 'u1', templateId: 'tpl', assignedFor: day }],
      skipDuplicates: true,
    });
    const order = [
      quests.ensureAssigned.mock.invocationCallOrder[0],
      prisma.questAssignment.createMany.mock.invocationCallOrder[0],
    ];
    expect(order[0]).toBeLessThan(order[1]);
  });
});
