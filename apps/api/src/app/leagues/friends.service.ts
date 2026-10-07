import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { levelFromXp } from '@codify/ui-core';
import { PrismaService } from '../prisma/prisma.service.js';
import { UserPushService } from '../gamification/user-push.service.js';
import { ReferralsService } from '../referrals/referrals.service.js';

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
  ) {}

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
      throw new BadRequestException('You cannot friend yourself');

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
      where: { OR: [{ userAId: userId }, { userBId: userId }] },
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
    if (!owner) throw new NotFoundException('Invite not found');
    if (owner.id === userId)
      throw new BadRequestException('You cannot friend yourself');

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
