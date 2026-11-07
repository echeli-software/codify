import { Injectable, Logger } from '@nestjs/common';
import { welcomeCopy } from '../email/copy.js';
import { NotificationService } from '../notifications/notification.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { claimOnce } from './claims.js';
import { WelcomeBackQuest } from './welcome-back-quest.js';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Reactivation stages start at 7 days lapsed; check returns from 6. */
const LAPSE_CHECK_MS = 6 * DAY_MS;
/** Stage at which a return earns the welcome-back quest (docs/10 §13). */
export const WELCOME_BACK_STAGE = 14;

/**
 * Hooks the auth middleware calls (fire-and-forget) around `lastSeenAt`:
 *   - `onCreated` — a user row was just provisioned → WELCOME (inbox +
 *     email), once per user.
 *   - `onSeen` — the periodic lastSeenAt refresh. A first-ever request
 *     (row created by the Clerk webhook, lastSeenAt still null) sends the
 *     WELCOME; a return after a lapse resets `reactivationStage` to 0 and
 *     clears `dormantAt`, and — when the lapse reached day 14 — assigns
 *     the welcome-back quest.
 * Never throws.
 */
@Injectable()
export class UserLifecycleService {
  private readonly logger = new Logger(UserLifecycleService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
    private readonly welcomeBack: WelcomeBackQuest,
  ) {}

  onCreated(userId: string): void {
    void this.welcome(userId).catch((err: Error) =>
      this.logger.warn(`welcome for ${userId} failed: ${err.message}`),
    );
  }

  onSeen(
    row: { id: string; lastSeenAt: Date | null },
    now: Date = new Date(),
  ): void {
    const work = async () => {
      if (!row.lastSeenAt) await this.welcome(row.id);
      if (
        !row.lastSeenAt ||
        now.getTime() - row.lastSeenAt.getTime() >= LAPSE_CHECK_MS
      ) {
        await this.returned(row.id, now);
      }
    };
    void work().catch((err: Error) =>
      this.logger.warn(`activity hook for ${row.id} failed: ${err.message}`),
    );
  }

  /** WELCOME once per user (inbox + email; no push). */
  async welcome(userId: string): Promise<boolean> {
    if (!(await claimOnce(this.prisma, 'welcome', userId, userId)))
      return false;
    await this.notifications.notify(userId, ({ locale, displayName }) => ({
      kind: 'WELCOME',
      ...welcomeCopy(locale, displayName),
      deepLink: '/today',
    }));
    return true;
  }

  /**
   * Activity after a lapse: reset the reactivation stage (conditional on
   * the stage we read, so a concurrent job run can't be overwritten
   * blindly) and pay the welcome-back quest for 14+ day lapses.
   */
  async returned(userId: string, now: Date = new Date()): Promise<boolean> {
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        reactivationStage: true,
        dormantAt: true,
        timezone: true,
        locale: true,
      },
    });
    if (!u || (u.reactivationStage === 0 && !u.dormantAt)) return false;
    const res = await this.prisma.user.updateMany({
      where: { id: userId, reactivationStage: u.reactivationStage },
      data: { reactivationStage: 0, dormantAt: null },
    });
    if (res.count === 0) return false;
    if (u.reactivationStage >= WELCOME_BACK_STAGE) {
      await this.welcomeBack.assign(userId, u.timezone, u.locale, now);
    }
    this.logger.log(
      `user ${userId} returned (stage ${u.reactivationStage}${u.dormantAt ? ', dormant' : ''})`,
    );
    return true;
  }
}
