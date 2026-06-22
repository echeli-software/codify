import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { levelFromXp } from '@codify/ui-core';
import { PrismaService } from '../prisma/prisma.service.js';

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

/** Ordered friendship key (userAId < userBId). */
function pair(a: string, b: string): { userAId: string; userBId: string } {
  return a < b ? { userAId: a, userBId: b } : { userAId: b, userBId: a };
}

@Injectable()
export class FriendsService {
  constructor(private readonly prisma: PrismaService) {}

  async sendRequest(senderId: string, email: string): Promise<{ status: string; requestId?: string }> {
    const receiver = await this.prisma.user.findUnique({ where: { email: email.toLowerCase().trim() }, select: { id: true } });
    if (!receiver) throw new NotFoundException('No user with that email');
    if (receiver.id === senderId) throw new BadRequestException('You cannot friend yourself');

    const key = pair(senderId, receiver.id);
    const friendship = await this.prisma.friendship.findUnique({ where: { userAId_userBId: key } });
    if (friendship) throw new ConflictException('Already friends');

    // Reuse a pending request in either direction.
    const existing = await this.prisma.friendRequest.findFirst({
      where: {
        status: 'PENDING',
        OR: [
          { senderId, receiverId: receiver.id },
          { senderId: receiver.id, receiverId: senderId },
        ],
      },
    });
    if (existing) return { status: 'pending', requestId: existing.id };

    const created = await this.prisma.friendRequest.create({
      data: { senderId, receiverId: receiver.id, status: 'PENDING' },
    });
    return { status: 'sent', requestId: created.id };
  }

  async incomingRequests(userId: string): Promise<FriendRequestView[]> {
    const rows = await this.prisma.friendRequest.findMany({
      where: { receiverId: userId, status: 'PENDING' },
      include: { sender: { select: { displayName: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => ({ id: r.id, senderId: r.senderId, senderName: r.sender.displayName, createdAt: r.createdAt.toISOString() }));
  }

  async respond(userId: string, requestId: string, accept: boolean): Promise<{ status: string }> {
    const req = await this.prisma.friendRequest.findUnique({ where: { id: requestId } });
    if (!req || req.receiverId !== userId) throw new NotFoundException('Request not found');
    if (req.status !== 'PENDING') throw new ConflictException('Request already resolved');

    if (!accept) {
      await this.prisma.friendRequest.update({ where: { id: requestId }, data: { status: 'REJECTED', resolvedAt: new Date() } });
      return { status: 'rejected' };
    }
    const key = pair(req.senderId, req.receiverId);
    await this.prisma.$transaction([
      this.prisma.friendRequest.update({ where: { id: requestId }, data: { status: 'ACCEPTED', resolvedAt: new Date() } }),
      this.prisma.friendship.upsert({ where: { userAId_userBId: key }, create: key, update: {} }),
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
      return { userId: friend.id, displayName: friend.displayName, level: levelFromXp(friend.totalXp), since: r.since.toISOString() };
    });
  }

  /** Nudge a friend — rate-limited to one per friend per 24h. */
  async nudge(senderId: string, friendId: string): Promise<{ status: string }> {
    const key = pair(senderId, friendId);
    const friendship = await this.prisma.friendship.findUnique({ where: { userAId_userBId: key } });
    if (!friendship) throw new ForbiddenException('You can only nudge friends');

    const recent = await this.prisma.friendNudge.findFirst({
      where: { senderId, receiverId: friendId, createdAt: { gt: new Date(Date.now() - NUDGE_WINDOW_MS) } },
    });
    if (recent) throw new ConflictException('You already nudged this friend recently');

    await this.prisma.friendNudge.create({ data: { senderId, receiverId: friendId } });
    // A real push notification would be enqueued here (FRIEND_NUDGE).
    return { status: 'nudged' };
  }
}
