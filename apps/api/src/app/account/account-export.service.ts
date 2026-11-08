import { Injectable, NotFoundException } from '@nestjs/common';
import { retryAfterSeconds } from '../exercises/rate-limit.js';
import { PrismaService } from '../prisma/prisma.service.js';

/** One export per user per window (docs/14 §13 right of access). */
export const EXPORT_COOLDOWN_MS = 10 * 60 * 1000;
export const EXPORT_AUDIT_ACTION = 'user.data_export';
export const EXPORT_FORMAT_VERSION = 1;

/**
 * Builds the GET /me/export JSON: everything we hold about the caller
 * (docs/14 §13). Friends are reduced to id + display name — the other
 * person's data is not the caller's to export. Secrets that never belong
 * to the user (exercise solutions, hidden tests) are never joined in.
 */
@Injectable()
export class AccountExportService {
  constructor(private readonly prisma: PrismaService) {}

  /** Seconds until the caller may export again (0 = now). Audit-log backed. */
  async retryAfter(userId: string, now = Date.now()): Promise<number> {
    const last = await this.prisma.auditLog.findFirst({
      where: {
        action: EXPORT_AUDIT_ACTION,
        entity: 'User',
        entityId: userId,
        createdAt: { gt: new Date(now - EXPORT_COOLDOWN_MS) },
      },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    return last
      ? retryAfterSeconds([last.createdAt], 1, EXPORT_COOLDOWN_MS, now)
      : 0;
  }

  async build(
    userId: string,
    now = new Date(),
  ): Promise<Record<string, unknown>> {
    const p = this.prisma;
    const where = { userId };
    const profile = await p.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        displayName: true,
        locale: true,
        timezone: true,
        role: true,
        quietHoursStart: true,
        quietHoursEnd: true,
        marketingEmailOptIn: true,
        referralCode: true,
        referredById: true,
        onboardedAt: true,
        lastSeenAt: true,
        createdAt: true,
        updatedAt: true,
        totalXp: true,
        coins: true,
        avatarConfig: true,
        pushDailyCap: true,
        pushWeeklyOptIn: true,
        reminderMinute: true,
        deletionRequestedAt: true,
        deletedAt: true,
        birthDate: true,
        streak: {
          select: {
            currentDays: true,
            longestDays: true,
            freezesAvailable: true,
            lastActivityDate: true,
          },
        },
      },
    });
    if (!profile) throw new NotFoundException('User not found');

    const [
      enrollments,
      progress,
      quizAttempts,
      exerciseSubmissions,
      aiSubmissions,
      scenarioRuns,
      xpEvents,
      coinTransactions,
      items,
      equipped,
      badges,
      quests,
      leagueMemberships,
      friendshipsA,
      friendshipsB,
      subscriptions,
      payments,
      notifications,
      notificationPreferences,
      certificates,
      analyticsEvents,
    ] = await Promise.all([
      p.enrollment.findMany({
        where,
        orderBy: { createdAt: 'asc' },
        select: {
          courseId: true,
          course: { select: { slug: true } },
          source: true,
          accessUntil: true,
          createdAt: true,
        },
      }),
      p.progress.findMany({
        where,
        orderBy: { completedAt: 'asc' },
        select: {
          lessonId: true,
          completedAt: true,
          xpAwarded: true,
          coinsAwarded: true,
        },
      }),
      p.quizAttempt.findMany({
        where,
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          lessonId: true,
          answersJson: true,
          scorePct: true,
          passed: true,
          createdAt: true,
        },
      }),
      p.submission.findMany({
        where,
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          exerciseId: true,
          code: true,
          scored: true,
          status: true,
          verdict: true,
          scorePct: true,
          runtimeMs: true,
          memoryKb: true,
          output: true,
          resultJson: true,
          createdAt: true,
          completedAt: true,
        },
      }),
      p.aiSubmission.findMany({
        where,
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          aiPromptId: true,
          response: true,
          scorePct: true,
          passed: true,
          breakdownJson: true,
          gradedBy: true,
          createdAt: true,
        },
      }),
      p.scenarioRun.findMany({
        where,
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          scenarioId: true,
          pathJson: true,
          maxDepth: true,
          completed: true,
          outcome: true,
          createdAt: true,
        },
      }),
      p.xpEvent.findMany({
        where,
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          source: true,
          amount: true,
          multiplier: true,
          refType: true,
          refId: true,
          createdAt: true,
        },
      }),
      p.coinTransaction.findMany({
        where,
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          delta: true,
          source: true,
          multiplier: true,
          balanceAfter: true,
          refType: true,
          refId: true,
          createdAt: true,
        },
      }),
      p.userItem.findMany({
        where,
        orderBy: { acquiredAt: 'asc' },
        select: {
          itemId: true,
          item: { select: { slug: true, name: true, slot: true } },
          source: true,
          acquiredAt: true,
        },
      }),
      p.equippedItem.findMany({
        where,
        select: { slot: true, itemId: true, item: { select: { slug: true } } },
      }),
      p.userBadge.findMany({
        where,
        orderBy: { awardedAt: 'asc' },
        select: {
          badgeId: true,
          badge: { select: { slug: true, name: true } },
          awardedAt: true,
        },
      }),
      p.questAssignment.findMany({
        where,
        orderBy: { assignedFor: 'asc' },
        select: {
          id: true,
          template: { select: { slug: true, title: true, target: true } },
          assignedFor: true,
          progress: true,
          completedAt: true,
        },
      }),
      p.leagueMembership.findMany({
        where,
        select: {
          leagueId: true,
          league: { select: { tier: true, weekStart: true } },
          weeklyXp: true,
          finalRank: true,
          promoted: true,
          demoted: true,
        },
      }),
      p.friendship.findMany({
        where: { userAId: userId },
        select: {
          since: true,
          userB: { select: { id: true, displayName: true } },
        },
      }),
      p.friendship.findMany({
        where: { userBId: userId },
        select: {
          since: true,
          userA: { select: { id: true, displayName: true } },
        },
      }),
      p.subscription.findMany({
        where,
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          planId: true,
          plan: { select: { name: true } },
          source: true,
          status: true,
          currentPeriodStart: true,
          currentPeriodEnd: true,
          cancelAtPeriodEnd: true,
          canceledAt: true,
          trialEndsAt: true,
          createdAt: true,
        },
      }),
      p.payment.findMany({
        where,
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          provider: true,
          externalId: true,
          subscriptionId: true,
          amountCents: true,
          currency: true,
          status: true,
          method: true,
          refundedCents: true,
          receiptUrl: true,
          paidAt: true,
          createdAt: true,
        },
      }),
      p.notification.findMany({
        where,
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          channel: true,
          kind: true,
          payload: true,
          scheduledFor: true,
          sentAt: true,
          readAt: true,
          createdAt: true,
        },
      }),
      p.notificationPreference.findMany({
        where,
        select: {
          kind: true,
          pushEnabled: true,
          emailEnabled: true,
          fewerLevel: true,
          updatedAt: true,
        },
      }),
      p.certificate.findMany({
        where,
        orderBy: { issuedAt: 'asc' },
        select: {
          serial: true,
          courseId: true,
          courseTitle: true,
          recipientName: true,
          isCapstone: true,
          issuedAt: true,
        },
      }),
      p.analyticsEvent.findMany({
        where,
        orderBy: { occurredAt: 'asc' },
        select: {
          name: true,
          props: true,
          platform: true,
          appVersion: true,
          occurredAt: true,
          createdAt: true,
        },
      }),
    ]);

    // Parent / guardian confirmations given for this account's checkouts.
    const guardianConsents = await p.guardianConsent.findMany({
      where,
      orderBy: { confirmedAt: 'asc' },
      select: {
        guardianName: true,
        guardianEmail: true,
        purpose: true,
        planPriceId: true,
        confirmedAt: true,
      },
    });

    const friends = [
      ...friendshipsA.map((f) => ({ ...f.userB, since: f.since })),
      ...friendshipsB.map((f) => ({ ...f.userA, since: f.since })),
    ];

    return {
      formatVersion: EXPORT_FORMAT_VERSION,
      exportedAt: now.toISOString(),
      userId,
      profile,
      enrollments,
      progress,
      quizAttempts,
      exerciseSubmissions,
      aiSubmissions,
      scenarioRuns,
      xpEvents,
      coinTransactions,
      items,
      equipped,
      badges,
      quests,
      leagueMemberships,
      friends,
      subscriptions,
      payments,
      notifications,
      notificationPreferences,
      certificates,
      analyticsEvents,
      guardianConsents,
    };
  }
}
