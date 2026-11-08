import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { currentWeekStart } from '@codify/domain';
import { levelFromXp } from '@codify/ui-core';
import { PrismaService } from '../prisma/prisma.service.js';
import { UserPushService } from '../gamification/user-push.service.js';
import { ReferralsService } from '../referrals/referrals.service.js';
import { ContentLocalizer } from '../translations/content-localizer.service.js';
import { contentTitles, coursesCompleted } from './learner-stats.js';

const NUDGE_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface FriendView {
  userId: string;
  displayName: string;
  level: number;
  since: string;
}
export interface FriendRequestView {
  id: string;
  senderId: string;
  senderName: string;
  createdAt: string;
}
export interface FriendInviteView {
  code: string;
  url: string;
}
/** One side of the friends "compare" card (docs/05 Friends). */
export interface CompareStats {
  userId: string;
  displayName: string;
  level: number;
  totalXp: number;
  /** XP in the current league week (0 when not placed yet). */
  weeklyXp: number;
  streakDays: number;
  longestStreak: number;
  lessonsCompleted: number;
  coursesCompleted: number;
  badges: number;
}
export interface FriendCompareView {
  me: CompareStats;
  friend: CompareStats;
}

/** Friends activity feed entry (docs/10 §5: opt-in, friend-only). */
export interface ActivityFeedEntry {
  /** `lesson:<progressId>` / `badge:<userId>:<badgeId>` — stable for tracking. */
  id: string;
  kind: 'LESSON_COMPLETED' | 'BADGE_UNLOCKED';
  userId: string;
  displayName: string;
  at: string;
  lessonId?: string;
  lessonTitle?: string | null;
  courseTitle?: string | null;
  badgeName?: string;
  badgeIcon?: string | null;
}

/** Activity older than this never shows in the feed. */
const FEED_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

export interface AcceptInviteResult {
  status: 'accepted' | 'already_friends';
  friend: { userId: string; displayName: string };
}

/** Ordered friendship key (userAId < userBId). */
function pair(a: string, b: string): { userAId: string; userBId: string } {
  return a < b ? { userAId: a, userBId: b } : { userAId: b, userBId: a };
}

@Injectable()
export class FriendsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly push: UserPushService,
    private readonly referrals: ReferralsService,
    @Optional() private readonly localizer?: ContentLocalizer,
  ) {}

  /** The friend ids of `userId` (deleted accounts excluded). */
  private async friendIds(userId: string): Promise<string[]> {
    const rows = await this.prisma.friendship.findMany({
      where: {
        OR: [
          { userAId: userId, userB: { deletedAt: null } },
          { userBId: userId, userA: { deletedAt: null } },
        ],
      },
      select: { userAId: true, userBId: true },
    });
    return rows.map((r) => (r.userAId === userId ? r.userBId : r.userAId));
  }

  // ─── Compare + activity feed ──────────────────────────────────────────

  /**
   * Side-by-side stats with a friend (docs/05 Friends "compare"). 403
   * `FRIEND_REQUIRED` unless the two are friends.
   */
  async compare(userId: string, friendId: string): Promise<FriendCompareView> {
    if (
      friendId === userId ||
      !(await this.friendIds(userId)).includes(friendId)
    )
      throw new ForbiddenException({
        code: 'FRIEND_REQUIRED',
        message: 'You can only compare with friends',
      });
    const ids = [userId, friendId];
    const weekStart = currentWeekStart();
    const [users, streaks, lessons, badges, weekly, courses] =
      await Promise.all([
        this.prisma.user.findMany({
          where: { id: { in: ids } },
          select: { id: true, displayName: true, totalXp: true },
        }),
        this.prisma.streak.findMany({ where: { userId: { in: ids } } }),
        this.prisma.progress.groupBy({
          by: ['userId'],
          where: { userId: { in: ids } },
          _count: { _all: true },
        }),
        this.prisma.userBadge.groupBy({
          by: ['userId'],
          where: { userId: { in: ids }, badge: { isActive: true } },
          _count: { _all: true },
        }),
        this.prisma.leagueMembership.findMany({
          where: { userId: { in: ids }, league: { weekStart } },
          select: { userId: true, weeklyXp: true },
        }),
        coursesCompleted(this.prisma, ids),
      ]);
    const stats = (id: string): CompareStats => {
      const u = users.find((x) => x.id === id);
      if (!u) throw new NotFoundException('User not found');
      const s = streaks.find((x) => x.userId === id);
      return {
        userId: id,
        displayName: u.displayName,
        level: levelFromXp(u.totalXp),
        totalXp: u.totalXp,
        weeklyXp: weekly.find((x) => x.userId === id)?.weeklyXp ?? 0,
        streakDays: s?.currentDays ?? 0,
        longestStreak: s?.longestDays ?? 0,
        lessonsCompleted:
          lessons.find((x) => x.userId === id)?._count._all ?? 0,
        coursesCompleted: courses.get(id) ?? 0,
        badges: badges.find((x) => x.userId === id)?._count._all ?? 0,
      };
    };
    return { me: stats(userId), friend: stats(friendId) };
  }

  /**
   * Recent lesson completions and badge unlocks of the caller's friends
   * who opted in (`User.activityFeedOptIn`), newest first, last 14 days.
   * Friends who didn't opt in never appear (docs/10 §5).
   */
  async activity(userId: string, limit = 20): Promise<ActivityFeedEntry[]> {
    const ids = await this.friendIds(userId);
    if (ids.length === 0) return [];
    const friends = await this.prisma.user.findMany({
      where: { id: { in: ids }, activityFeedOptIn: true, deletedAt: null },
      select: { id: true, displayName: true },
    });
    if (friends.length === 0) return [];
    const names = new Map(friends.map((f) => [f.id, f.displayName]));
    const visible = [...names.keys()];
    const since = new Date(Date.now() - FEED_WINDOW_MS);
    const take = Math.min(Math.max(limit, 1), 50);
    const [progress, badges] = await Promise.all([
      this.prisma.progress.findMany({
        where: { userId: { in: visible }, completedAt: { gte: since } },
        orderBy: { completedAt: 'desc' },
        take,
        select: {
          id: true,
          userId: true,
          lessonId: true,
          completedAt: true,
          lesson: {
            select: {
              module: {
                select: {
                  course: { select: { id: true, sourceLocale: true } },
                },
              },
            },
          },
        },
      }),
      this.prisma.userBadge.findMany({
        where: {
          userId: { in: visible },
          awardedAt: { gte: since },
          badge: { isActive: true, isHidden: false },
        },
        orderBy: { awardedAt: 'desc' },
        take,
        include: { badge: true },
      }),
    ]);

    const locale = (await this.localizer?.requestLocale()) ?? 'pt-BR';
    const lessonSrc = new Map(
      progress.map((p) => [p.lessonId, p.lesson.module.course.sourceLocale]),
    );
    const courseSrc = new Map(
      progress.map((p) => [
        p.lesson.module.course.id,
        p.lesson.module.course.sourceLocale,
      ]),
    );
    const [lessonTitles, courseTitles, tr] = await Promise.all([
      contentTitles(this.prisma, 'LESSON', lessonSrc, locale),
      contentTitles(this.prisma, 'COURSE', courseSrc, locale),
      this.localizer?.localize([
        {
          entityType: 'BADGE',
          items: badges.map((b) => ({
            id: b.badgeId,
            values: { name: b.badge.name },
          })),
        },
      ]),
    ]);

    const entries: ActivityFeedEntry[] = [
      ...progress.map(
        (p): ActivityFeedEntry => ({
          id: `lesson:${p.id}`,
          kind: 'LESSON_COMPLETED',
          userId: p.userId,
          displayName: names.get(p.userId) ?? '',
          at: p.completedAt.toISOString(),
          lessonId: p.lessonId,
          lessonTitle: lessonTitles.get(p.lessonId) ?? null,
          courseTitle: courseTitles.get(p.lesson.module.course.id) ?? null,
        }),
      ),
      ...badges.map(
        (b): ActivityFeedEntry => ({
          id: `badge:${b.userId}:${b.badgeId}`,
          kind: 'BADGE_UNLOCKED',
          userId: b.userId,
          displayName: names.get(b.userId) ?? '',
          at: b.awardedAt.toISOString(),
          badgeName:
            tr?.text('BADGE', b.badgeId, 'name', b.badge.name) ?? b.badge.name,
          badgeIcon: b.badge.iconName,
        }),
      ),
    ];
    entries.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
    return entries.slice(0, take);
  }

  /**
   * Send a friend request by email. The response is identical whether or not
   * the email belongs to an account (and whether a request/friendship already
   * exists), so the endpoint can't be used to enumerate registered emails.
   */
  async sendRequest(
    senderId: string,
    email: string,
  ): Promise<{ status: 'sent' }> {
    const normalized = email.toLowerCase().trim();
    const sender = await this.prisma.user.findUniqueOrThrow({
      where: { id: senderId },
      select: { email: true },
    });
    if (sender.email.toLowerCase() === normalized)
      throw new BadRequestException({
        code: 'FRIEND_SELF',
        message: 'You cannot friend yourself',
      });

    const receiver = await this.prisma.user.findFirst({
      where: { email: normalized, deletedAt: null },
      select: { id: true },
    });
    if (!receiver) return { status: 'sent' };

    const key = pair(senderId, receiver.id);
    const friendship = await this.prisma.friendship.findUnique({
      where: { userAId_userBId: key },
    });
    if (friendship) return { status: 'sent' };

    // Reuse a pending request in either direction.
    const existing = await this.prisma.friendRequest.findFirst({
      where: {
        status: 'PENDING',
        OR: [
          { senderId, receiverId: receiver.id },
          { senderId: receiver.id, receiverId: senderId },
        ],
      },
      select: { id: true },
    });
    if (!existing) {
      await this.prisma.friendRequest.create({
        data: { senderId, receiverId: receiver.id, status: 'PENDING' },
      });
    }
    return { status: 'sent' };
  }

  async incomingRequests(userId: string): Promise<FriendRequestView[]> {
    const rows = await this.prisma.friendRequest.findMany({
      where: { receiverId: userId, status: 'PENDING' },
      include: { sender: { select: { displayName: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => ({
      id: r.id,
      senderId: r.senderId,
      senderName: r.sender.displayName,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  async respond(
    userId: string,
    requestId: string,
    accept: boolean,
  ): Promise<{ status: string }> {
    const req = await this.prisma.friendRequest.findUnique({
      where: { id: requestId },
    });
    if (!req || req.receiverId !== userId)
      throw new NotFoundException('Request not found');
    if (req.status !== 'PENDING')
      throw new ConflictException('Request already resolved');

    if (!accept) {
      await this.prisma.friendRequest.update({
        where: { id: requestId },
        data: { status: 'REJECTED', resolvedAt: new Date() },
      });
      return { status: 'rejected' };
    }
    const key = pair(req.senderId, req.receiverId);
    await this.prisma.$transaction([
      this.prisma.friendRequest.update({
        where: { id: requestId },
        data: { status: 'ACCEPTED', resolvedAt: new Date() },
      }),
      this.prisma.friendship.upsert({
        where: { userAId_userBId: key },
        create: key,
        update: {},
      }),
    ]);
    return { status: 'accepted' };
  }

  async list(userId: string): Promise<FriendView[]> {
    const rows = await this.prisma.friendship.findMany({
      // Friends whose account is deleted (pending purge) are hidden.
      where: {
        OR: [
          { userAId: userId, userB: { deletedAt: null } },
          { userBId: userId, userA: { deletedAt: null } },
        ],
      },
      include: {
        userA: { select: { id: true, displayName: true, totalXp: true } },
        userB: { select: { id: true, displayName: true, totalXp: true } },
      },
      orderBy: { since: 'desc' },
    });
    return rows.map((r) => {
      const friend = r.userAId === userId ? r.userB : r.userA;
      return {
        userId: friend.id,
        displayName: friend.displayName,
        level: levelFromXp(friend.totalXp),
        since: r.since.toISOString(),
      };
    });
  }

  /**
   * Nudge a friend — rate-limited to one per friend per 24h — and push a
   * FRIEND_NUDGE to them (quiet hours respected by the push helper).
   */
  async nudge(
    senderId: string,
    friendId: string,
  ): Promise<{ status: string; pushed: boolean }> {
    const key = pair(senderId, friendId);
    const friendship = await this.prisma.friendship.findUnique({
      where: { userAId_userBId: key },
    });
    if (!friendship) throw new ForbiddenException('You can only nudge friends');

    const sender = await this.prisma.$transaction(async (tx) => {
      // Serialize nudges for this (sender, receiver) pair so two concurrent
      // taps can't both pass the 24h check.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`nudge:${senderId}:${friendId}`}))`;
      const recent = await tx.friendNudge.findFirst({
        where: {
          senderId,
          receiverId: friendId,
          createdAt: { gt: new Date(Date.now() - NUDGE_WINDOW_MS) },
        },
        select: { id: true },
      });
      if (recent)
        throw new ConflictException('You already nudged this friend recently');
      await tx.friendNudge.create({ data: { senderId, receiverId: friendId } });
      return tx.user.findUniqueOrThrow({
        where: { id: senderId },
        select: { displayName: true },
      });
    });

    const res = await this.push.sendToUser(friendId, ({ locale }) =>
      nudgeCopy(locale, sender.displayName, senderId),
    );
    return { status: 'nudged', pushed: res.sent > 0 };
  }

  // ─── Invite links ─────────────────────────────────────────────────────

  /**
   * The caller's friend-invite link. Reuses their referral code, so one
   * shared link both attributes a signup (referral) and connects friends.
   */
  async invite(userId: string): Promise<FriendInviteView> {
    const code = await this.referrals.getOrCreateCode(userId);
    return { code, url: this.referrals.shareUrl(code) };
  }

  /**
   * Accept an invite: befriend the code's owner. Idempotent (a second accept
   * reports `already_friends`); any pending request between the two is
   * resolved as accepted. You can't accept your own invite.
   */
  async acceptInvite(
    userId: string,
    code: string,
  ): Promise<AcceptInviteResult> {
    const owner = await this.prisma.user.findFirst({
      where: { referralCode: code.trim().toUpperCase(), deletedAt: null },
      select: { id: true, displayName: true },
    });
    if (!owner)
      throw new NotFoundException({
        code: 'INVITE_NOT_FOUND',
        message: 'Invite not found',
      });
    if (owner.id === userId)
      throw new BadRequestException({
        code: 'FRIEND_SELF',
        message: 'You cannot friend yourself',
      });

    const key = pair(userId, owner.id);
    const existing = await this.prisma.friendship.findUnique({
      where: { userAId_userBId: key },
    });
    const friend = { userId: owner.id, displayName: owner.displayName };
    if (existing) return { status: 'already_friends', friend };

    await this.prisma.$transaction([
      this.prisma.friendship.upsert({
        where: { userAId_userBId: key },
        create: key,
        update: {},
      }),
      this.prisma.friendRequest.updateMany({
        where: {
          status: 'PENDING',
          OR: [
            { senderId: userId, receiverId: owner.id },
            { senderId: owner.id, receiverId: userId },
          ],
        },
        data: { status: 'ACCEPTED', resolvedAt: new Date() },
      }),
    ]);
    return { status: 'accepted', friend };
  }
}

function nudgeCopy(locale: string, senderName: string, senderId: string) {
  const pt = locale.startsWith('pt');
  return {
    kind: 'FRIEND_NUDGE' as const,
    title: pt ? `👋 ${senderName} te cutucou!` : `👋 ${senderName} nudged you!`,
    body: pt ? 'Bora fazer uma lição hoje?' : 'Fancy a quick lesson today?',
    data: { senderId, route: '/friends' },
  };
}
