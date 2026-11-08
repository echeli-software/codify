import { Injectable, NotFoundException, Optional } from '@nestjs/common';
import { effectiveStreak, localDateKey } from '@codify/domain';
import { levelFromXp, tierForLevel } from '@codify/ui-core';
import { PrismaService } from '../prisma/prisma.service.js';
import { loadSpriteUrls, spriteUrlFor } from '../items/sprite-urls.js';
import { ContentLocalizer } from '../translations/content-localizer.service.js';
import { coursesCompleted } from './learner-stats.js';
import { toStreakState } from '../gamification/gamification.service.js';

export interface PublicProfile {
  userId: string;
  displayName: string;
  level: number;
  tier: string;
  totalXp: number;
  /** The user's name for their pet (docs/08 §10). */
  petName: string | null;
  avatar: {
    config: Record<string, unknown> | null;
    equipped: Record<
      string,
      {
        slug: string;
        name: string;
        spriteAssetId: string;
        spriteUrl: string | null;
      }
    >;
  };
  badges: {
    slug: string;
    name: string;
    iconName: string | null;
    awardedAt: string;
  }[];
  stats: {
    lessonsCompleted: number;
    streakDays: number;
    longestStreak: number;
    friends: number;
    coursesCompleted: number;
    itemsOwned: number;
  };
}

/** Read-only public profile (docs/15 Phase 9) — avatar, badges, level, stats. */
@Injectable()
export class ProfileService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly localizer?: ContentLocalizer,
  ) {}

  async get(userId: string): Promise<PublicProfile> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: {
        id: true,
        displayName: true,
        totalXp: true,
        avatarConfig: true,
        petName: true,
        timezone: true,
      },
    });
    if (!user) throw new NotFoundException('User not found');

    const [
      equipped,
      userBadges,
      lessonsCompleted,
      streak,
      friendsA,
      friendsB,
      courses,
      itemsOwned,
    ] = await Promise.all([
      this.prisma.equippedItem.findMany({
        where: { userId },
        include: { item: true },
      }),
      this.prisma.userBadge.findMany({
        where: { userId },
        include: { badge: true },
        orderBy: { awardedAt: 'desc' },
      }),
      this.prisma.progress.count({ where: { userId } }),
      this.prisma.streak.findUnique({ where: { userId } }),
      this.prisma.friendship.count({ where: { userAId: userId } }),
      this.prisma.friendship.count({ where: { userBId: userId } }),
      coursesCompleted(this.prisma, [userId]),
      this.prisma.userItem.count({
        where: { userId, item: { deletedAt: null } },
      }),
    ]);

    const spriteUrls = await loadSpriteUrls(
      this.prisma,
      equipped.map((e) => e.item.spriteAssetId),
    );
    const equippedMap: PublicProfile['avatar']['equipped'] = {};
    for (const e of equipped) {
      if (e.item.deletedAt) continue;
      equippedMap[e.slot] = {
        slug: e.item.slug,
        name: e.item.name,
        spriteAssetId: e.item.spriteAssetId,
        spriteUrl: spriteUrlFor(e.item.spriteAssetId, spriteUrls),
      };
    }

    // Item + badge names in the viewer's locale (docs/11 §3), one query.
    const shownBadges = userBadges.filter((ub) => ub.badge.isActive);
    const tr = await this.localizer?.localize([
      {
        entityType: 'ITEM',
        items: equipped
          .filter((e) => !e.item.deletedAt)
          .map((e) => ({ id: e.itemId, values: { name: e.item.name } })),
      },
      {
        entityType: 'BADGE',
        items: shownBadges.map((ub) => ({
          id: ub.badgeId,
          values: { name: ub.badge.name },
        })),
      },
    ]);
    for (const e of equipped) {
      const ref = equippedMap[e.slot];
      if (ref && tr) ref.name = tr.text('ITEM', e.itemId, 'name', ref.name);
    }

    const level = levelFromXp(user.totalXp);
    const liveStreak = effectiveStreak(
      streak ? toStreakState(streak) : null,
      localDateKey(new Date(), user.timezone),
    );
    return {
      userId: user.id,
      displayName: user.displayName,
      level,
      tier: tierForLevel(level),
      totalXp: user.totalXp,
      petName: user.petName ?? null,
      avatar: {
        config: (user.avatarConfig as Record<string, unknown> | null) ?? null,
        equipped: equippedMap,
      },
      badges: shownBadges.map((ub) => ({
        slug: ub.badge.slug,
        name:
          tr?.text('BADGE', ub.badgeId, 'name', ub.badge.name) ?? ub.badge.name,
        iconName: ub.badge.iconName,
        awardedAt: ub.awardedAt.toISOString(),
      })),
      stats: {
        lessonsCompleted,
        // Settled for today, like the summary (a missed day shows 0, not the
        // stale count the hourly settlement job hasn't written yet).
        streakDays: liveStreak.currentDays,
        longestStreak: liveStreak.longestDays,
        friends: friendsA + friendsB,
        coursesCompleted: courses.get(userId) ?? 0,
        itemsOwned,
      },
    };
  }
}
