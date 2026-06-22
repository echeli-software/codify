import { Injectable, NotFoundException } from '@nestjs/common';
import { levelFromXp, tierForLevel } from '@codify/ui-core';
import { PrismaService } from '../prisma/prisma.service.js';

export interface PublicProfile {
  userId: string;
  displayName: string;
  level: number;
  tier: string;
  totalXp: number;
  avatar: {
    config: Record<string, unknown> | null;
    equipped: Record<string, { slug: string; name: string; spriteAssetId: string }>;
  };
  badges: { slug: string; name: string; iconName: string | null; awardedAt: string }[];
  stats: { lessonsCompleted: number; streakDays: number; longestStreak: number; friends: number };
}

/** Read-only public profile (docs/15 Phase 9) — avatar, badges, level, stats. */
@Injectable()
export class ProfileService {
  constructor(private readonly prisma: PrismaService) {}

  async get(userId: string): Promise<PublicProfile> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { id: true, displayName: true, totalXp: true, avatarConfig: true },
    });
    if (!user) throw new NotFoundException('User not found');

    const [equipped, userBadges, lessonsCompleted, streak, friendsA, friendsB] = await Promise.all([
      this.prisma.equippedItem.findMany({ where: { userId }, include: { item: true } }),
      this.prisma.userBadge.findMany({ where: { userId }, include: { badge: true }, orderBy: { awardedAt: 'desc' } }),
      this.prisma.progress.count({ where: { userId } }),
      this.prisma.streak.findUnique({ where: { userId } }),
      this.prisma.friendship.count({ where: { userAId: userId } }),
      this.prisma.friendship.count({ where: { userBId: userId } }),
    ]);

    const equippedMap: PublicProfile['avatar']['equipped'] = {};
    for (const e of equipped) {
      if (e.item.deletedAt) continue;
      equippedMap[e.slot] = { slug: e.item.slug, name: e.item.name, spriteAssetId: e.item.spriteAssetId };
    }

    const level = levelFromXp(user.totalXp);
    return {
      userId: user.id,
      displayName: user.displayName,
      level,
      tier: tierForLevel(level),
      totalXp: user.totalXp,
      avatar: { config: (user.avatarConfig as Record<string, unknown> | null) ?? null, equipped: equippedMap },
      badges: userBadges
        .filter((ub) => ub.badge.isActive)
        .map((ub) => ({ slug: ub.badge.slug, name: ub.badge.name, iconName: ub.badge.iconName, awardedAt: ub.awardedAt.toISOString() })),
      stats: {
        lessonsCompleted,
        streakDays: streak?.currentDays ?? 0,
        longestStreak: streak?.longestDays ?? 0,
        friends: friendsA + friendsB,
      },
    };
  }
}
