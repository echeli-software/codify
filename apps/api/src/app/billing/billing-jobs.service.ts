import { Injectable, Logger } from '@nestjs/common';
import { isUniqueViolation } from '../prisma/prisma-errors.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { PushService } from '../notifications/push.service.js';
import { AccessService } from './access.service.js';
import { pixRenewalCopy } from './billing-push-copy.js';

const DAY_MS = 24 * 60 * 60 * 1000;
/** docs/09 §5 "Renewal": PIX renewal notice 7 days before the period ends. */
export const RENEWAL_REMINDER_DAYS = 7;
const REMINDER_SCOPE = 'billing_renewal_reminder';

export interface SweepResult {
  /** ACTIVE/TRIALING rows set to end at period end whose period ended → CANCELED. */
  canceled: number;
  /** PAST_DUE rows beyond `billing.pastDueGraceDays` → UNPAID. */
  unpaid: number;
}

export interface RenewalReminderResult {
  candidates: number;
  /** Pushes sent now or deferred past the user's quiet hours. */
  notified: number;
  alreadyReminded: number;
  /** Over the push cap / quiet hours with no queue: claim released, retried tomorrow. */
  retryLater: number;
}

/**
 * Daily billing hygiene (docs/09 §3 status table, §5 "Cancellation",
 * "Renewal"). Run by BillingScheduler; safe to run more than once a day.
 */
@Injectable()
export class BillingJobsService {
  private readonly logger = new Logger(BillingJobsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly push: PushService,
  ) {}

  /**
   * Status hygiene — access is already right (the domain rule reads
   * `cancelAtPeriodEnd` + `currentPeriodEnd`, and the PAST_DUE grace), this
   * makes the stored status say so for reporting/admin:
   *   - ACTIVE/TRIALING with cancelAtPeriodEnd whose period ended → CANCELED
   *     (one-shot PIX/Boleto prepay rows end this way);
   *   - PAST_DUE longer than the grace window → UNPAID. `pastDueSince` is
   *     kept so a late PAST_DUE re-sync still measures from the first failure.
   */
  async sweepSubscriptions(now: Date = new Date()): Promise<SweepResult> {
    const ended = {
      status: { in: ['ACTIVE' as const, 'TRIALING' as const] },
      cancelAtPeriodEnd: true,
      currentPeriodEnd: { lt: now },
    };
    const [withoutCancelDate, withCancelDate] = await this.prisma.$transaction([
      this.prisma.subscription.updateMany({
        where: { ...ended, canceledAt: null },
        data: { status: 'CANCELED', canceledAt: now },
      }),
      this.prisma.subscription.updateMany({
        where: ended,
        data: { status: 'CANCELED' },
      }),
    ]);

    const graceDays = await this.access.pastDueGraceDays();
    const cutoff = new Date(now.getTime() - graceDays * DAY_MS);
    const unpaid = await this.prisma.subscription.updateMany({
      where: {
        status: 'PAST_DUE',
        OR: [
          { pastDueSince: { lt: cutoff } },
          // Rows from before pastDueSince existed: the domain anchors on
          // currentPeriodEnd for those.
          { pastDueSince: null, currentPeriodEnd: { lt: cutoff } },
        ],
      },
      data: { status: 'UNPAID' },
    });

    const result = {
      canceled: withoutCancelDate.count + withCancelDate.count,
      unpaid: unpaid.count,
    };
    this.logger.log(
      `subscription sweep: ${result.canceled} → CANCELED, ${result.unpaid} → UNPAID`,
    );
    return result;
  }

  /**
   * PIX/Boleto prepay renewal reminder: once per subscription per period,
   * in the 7 days before `currentPeriodEnd`. Prepay rows are the ones
   * `WebhookService.grantPrepaid` (and the dev checkout) create: Stripe-web,
   * keyed by a Checkout Session id (`cs_…`) instead of a `sub_…`, and set
   * to end at period end. Users who already hold a later-ending subscription
   * (renewed, or moved to card) are skipped.
   */
  async sendRenewalReminders(
    now: Date = new Date(),
  ): Promise<RenewalReminderResult> {
    const rows = await this.prisma.subscription.findMany({
      where: {
        source: 'STRIPE_WEB',
        stripeSubscriptionId: { startsWith: 'cs_' },
        status: 'ACTIVE',
        cancelAtPeriodEnd: true,
        currentPeriodEnd: {
          gt: now,
          lte: new Date(now.getTime() + RENEWAL_REMINDER_DAYS * DAY_MS),
        },
        user: { deletedAt: null },
      },
      select: {
        id: true,
        userId: true,
        currentPeriodEnd: true,
        plan: { select: { name: true } },
        user: { select: { timezone: true } },
      },
    });

    const result: RenewalReminderResult = {
      candidates: 0,
      notified: 0,
      alreadyReminded: 0,
      retryLater: 0,
    };
    for (const row of rows) {
      const renewed = await this.prisma.subscription.findFirst({
        where: {
          userId: row.userId,
          id: { not: row.id },
          status: { in: ['ACTIVE', 'TRIALING', 'PAST_DUE'] },
          currentPeriodEnd: { gt: row.currentPeriodEnd },
        },
        select: { id: true },
      });
      if (renewed) continue;
      result.candidates += 1;

      const key = `${REMINDER_SCOPE}:${row.id}:${row.currentPeriodEnd.toISOString()}`;
      if (!(await this.claim(key, row.userId))) {
        result.alreadyReminded += 1;
        continue;
      }
      try {
        const res = await this.push.sendToUser(
          row.userId,
          ({ locale }) => ({
            ...pixRenewalCopy(
              locale,
              row.plan.name,
              row.currentPeriodEnd,
              row.user.timezone,
            ),
            data: {
              type: 'billing_renewal_reminder',
              subscriptionId: row.id,
            },
          }),
          { kind: 'BILLING', now },
        );
        if (res.status === 'sent' || res.status === 'deferred') {
          result.notified += 1;
        } else if (res.status === 'capped' || res.status === 'quiet_hours') {
          // Not delivered and not queued: let tomorrow's run try again.
          await this.unclaim(key);
          result.retryLater += 1;
        }
      } catch (err) {
        await this.unclaim(key);
        throw err;
      }
    }
    this.logger.log(
      `PIX renewal reminders: ${result.candidates} due, ${result.notified} notified, ${result.alreadyReminded} already reminded, ${result.retryLater} retry later`,
    );
    return result;
  }

  private async claim(key: string, userId: string): Promise<boolean> {
    try {
      await this.prisma.idempotencyRecord.create({
        data: { key, scope: REMINDER_SCOPE, userId },
      });
      return true;
    } catch (err) {
      if (isUniqueViolation(err)) return false;
      throw err;
    }
  }

  private async unclaim(key: string): Promise<void> {
    await this.prisma.idempotencyRecord.deleteMany({ where: { key } });
  }
}
