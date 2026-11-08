import type { PrismaService } from '../prisma/prisma.service.js';
import { UsersService } from './users.service.js';

/** LRN-10: the onboarding goal lives on the account (`User.onboardingGoal`). */
function setup(onboardingGoal: string | null) {
  const user = {
    id: 'u1',
    email: 's@codify.local',
    displayName: 'S',
    role: 'STUDENT',
    locale: 'pt-BR',
    timezone: 'America/Sao_Paulo',
    marketingEmailOptIn: false,
    quietHoursStart: null,
    quietHoursEnd: null,
    onboardedAt: null,
    lastSeenAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    totalXp: 0,
    coins: 0,
    petName: null,
    activityFeedOptIn: false,
    theme: null,
    onboardingGoal,
  };
  const prisma = {
    user: {
      findUnique: jest.fn(async () => user),
      update: jest.fn(
        async (a: { data: { onboardingGoal?: string | null } }) => ({
          ...user,
          ...a.data,
        }),
      ),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
    userItem: { findFirst: jest.fn(async () => null) },
  };
  return {
    svc: new UsersService(prisma as unknown as PrismaService),
    prisma,
  };
}

describe('UsersService onboardingGoal (LRN-10)', () => {
  it('GET /me returns the stored goal (null when none)', async () => {
    expect((await setup('ai').svc.getById('u1')).onboardingGoal).toBe('ai');
    expect((await setup(null).svc.getById('u1')).onboardingGoal).toBeNull();
  });

  it('PATCH /me stores a goal and null clears it', async () => {
    const { svc, prisma } = setup(null);
    const me = await svc.update('u1', { onboardingGoal: 'softSkills' });
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { onboardingGoal: 'softSkills' } }),
    );
    expect(me.onboardingGoal).toBe('softSkills');
    const cleared = await svc.update('u1', { onboardingGoal: null });
    expect(prisma.user.update).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: { onboardingGoal: null } }),
    );
    expect(cleared.onboardingGoal).toBeNull();
  });

  it('other PATCH fields leave the goal untouched', async () => {
    const { svc, prisma } = setup('career');
    await svc.update('u1', { displayName: 'New' });
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { displayName: 'New' } }),
    );
  });
});
