import { Injectable, Logger } from '@nestjs/common';
import {
  copyLocale,
  reactivationDay7Copy,
  type CopyLocale,
  welcomeBackQuestCopy,
  winbackCopy,
} from '../email/copy.js';
import { NotificationService } from '../notifications/notification.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { WelcomeBackQuest } from './welcome-back-quest.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const BATCH = 500;

/** docs/10 §13 stages (days lapsed). */
export const REACTIVATION_STAGES = [7, 14, 30, 90] as const;
export type ReactivationStage = 0 | (typeof REACTIVATION_STAGES)[number];

export const WINBACK_DEEP_LINK = '/subscription?offer=winback';

/** The highest stage a lapse of `days` has reached (0 = not lapsed). */
export function stageFor(days: number): ReactivationStage {
  if (days >= 90) return 90;
  if (days >= 30) return 30;
  if (days >= 14) return 14;
  if (days >= 7) return 7;
  return 0;
}

export interface ReactivationResult {
  scanned: number;
  day7: number;
  day14: number;
  day30: number;
  /** Day-30 users with an active subscription: no offer (stage still advances). */
  day30Subscribed: number;
  dormant: number;
}

/**
 * Daily reactivation sweep (docs/10 §13). A user is lapsed when there has
 * been no activity (`lastSeenAt`, else `createdAt`) for N days:
 *   - day 7  → one gentle REACTIVATION email (+ inbox);
 *   - day 14 → inbox + push: a welcome-back quest is waiting — the quest
 *     itself is assigned when they return (UserLifecycleService);
 *   - day 30 → one win-back offer (inbox + push + email) deep-linking to
 *     /subscription?offer=winback — free users only;
 *   - day 90 → `dormantAt` set: from then on only BILLING email reaches
 *     them (NotificationService).
 * Progress is `User.reactivationStage`, claimed with a conditional update
 * before anything is sent, so reruns and concurrent replicas never repeat
 * a stage. A user first seen far into a lapse jumps straight to the
 * highest stage reached (one message, not a burst). Any activity resets
 * the stage (auth middleware → UserLifecycleService). No daily nagging.
 */
@Injectable()
export class ReactivationService {
  private readonly logger = new Logger(ReactivationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
    private readonly welcomeBack: WelcomeBackQuest,
  ) {}

  async run(now: Date = new Date()): Promise<ReactivationResult> {
    const out: ReactivationResult = {
      scanned: 0,
      day7: 0,
      day14: 0,
      day30: 0,
      day30Subscribed: 0,
      dormant: 0,
    };
    const cutoff = new Date(now.getTime() - 7 * DAY_MS);
    let cursor: string | undefined;
    for (;;) {
      const users = await this.prisma.user.findMany({
        where: {
          role: 'STUDENT',
          deletedAt: null,
          suspendedAt: null,
          dormantAt: null,
          reactivationStage: { lt: 90 },
          OR: [
            { lastSeenAt: { lt: cutoff } },
            { lastSeenAt: null, createdAt: { lt: cutoff } },
          ],
        },
        select: {
          id: true,
          lastSeenAt: true,
          createdAt: true,
          reactivationStage: true,
        },
        orderBy: { id: 'asc' },
        take: BATCH,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      if (users.length === 0) break;
      for (const u of users) {
        out.scanned += 1;
        const since = u.lastSeenAt ?? u.createdAt;
        const target = stageFor(
          Math.floor((now.getTime() - since.getTime()) / DAY_MS),
        );
        if (target <= u.reactivationStage) continue;
        // Claim the stage first: only one run/replica gets to send it, and
        // a user who came back meanwhile (lastSeenAt moved) is left alone.
        const claimed = await this.prisma.user.updateMany({
          where: {
            id: u.id,
            reactivationStage: u.reactivationStage,
            lastSeenAt: u.lastSeenAt,
            dormantAt: null,
          },
          data: {
            reactivationStage: target,
            ...(target === 90 ? { dormantAt: now } : {}),
          },
        });
        if (claimed.count === 0) continue;
        await this.handleStage(u.id, target, now, out);
      }
      cursor = users[users.length - 1].id;
      if (users.length < BATCH) break;
    }
    this.logger.log(
      `reactivation: d7 ${out.day7}, d14 ${out.day14}, d30 ${out.day30} (+${out.day30Subscribed} subscribed), dormant ${out.dormant} of ${out.scanned} lapsed`,
    );
    return out;
  }

  private async handleStage(
    userId: string,
    stage: ReactivationStage,
    now: Date,
    out: ReactivationResult,
  ): Promise<void> {
    switch (stage) {
      case 7:
        await this.notifications.notify(
          userId,
          ({ locale, displayName }) => ({
            kind: 'REACTIVATION',
            ...reactivationDay7Copy(locale, displayName),
            deepLink: '/today',
            data: { type: 'reactivation', stage: '7' },
          }),
          { now, channels: { push: false, email: true } },
        );
        out.day7 += 1;
        return;
      case 14: {
        const coins = await this.welcomeBackCoins();
        await this.notifications.notify(
          userId,
          ({ locale }) => ({
            kind: 'REACTIVATION',
            ...welcomeBackQuestCopy(locale, coins[copyLocale(locale)]),
            deepLink: '/today',
            action: { type: 'open_daily_quest' },
            data: { type: 'reactivation', stage: '14' },
          }),
          { now, channels: { push: true, email: false } },
        );
        out.day14 += 1;
        return;
      }
      case 30: {
        if (await this.hasActiveSubscription(userId, now)) {
          out.day30Subscribed += 1;
          return;
        }
        await this.notifications.notify(
          userId,
          ({ locale }) => ({
            kind: 'REACTIVATION',
            ...winbackCopy(locale),
            deepLink: WINBACK_DEEP_LINK,
            action: { type: 'open_subscription' },
            data: { type: 'winback', stage: '30' },
          }),
          { now, channels: { push: true, email: true } },
        );
        out.day30 += 1;
        return;
      }
      case 90:
        out.dormant += 1;
        return;
      default:
        return;
    }
  }

  private async welcomeBackCoins(): Promise<Record<CopyLocale, number>> {
    const [pt, en] = await Promise.all([
      this.welcomeBack.template('pt-BR'),
      this.welcomeBack.template('en-US'),
    ]);
    return { 'pt-BR': pt.coinReward, 'en-US': en.coinReward };
  }

  private async hasActiveSubscription(userId: string, now: Date) {
    const sub = await this.prisma.subscription.findFirst({
      where: {
        userId,
        status: { in: ['ACTIVE', 'TRIALING', 'PAST_DUE'] },
        currentPeriodEnd: { gt: now },
      },
      select: { id: true },
    });
    return !!sub;
  }
}
